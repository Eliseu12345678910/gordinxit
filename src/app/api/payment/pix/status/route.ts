import { NextRequest, NextResponse } from 'next/server'
import { isAccountAccessBlocked } from '@/lib/account-block'
import { getAdminAuth, getAdminDb, isFirebaseAuthTokenError } from '@/lib/firebase-admin'
import { syncMercadoPagoPayment } from '@/lib/mercadopago-payment-sync'

export const runtime = 'nodejs'

function cleanId(value: unknown) {
  const clean = String(value || '').trim()
  if (!clean || clean.length > 120 || /\s/.test(clean)) return ''
  return clean
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      idToken?: string
      chatId?: string
      accountId?: string
      paymentId?: string
    }

    const idToken = String(body.idToken || '')
    const chatId = cleanId(body.chatId)
    const accountId = String(body.accountId || '').trim().toLowerCase()
    const requestedPaymentId = cleanId(body.paymentId)

    if (!idToken || !chatId || !accountId) {
      return NextResponse.json({ error: 'Dados invalidos para consultar Pix.' }, { status: 400 })
    }

    const adminAuth = getAdminAuth()
    const adminDb = getAdminDb()
    const decodedToken = await adminAuth.verifyIdToken(idToken)
    const chatRef = adminDb.collection('chats').doc(chatId)
    const chatSnapshot = await chatRef.get()

    if (!chatSnapshot.exists) {
      return NextResponse.json({ error: 'Atendimento nao encontrado.' }, { status: 404 })
    }

    const chat = chatSnapshot.data() || {}
    const participants = Array.isArray(chat.participantUids) ? chat.participantUids : []
    const chatAccountId = String(chat.accountId || chat.usernameKey || '').toLowerCase()
    const accountSnapshot = await adminDb.collection('accounts').doc(accountId).get()
    const isAccountOwner = chatAccountId && chatAccountId === accountId
    const isParticipant = participants.includes(decodedToken.uid)

    if (!isAccountOwner && !isParticipant) {
      return NextResponse.json({ error: 'Voce nao pode consultar este Pix.' }, { status: 403 })
    }

    if (isAccountAccessBlocked(chat) || isAccountAccessBlocked(accountSnapshot.data())) {
      return NextResponse.json({ error: 'Pagina nao encontrada.', code: 'account_blocked' }, { status: 404 })
    }

    const payment = chat.payment && typeof chat.payment === 'object' ? chat.payment as Record<string, unknown> : {}
    const currentPaymentId = String(payment.code || payment.platformCode || '').trim()
    const paymentIds = [requestedPaymentId, currentPaymentId].filter(Boolean)
    const recentPayments = await adminDb.collection('mercadoPagoPayments')
      .where('chatId', '==', chatId)
      .limit(12)
      .get()

    recentPayments.docs.forEach((document) => {
      const data = document.data()
      if (String(data.accountId || '').toLowerCase() === accountId && !paymentIds.includes(document.id)) {
        paymentIds.push(document.id)
      }
    })

    if (!paymentIds.length || String(payment.provider || '') !== 'mercado-pago') {
      return NextResponse.json({ error: 'Nenhum Pix em aberto para consultar.' }, { status: 404 })
    }

    let latestResult: Awaited<ReturnType<typeof syncMercadoPagoPayment>> | null = null
    for (const paymentId of paymentIds) {
      const localPayment = await adminDb.collection('mercadoPagoPayments').doc(paymentId).get()
      const localPaymentData = localPayment.data() || {}
      if (
        !localPayment.exists ||
        String(localPaymentData.chatId || '') !== chatId ||
        String(localPaymentData.accountId || '').toLowerCase() !== accountId
      ) {
        continue
      }

      const result = await syncMercadoPagoPayment(adminDb, paymentId)
      latestResult = result
      if (result.status === 'paid') break
    }

    if (!latestResult) {
      return NextResponse.json({ error: 'Pix nao pertence a esta conta.' }, { status: 403 })
    }

    return NextResponse.json({
      ok: true,
      matched: latestResult.matched,
      status: latestResult.status,
      paid: latestResult.status === 'paid',
      paymentId: latestResult.paymentId || currentPaymentId,
      localCode: latestResult.localCode || String(payment.localCode || ''),
      plan: latestResult.plan || String(payment.plan || ''),
      context: latestResult.context || String(payment.context || ''),
    })
  } catch (error) {
    if (isFirebaseAuthTokenError(error)) {
      return NextResponse.json({ error: 'Sessao invalida.' }, { status: 401 })
    }
    console.error('Mercado Pago Pix status error:', error)
    return NextResponse.json({ error: 'Nao foi possivel consultar o pagamento agora.' }, { status: 500 })
  }
}
