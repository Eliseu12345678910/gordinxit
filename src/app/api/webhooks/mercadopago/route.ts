import { createHmac, timingSafeEqual } from 'crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { NextRequest, NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebase-admin'
import { isPlanType } from '@/lib/payment-catalog'
import { loadServerResellerPlanCatalog } from '@/lib/payment-catalog-server'
import type { PlanType, ResellerAccessType } from '@/types/chat'

export const runtime = 'nodejs'

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function getPaymentId(request: NextRequest, payload: JsonRecord) {
  return (
    request.nextUrl.searchParams.get('data.id') ||
    request.nextUrl.searchParams.get('id') ||
    getString(asRecord(payload.data).id) ||
    getString(payload.id)
  ).trim()
}

function parseSignature(value: string) {
  return value.split(',').reduce<Record<string, string>>((acc, part) => {
    const [key, rawValue] = part.split('=')
    if (key && rawValue) acc[key.trim()] = rawValue.trim()
    return acc
  }, {})
}

function safeEqual(first: string, second: string) {
  const firstBuffer = Buffer.from(first)
  const secondBuffer = Buffer.from(second)
  return firstBuffer.length === secondBuffer.length && timingSafeEqual(firstBuffer, secondBuffer)
}

function verifyWebhookSignature(request: NextRequest, paymentId: string) {
  const secret = (process.env.MERCADO_PAGO_WEBHOOK_SECRET || '').trim()
  if (!secret) return process.env.NODE_ENV !== 'production'

  const xSignature = request.headers.get('x-signature') || ''
  const xRequestId = request.headers.get('x-request-id') || ''
  const parts = parseSignature(xSignature)
  const ts = parts.ts
  const signature = parts.v1
  if (!paymentId || !xRequestId || !ts || !signature) return false

  const manifest = `id:${paymentId};request-id:${xRequestId};ts:${ts};`
  const expected = createHmac('sha256', secret).update(manifest).digest('hex')
  return safeEqual(expected, signature)
}

async function fetchMercadoPagoPayment(paymentId: string) {
  const accessToken = (process.env.MERCADO_PAGO_ACCESS_TOKEN || '').trim()
  if (!accessToken) throw new Error('Mercado Pago nao configurado.')

  const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
  })
  const payload = await response.json().catch(() => ({})) as JsonRecord
  if (!response.ok) throw new Error(getString(payload.message) || 'Pagamento nao encontrado no Mercado Pago.')
  return payload
}

function paymentStatus(payload: JsonRecord) {
  const status = getString(payload.status).toLowerCase()
  if (status === 'approved') return 'paid'
  if (status === 'rejected') return 'rejected'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'refunded' || status === 'charged_back') return 'refunded'
  return 'pending'
}

function expirationFor(days: number | null) {
  if (!days) return null
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + days)
  return Timestamp.fromDate(expiresAt)
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json().catch(() => ({})) as JsonRecord
    const paymentId = getPaymentId(request, payload)

    if (!paymentId) {
      return NextResponse.json({ ok: true, matched: false, reason: 'missing_payment_id' })
    }

    if (!verifyWebhookSignature(request, paymentId)) {
      return NextResponse.json({ ok: false, error: 'Assinatura invalida.' }, { status: 401 })
    }

    const adminDb = getAdminDb()
    const storedRef = adminDb.collection('mercadoPagoPayments').doc(paymentId)
    const storedSnapshot = await storedRef.get()

    if (!storedSnapshot.exists) {
      await storedRef.set({
        provider: 'mercado-pago',
        platformCode: paymentId,
        unmatchedReason: 'local_payment_not_found',
        receivedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      return NextResponse.json({ ok: true, matched: false })
    }

    const stored = storedSnapshot.data() || {}
    const chatId = getString(stored.chatId)
    const accountId = getString(stored.accountId).toLowerCase()
    const plan = getString(stored.plan)
    const expectedAmountCents = Number(stored.amountCents)
    const mercadoPagoPayment = await fetchMercadoPagoPayment(paymentId)
    const status = paymentStatus(mercadoPagoPayment)
    const paidAmountCents = Math.round(Number(mercadoPagoPayment.transaction_amount || 0) * 100)
    const approvedAmountMatches = status === 'paid' && paidAmountCents === expectedAmountCents
    const safeStatus = status === 'paid' && !approvedAmountMatches ? 'rejected' : status
    const catalog = await loadServerResellerPlanCatalog(adminDb)
    const paymentUpdate = {
      ...(stored || {}),
      provider: 'mercado-pago',
      status: safeStatus,
      code: paymentId,
      platformCode: paymentId,
      eventId: paymentId,
      saleAmount: Number(mercadoPagoPayment.transaction_amount) || null,
      paidAmountCents,
      expectedAmountCents,
      rawStatus: getString(mercadoPagoPayment.status),
      updatedAt: FieldValue.serverTimestamp(),
    }

    await storedRef.set({
      ...paymentUpdate,
      ...(safeStatus === 'paid' ? { processedAt: FieldValue.serverTimestamp() } : {}),
      ...(status === 'paid' && !approvedAmountMatches ? { amountMismatch: true } : {}),
    }, { merge: true })

    if (!chatId || !accountId || !isPlanType(plan)) {
      return NextResponse.json({ ok: true, matched: false, reason: 'missing_local_context' })
    }

    const chatRef = adminDb.collection('chats').doc(chatId)
    const chatSnapshot = await chatRef.get()
    if (!chatSnapshot.exists) {
      return NextResponse.json({ ok: true, matched: false, reason: 'chat_not_found' })
    }

    const chat = chatSnapshot.data() || {}
    const accountUpdate: JsonRecord = {
      payment: paymentUpdate,
      updatedAt: FieldValue.serverTimestamp(),
    }
    const chatUpdate: JsonRecord = {
      payment: paymentUpdate,
      updatedAt: FieldValue.serverTimestamp(),
    }

    if (safeStatus === 'paid') {
      const context: ResellerAccessType =
        stored.context === 'internal' || stored.context === 'external' ? stored.context : 'external'
      const selectedPlan = catalog[context][plan as PlanType]
      const resellerEntitlement = {
        plan,
        status: 'active',
        activatedAt: FieldValue.serverTimestamp(),
        expiresAt: expirationFor(selectedPlan.durationDays),
        paymentCode: paymentId,
      }
      const resellerPurchaseRecord = {
        id: paymentId,
        status: 'paid',
        plan,
        accessType: context,
        priceLabel: selectedPlan.priceLabel,
        paymentCode: paymentId,
        platformCode: paymentId,
        activatedAt: FieldValue.serverTimestamp(),
        expiresAt: expirationFor(selectedPlan.durationDays),
      }

      chatUpdate.funnelStatus = 'paid'
      chatUpdate.lastMessage = 'Pagamento Pix confirmado pelo Mercado Pago.'
      chatUpdate.lastSender = 'admin'
      chatUpdate.lastMessageAt = FieldValue.serverTimestamp()
      chatUpdate.payment = {
        ...paymentUpdate,
        status: 'paid',
        paidAt: chat.payment?.paidAt || FieldValue.serverTimestamp(),
      }
      accountUpdate.payment = chatUpdate.payment

      if (stored.context === 'internal' || stored.context === 'external') {
        chatUpdate.resellerAccess = {
          ...(chat.resellerAccess || {}),
          [stored.context]: resellerEntitlement,
        }
        chatUpdate.resellerPurchases = FieldValue.arrayUnion(resellerPurchaseRecord)
        accountUpdate.resellerAccess = {
          ...((chat.resellerAccess && typeof chat.resellerAccess === 'object' ? chat.resellerAccess : {}) as JsonRecord),
          [stored.context]: resellerEntitlement,
        }
        accountUpdate.resellerPurchases = FieldValue.arrayUnion(resellerPurchaseRecord)
      } else {
        chatUpdate.subscription = resellerEntitlement
        accountUpdate.subscription = resellerEntitlement
      }

    }

    if (safeStatus === 'rejected' || safeStatus === 'cancelled') {
      chatUpdate.lastMessage = safeStatus === 'cancelled'
        ? 'Pagamento Pix cancelado pelo Mercado Pago.'
        : 'Pagamento Pix recusado pelo Mercado Pago.'
      chatUpdate.lastSender = 'admin'
      chatUpdate.lastMessageAt = FieldValue.serverTimestamp()
    }

    if (safeStatus === 'refunded') {
      chatUpdate.funnelStatus = 'deactivated'
      chatUpdate.subscription = {
        ...(chat.subscription || {}),
        status: 'inactive',
        deactivatedAt: FieldValue.serverTimestamp(),
      }
      accountUpdate.subscription = {
        status: 'inactive',
        deactivatedAt: FieldValue.serverTimestamp(),
      }
    }

    await Promise.all([
      adminDb.collection('accounts').doc(accountId).set(accountUpdate, { merge: true }),
      chatRef.set(chatUpdate, { merge: true }),
    ])

    return NextResponse.json({ ok: true, matched: true, status: safeStatus })
  } catch (error) {
    console.error('Mercado Pago webhook error:', error)
    return NextResponse.json({ ok: false, error: 'Nao foi possivel processar o webhook Mercado Pago.' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    ok: true,
    endpoint: '/api/webhooks/mercadopago',
    postbackUrl: `${request.nextUrl.origin}/api/webhooks/mercadopago`,
  })
}
