import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore'
import { isPlanType } from '@/lib/payment-catalog'
import { loadServerResellerPlanCatalog } from '@/lib/payment-catalog-server'
import type { PlanType, ResellerAccessType } from '@/types/chat'

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export async function fetchMercadoPagoPayment(paymentId: string) {
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

export function mercadoPagoPaymentStatus(payload: JsonRecord) {
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

function purchaseKey(purchase: JsonRecord) {
  return getString(purchase.paymentCode) || getString(purchase.platformCode) || getString(purchase.id)
}

function dedupePurchases(purchases: JsonRecord[]) {
  const purchasesByCode = new Map<string, JsonRecord>()
  const uniquePurchases: JsonRecord[] = []

  for (const purchase of purchases) {
    const key = purchaseKey(purchase)
    if (!key) {
      uniquePurchases.push(purchase)
      continue
    }
    purchasesByCode.set(key, purchase)
  }

  return [
    ...uniquePurchases,
    ...purchasesByCode.values(),
  ]
}

export async function syncMercadoPagoPayment(adminDb: Firestore, paymentId: string) {
  const storedRef = adminDb.collection('mercadoPagoPayments').doc(paymentId)
  const storedSnapshot = await storedRef.get()

  if (!storedSnapshot.exists) {
    await storedRef.set({
      provider: 'mercado-pago',
      platformCode: paymentId,
      unmatchedReason: 'local_payment_not_found',
      receivedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return { matched: false, status: 'pending', reason: 'local_payment_not_found' }
  }

  const stored = storedSnapshot.data() || {}
  const chatId = getString(stored.chatId)
  const accountId = getString(stored.accountId).toLowerCase()
  const plan = getString(stored.plan)
  const expectedAmountCents = Number(stored.amountCents)
  const mercadoPagoPayment = await fetchMercadoPagoPayment(paymentId)
  const status = mercadoPagoPaymentStatus(mercadoPagoPayment)
  const paidAmountCents = Math.round(Number(mercadoPagoPayment.transaction_amount || 0) * 100)
  const approvedAmountMatches = status === 'paid' && paidAmountCents === expectedAmountCents
  const safeStatus = status === 'paid' && !approvedAmountMatches ? 'rejected' : status
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
    return { matched: false, status: safeStatus, reason: 'missing_local_context' }
  }

  const chatRef = adminDb.collection('chats').doc(chatId)
  const chatSnapshot = await chatRef.get()
  if (!chatSnapshot.exists) {
    return { matched: false, status: safeStatus, reason: 'chat_not_found' }
  }

  const chat = chatSnapshot.data() || {}
  const currentPayment = asRecord(chat.payment)
  const currentPaymentCode = getString(currentPayment.code) || getString(currentPayment.platformCode)
  const currentContext: ResellerAccessType =
    stored.context === 'internal' || stored.context === 'external' ? stored.context : 'external'
  const currentResellerAccess = asRecord(asRecord(chat.resellerAccess)[currentContext])
  const currentSubscription = asRecord(chat.subscription)
  const affectsCurrentAccess =
    currentPaymentCode === paymentId ||
    getString(currentResellerAccess.paymentCode) === paymentId ||
    getString(currentSubscription.paymentCode) === paymentId
  const shouldWritePaymentToAccess = safeStatus === 'paid' || affectsCurrentAccess || !currentPaymentCode
  const accountUpdate: JsonRecord = {
    updatedAt: FieldValue.serverTimestamp(),
  }
  const chatUpdate: JsonRecord = {
    updatedAt: FieldValue.serverTimestamp(),
  }

  if (shouldWritePaymentToAccess) {
    accountUpdate.payment = paymentUpdate
    chatUpdate.payment = paymentUpdate
  }

  if (safeStatus === 'paid') {
    const catalog = await loadServerResellerPlanCatalog(adminDb)
    const selectedPlan = catalog[currentContext][plan as PlanType]
    const activatedAt = Timestamp.now()
    const expiresAt = expirationFor(selectedPlan.durationDays)
    const resellerEntitlement = {
      plan,
      status: 'active',
      activatedAt,
      expiresAt,
      paymentCode: paymentId,
    }
    const resellerPurchaseRecord = {
      id: paymentId,
      status: 'paid',
      plan,
      accessType: currentContext,
      priceLabel: selectedPlan.priceLabel,
      paymentCode: paymentId,
      platformCode: paymentId,
      activatedAt,
      expiresAt,
    }
    const existingPurchases = Array.isArray(chat.resellerPurchases) ? chat.resellerPurchases.map(asRecord) : []
    const alreadyRegistered = existingPurchases.some((purchase) => purchaseKey(purchase) === paymentId)

    chatUpdate.funnelStatus = 'paid'
    chatUpdate.lastMessage = 'Pagamento Pix confirmado pelo Mercado Pago.'
    chatUpdate.lastSender = 'admin'
    chatUpdate.lastMessageAt = FieldValue.serverTimestamp()
    chatUpdate.payment = {
      ...paymentUpdate,
      status: 'paid',
      paidAt: currentPayment.paidAt || FieldValue.serverTimestamp(),
    }
    accountUpdate.payment = chatUpdate.payment

    if (stored.context === 'internal' || stored.context === 'external') {
      chatUpdate.resellerAccess = {
        ...(asRecord(chat.resellerAccess)),
        [stored.context]: resellerEntitlement,
      }
      accountUpdate.resellerAccess = chatUpdate.resellerAccess

      chatUpdate.resellerPurchases = dedupePurchases(alreadyRegistered
        ? existingPurchases
        : [...existingPurchases, resellerPurchaseRecord])
      accountUpdate.resellerPurchases = chatUpdate.resellerPurchases
    } else {
      chatUpdate.subscription = resellerEntitlement
      accountUpdate.subscription = resellerEntitlement
    }
  }

  if ((safeStatus === 'rejected' || safeStatus === 'cancelled') && shouldWritePaymentToAccess) {
    chatUpdate.lastMessage = safeStatus === 'cancelled'
      ? 'Pagamento Pix cancelado pelo Mercado Pago.'
      : 'Pagamento Pix recusado pelo Mercado Pago.'
    chatUpdate.lastSender = 'admin'
    chatUpdate.lastMessageAt = FieldValue.serverTimestamp()
  }

  if (safeStatus === 'refunded' && shouldWritePaymentToAccess) {
    chatUpdate.funnelStatus = 'deactivated'
    chatUpdate.subscription = {
      ...(asRecord(chat.subscription)),
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

  return {
    matched: true,
    status: safeStatus,
    chatId,
    accountId,
    paymentId,
    localCode: getString(stored.localCode),
    plan,
    context: getString(stored.context),
  }
}
