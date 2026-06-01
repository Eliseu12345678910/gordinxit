import { createHash, randomUUID } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest, NextResponse } from 'next/server'
import { isAccountAccessBlocked } from '@/lib/account-block'
import { getAdminAuth, getAdminDb, isFirebaseAuthTokenError } from '@/lib/firebase-admin'
import { fetchMercadoPagoPayment, mercadoPagoPaymentStatus } from '@/lib/mercadopago-payment-sync'
import { isPlanType } from '@/lib/payment-catalog'
import { loadServerResellerPlanCatalog } from '@/lib/payment-catalog-server'
import type { PlanType } from '@/types/chat'

export const runtime = 'nodejs'

type PixContext = 'internal' | 'external'
type JsonRecord = Record<string, unknown>

const contextLabels: Record<PixContext, string> = {
  internal: 'Internal',
  external: 'External',
}

function isPixContext(value: unknown): value is PixContext {
  return value === 'internal' || value === 'external'
}

function cleanId(value: unknown) {
  const clean = String(value || '').trim()
  if (!clean || clean.length > 120 || /\s/.test(clean)) return ''
  return clean
}

function cleanEmail(accountId: string, origin: string) {
  const local = accountId.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 48) || 'cliente'
  try {
    const host = new URL(origin).hostname.replace(/^www\./, '')
    const domain = host.includes('.') ? host : 'gordinxit.site'
    return `${local}@${domain}`
  } catch {
    return `${local}@gordinxit.site`
  }
}

function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function getNestedString(source: JsonRecord, ...path: string[]) {
  let current: unknown = source
  for (const part of path) current = jsonRecord(current)[part]
  return getString(current)
}

function getPixTransactionData(payment: JsonRecord) {
  const transactionData = jsonRecord(jsonRecord(payment.point_of_interaction).transaction_data)
  return {
    qrCode: getString(transactionData.qr_code),
    qrCodeBase64: getString(transactionData.qr_code_base64),
    ticketUrl: getNestedString(payment, 'transaction_details', 'external_resource_url'),
  }
}

function makeLocalPixCode(chatId: string, accountId: string, plan: PlanType, context: PixContext) {
  const hash = createHash('sha256')
    .update(`${chatId}:${accountId}:${plan}:${context}:${Date.now()}:${randomUUID()}`)
    .digest('hex')
    .slice(0, 24)
  return `gordinxit_id_${hash}`
}

async function createMercadoPagoPix({
  accessToken,
  amount,
  description,
  payerEmail,
  externalReference,
  notificationUrl,
}: {
  accessToken: string
  amount: number
  description: string
  payerEmail: string
  externalReference: string
  notificationUrl: string
}) {
  const response = await fetch('https://api.mercadopago.com/v1/payments', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
      'x-idempotency-key': externalReference,
    },
    body: JSON.stringify({
      transaction_amount: amount,
      description,
      payment_method_id: 'pix',
      external_reference: externalReference,
      notification_url: notificationUrl,
      payer: {
        email: payerEmail,
      },
    }),
  })

  const payload = await response.json().catch(() => ({})) as JsonRecord
  if (!response.ok) {
    throw new Error(getString(payload.message) || 'Mercado Pago recusou a geracao do Pix.')
  }

  return payload
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      idToken?: string
      chatId?: string
      accountId?: string
      plan?: string
      context?: string
    }

    const idToken = String(body.idToken || '')
    const chatId = cleanId(body.chatId)
    const accountId = String(body.accountId || '').trim().toLowerCase()
    const plan = String(body.plan || '')
    const context = String(body.context || '')

    if (!idToken || !chatId || !accountId || !isPlanType(plan) || !isPixContext(context)) {
      return NextResponse.json({ error: 'Dados invalidos para gerar Pix.' }, { status: 400 })
    }

    const adminAuth = getAdminAuth()
    const adminDb = getAdminDb()
    const decodedToken = await adminAuth.verifyIdToken(idToken)
    const chatRef = adminDb.collection('chats').doc(chatId)
    const chatSnapshot = await chatRef.get()

    if (!chatSnapshot.exists) {
      return NextResponse.json({ error: 'Login nao encontrado.' }, { status: 404 })
    }

    const chat = chatSnapshot.data()
    const participants = Array.isArray(chat?.participantUids) ? chat.participantUids : []
    const chatAccountId = String(chat?.accountId || chat?.usernameKey || '').toLowerCase()
    const accountSnapshot = await adminDb.collection('accounts').doc(accountId).get()
    const isAccountOwner = chatAccountId && chatAccountId === accountId
    const isParticipant = participants.includes(decodedToken.uid)

    if (!isAccountOwner && !isParticipant) {
      return NextResponse.json({ error: 'Este login nao pode gerar Pix para esta conta.' }, { status: 403 })
    }

    if (isAccountAccessBlocked(chat) || isAccountAccessBlocked(accountSnapshot.data())) {
      return NextResponse.json({ error: 'Pagina nao encontrada.', code: 'account_blocked' }, { status: 404 })
    }

    const accessToken = (process.env.MERCADO_PAGO_ACCESS_TOKEN || '').trim()
    if (!accessToken) {
      return NextResponse.json({ error: 'Pix ainda nao configurado no servidor.' }, { status: 503 })
    }

    const catalog = await loadServerResellerPlanCatalog(adminDb)
    const selectedPlan = catalog[context][plan]
    const amount = selectedPlan.amountCents / 100
    const existingPayments = await adminDb.collection('mercadoPagoPayments')
      .where('chatId', '==', chatId)
      .limit(12)
      .get()

    for (const document of existingPayments.docs) {
      const existing = document.data()
      if (
        String(existing.accountId || '').toLowerCase() !== accountId ||
        existing.context !== context ||
        existing.plan !== plan
      ) {
        continue
      }

      const existingAmountCents = Number(existing.amountCents)
      if (Number.isFinite(existingAmountCents) && existingAmountCents !== selectedPlan.amountCents) {
        continue
      }

      let existingStatus = getString(existing.status) || 'pending'
      let existingQrCode = getString(existing.qrCode)
      let existingQrCodeBase64 = getString(existing.qrCodeBase64)
      let existingTicketUrl = getString(existing.ticketUrl) || getString(existing.link)

      try {
        const mercadoPagoPayment = await fetchMercadoPagoPayment(document.id)
        existingStatus = mercadoPagoPaymentStatus(mercadoPagoPayment)
        const pixData = getPixTransactionData(mercadoPagoPayment)
        existingQrCode = existingQrCode || pixData.qrCode
        existingQrCodeBase64 = existingQrCodeBase64 || pixData.qrCodeBase64
        existingTicketUrl = existingTicketUrl || pixData.ticketUrl
      } catch {
        // If Mercado Pago is temporarily unavailable, reuse the local QR when it exists.
      }

      if (existingStatus !== 'pending' || !existingQrCode) continue

      const paymentRecord = {
        provider: 'mercado-pago',
        status: 'pending',
        code: document.id,
        platformCode: document.id,
        localCode: getString(existing.localCode),
        externalReference: getString(existing.externalReference),
        context,
        plan,
        label: `Gerar PIX ${selectedPlan.label}`,
        saleAmount: amount,
        amountCents: selectedPlan.amountCents,
        currency: 'BRL',
        updatedAt: FieldValue.serverTimestamp(),
      }

      await Promise.all([
        adminDb.collection('mercadoPagoPayments').doc(document.id).set({
          ...paymentRecord,
          chatId,
          accountId,
          qrCode: existingQrCode,
          qrCodeBase64: existingQrCodeBase64,
          ticketUrl: existingTicketUrl,
        }, { merge: true }),
        adminDb.collection('accounts').doc(accountId).set({
          payment: {
            ...paymentRecord,
            link: existingTicketUrl || '',
          },
          purchaseIntent: {
            plan,
            label: selectedPlan.label,
            price: selectedPlan.price,
            priceLabel: selectedPlan.priceLabel,
            context,
          },
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true }),
        chatRef.set({
          selectedPlan: {
            plan,
            label: selectedPlan.label,
            price: selectedPlan.price,
            priceLabel: selectedPlan.priceLabel,
            context,
          },
          payment: {
            ...paymentRecord,
            link: existingTicketUrl || '',
          },
          funnelStatus: 'waiting_receipt',
          lastMessage: 'Cliente abriu o Pix pendente novamente.',
          lastSender: 'client',
          lastMessageAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true }),
      ])

      return NextResponse.json({
        paymentId: document.id,
        status: 'pending',
        plan,
        context,
        priceLabel: selectedPlan.priceLabel,
        localCode: getString(existing.localCode),
        qrCode: existingQrCode,
        qrCodeBase64: existingQrCodeBase64,
        ticketUrl: existingTicketUrl,
        reused: true,
      })
    }

    const localCode = makeLocalPixCode(chatId, accountId, plan, context)
    const externalReference = `${localCode}_${plan}_${context}`
    const origin = process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin
    const notificationUrl = `${origin.replace(/\/$/, '')}/api/webhooks/mercadopago`
    const description = `Gordin du Xit ${selectedPlan.label} ${contextLabels[context]}`
    const payment = await createMercadoPagoPix({
      accessToken,
      amount,
      description,
      payerEmail: cleanEmail(accountId, origin),
      externalReference,
      notificationUrl,
    })

    const paymentId = String(payment.id || '')
    const { qrCode, qrCodeBase64, ticketUrl } = getPixTransactionData(payment)

    if (!paymentId || !qrCode) {
      throw new Error('Mercado Pago nao retornou o Pix completo.')
    }

    const paymentRecord = {
      provider: 'mercado-pago',
      status: getString(payment.status) || 'pending',
      code: paymentId,
      platformCode: paymentId,
      localCode,
      externalReference,
      context,
      plan,
      label: `Gerar PIX ${selectedPlan.label}`,
      saleAmount: amount,
      amountCents: selectedPlan.amountCents,
      currency: 'BRL',
      updatedAt: FieldValue.serverTimestamp(),
    }

    await Promise.all([
      adminDb.collection('mercadoPagoPayments').doc(paymentId).set({
        ...paymentRecord,
        chatId,
        accountId,
        qrCode,
        qrCodeBase64,
        ticketUrl,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true }),
      adminDb.collection('accounts').doc(accountId).set({
        payment: {
          ...paymentRecord,
          status: 'pending',
          link: ticketUrl || '',
        },
        purchaseIntent: {
          plan,
          label: selectedPlan.label,
          price: selectedPlan.price,
          priceLabel: selectedPlan.priceLabel,
          context,
        },
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }),
      chatRef.set({
        selectedPlan: {
          plan,
          label: selectedPlan.label,
          price: selectedPlan.price,
          priceLabel: selectedPlan.priceLabel,
          context,
        },
        payment: {
          ...paymentRecord,
          status: 'pending',
          link: ticketUrl || '',
        },
        funnelStatus: 'waiting_receipt',
        lastMessage: 'Cliente gerou um Pix.',
        lastSender: 'client',
        lastMessageAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }),
    ])

    return NextResponse.json({
      paymentId,
      status: getString(payment.status) || 'pending',
      plan,
      context,
      priceLabel: selectedPlan.priceLabel,
      localCode,
      qrCode,
      qrCodeBase64,
      ticketUrl,
    })
  } catch (error) {
    if (isFirebaseAuthTokenError(error)) {
      return NextResponse.json({ error: 'Sessao invalida.' }, { status: 401 })
    }
    console.error('Mercado Pago Pix error:', error)
    return NextResponse.json({ error: 'Nao foi possivel gerar o Pix com seguranca.' }, { status: 500 })
  }
}
