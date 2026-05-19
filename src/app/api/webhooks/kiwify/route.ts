import { createHash } from 'crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { NextRequest, NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebase-admin'

export const runtime = 'nodejs'

type PlanType = 'weekly' | 'monthly' | 'lifetime'
type PaymentTarget = PlanType | 'plugin'
type JsonRecord = Record<string, unknown>

const planLabels: Record<PaymentTarget, string> = {
  weekly: 'Semanal',
  monthly: 'Mensal',
  lifetime: 'Vitalicio',
  plugin: 'Plugin ServiceSync Core',
}

const approvedEventParts = ['compra_aprovada', 'paid', 'approved', 'completed']
const refundedEventParts = ['reembolso', 'refunded', 'refund']
const cancelledEventParts = ['cancel', 'canceled', 'cancelado', 'cancelada']
const chargebackEventParts = ['chargeback']
const rejectedEventParts = ['rejected', 'recusado', 'recusada', 'failed']

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

function firstRecord(...values: unknown[]) {
  for (const value of values) {
    const record = asRecord(value)
    if (Object.keys(record).length) return record
  }

  return {}
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function getNested(source: JsonRecord, ...path: string[]) {
  let current: unknown = source

  for (const part of path) {
    current = asRecord(current)[part]
  }

  return current
}

function getNestedString(source: JsonRecord, ...path: string[]) {
  return getString(getNested(source, ...path))
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const clean = getString(value)
    if (clean) return clean
  }

  return ''
}

function cleanChatId(value: string) {
  const clean = value.trim()
  if (!clean || clean.length > 120 || /\s/.test(clean)) return ''
  return clean
}

function findChatId(payload: JsonRecord) {
  const data = asRecord(payload.data)
  const order = asRecord(payload.order)
  const sale = asRecord(payload.sale)
  const tracking = firstRecord(
    payload.tracking,
    payload.trackingParameters,
    payload.TrackingParameters,
    data.tracking,
    order.tracking,
    sale.tracking,
    getNested(payload, 'data', 'tracking'),
    getNested(payload, 'order', 'tracking'),
    getNested(payload, 'sale', 'tracking'),
  )

  const candidates = [
    payload.src,
    payload.sck,
    payload.utm_content,
    payload.utm_term,
    payload.s1,
    payload.chatId,
    payload.external_reference,
    tracking.src,
    tracking.sck,
    tracking.utm_content,
    tracking.utm_term,
    tracking.s1,
    data.src,
    data.sck,
    data.utm_content,
    data.utm_term,
    data.s1,
    order.src,
    order.sck,
    order.utm_content,
    order.utm_term,
    order.s1,
    sale.src,
    sale.sck,
    sale.utm_content,
    sale.utm_term,
    sale.s1,
    getNested(payload, 'Product', 'external_reference'),
    getNested(payload, 'product', 'external_reference'),
    getNested(payload, 'Order', 'external_reference'),
    getNested(payload, 'order', 'external_reference'),
    getNested(payload, 'sale', 'external_reference'),
  ]

  for (const candidate of candidates) {
    const chatId = cleanChatId(getString(candidate))
    if (chatId) return chatId
  }

  return ''
}

function findPlan(payload: JsonRecord): PaymentTarget | undefined {
  const data = asRecord(payload.data)
  const order = asRecord(payload.order)
  const sale = asRecord(payload.sale)
  const tracking = firstRecord(
    payload.tracking,
    payload.trackingParameters,
    payload.TrackingParameters,
    data.tracking,
    order.tracking,
    sale.tracking,
    getNested(payload, 'data', 'tracking'),
    getNested(payload, 'order', 'tracking'),
    getNested(payload, 'sale', 'tracking'),
  )
  const planFromTracking = firstString(
    payload.utm_campaign,
    payload.s2,
    tracking.utm_campaign,
    tracking.s2,
    getNested(payload, 'data', 'utm_campaign'),
    getNested(payload, 'order', 'utm_campaign'),
    getNested(payload, 'sale', 'utm_campaign'),
  ).toLowerCase()

  if (
    planFromTracking === 'weekly' ||
    planFromTracking === 'monthly' ||
    planFromTracking === 'lifetime' ||
    planFromTracking === 'plugin'
  ) {
    return planFromTracking
  }

  const productName = firstString(
    payload.product_name,
    payload.offer_name,
    getNested(payload, 'Product', 'product_name'),
    getNested(payload, 'Product', 'name'),
    getNested(payload, 'product', 'name'),
    getNested(payload, 'data', 'product_name'),
    getNested(payload, 'order', 'product_name'),
    getNested(payload, 'sale', 'product_name'),
  ).toLowerCase()

  if (productName.includes('plugin') || productName.includes('servicesync')) return 'plugin'
  if (productName.includes('semanal')) return 'weekly'
  if (productName.includes('mensal')) return 'monthly'
  if (productName.includes('permanente') || productName.includes('vital')) return 'lifetime'

  return undefined
}

function eventName(payload: JsonRecord) {
  return firstString(
    payload.webhook_event_type,
    payload.event,
    payload.event_type,
    payload.type,
    payload.status,
    payload.order_status,
    payload.sale_status,
    getNested(payload, 'data', 'status'),
    getNested(payload, 'order', 'status'),
    getNested(payload, 'sale', 'status'),
  ).toLowerCase()
}

function eventPaymentStatus(payload: JsonRecord) {
  const event = eventName(payload)

  if (approvedEventParts.some((part) => event.includes(part))) return 'paid'
  if (refundedEventParts.some((part) => event.includes(part))) return 'refunded'
  if (chargebackEventParts.some((part) => event.includes(part))) return 'refunded'
  if (cancelledEventParts.some((part) => event.includes(part))) return 'cancelled'
  if (rejectedEventParts.some((part) => event.includes(part))) return 'rejected'

  return 'pending'
}

function makeEventId(payload: JsonRecord) {
  const code = firstString(
    payload.id,
    payload.order_id,
    payload.order_ref,
    payload.order_code,
    payload.purchase_id,
    payload.sale_id,
    payload.code,
    payload.reference,
    getNested(payload, 'data', 'id'),
    getNested(payload, 'data', 'order_id'),
    getNested(payload, 'order', 'id'),
    getNested(payload, 'sale', 'id'),
  )
  const eventIdPart = (eventName(payload) || eventPaymentStatus(payload) || 'event')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 60)

  if (code) {
    const cleanCode = code.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120)
    return `${cleanCode}_${eventIdPart}`.slice(0, 180)
  }

  return createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
    .slice(0, 48) + `_${eventIdPart}`
}

function getCustomerSummary(payload: JsonRecord) {
  const customer = firstRecord(payload.Customer, payload.customer, getNested(payload, 'data', 'customer'))
  return {
    name: firstString(customer.full_name, customer.name, payload.customer_name),
    email: firstString(customer.email, payload.customer_email),
    phone: firstString(customer.mobile, customer.phone, customer.phone_number, payload.customer_phone),
  }
}

function getSaleAmount(payload: JsonRecord) {
  const amount = Number(
    firstString(
      payload.sale_amount,
      payload.total_amount,
      payload.price,
      payload.net_amount,
      getNested(payload, 'Commissions', 'charge_amount'),
      getNested(payload, 'payment', 'charge_amount'),
      getNested(payload, 'order', 'total'),
      getNested(payload, 'sale', 'total'),
      getNested(payload, 'data', 'total_amount'),
    ).replace(',', '.'),
  )

  return Number.isFinite(amount) ? amount : null
}

function getEventSummary(payload: JsonRecord, chatId: string) {
  const plan = findPlan(payload)

  return {
    provider: 'kiwify',
    chatId: chatId || null,
    code: makeEventId(payload),
    event: eventName(payload) || null,
    statusLabel: eventPaymentStatus(payload),
    saleAmount: getSaleAmount(payload),
    plan: plan || null,
    planName: plan ? planLabels[plan] : null,
    productName:
      firstString(
        payload.product_name,
        getNested(payload, 'Product', 'product_name'),
        getNested(payload, 'Product', 'name'),
        getNested(payload, 'product', 'name'),
        getNested(payload, 'data', 'product', 'name'),
        getNested(payload, 'order', 'product', 'name'),
        getNested(payload, 'sale', 'product', 'name'),
      ) || null,
    customer: getCustomerSummary(payload),
  }
}

async function getLiveIntroEnabled(adminDb: ReturnType<typeof getAdminDb>) {
  const settingsSnapshot = await adminDb.collection('settings').doc('chat-private').get()
  return settingsSnapshot.data()?.liveIntroEnabled === true
}

function getPaymentConfirmationMessages(liveIntroEnabled: boolean) {
  if (liveIntroEnabled) {
    return [
      'Pagamento confirmado, mano. Fica de olho aqui no chat privado que eu ja te envio logo apos finalizar a live',
      'beleza?',
    ]
  }

  return [
    'Pagamento confirmado, mano. Fica de olho aqui no chat privado que eu ja te envio em ate 6h',
    'Eu falo "em ate 6h", mas falo isso que e para agir com transparencia com voce, pois a gente sempre manda antes disso. So aguardar, beleza?',
  ]
}

async function readPayload(request: NextRequest) {
  const contentType = request.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    return (await request.json()) as JsonRecord
  }

  const text = await request.text()
  if (!text.trim()) return {}

  try {
    return JSON.parse(text) as JsonRecord
  } catch {
    const params = new URLSearchParams(text)
    return Object.fromEntries(params.entries())
  }
}

function getReceivedTokens(request: NextRequest, payload: JsonRecord) {
  const authorization = request.headers.get('authorization') || ''
  const bearer = authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : ''

  return uniqueStrings([
    request.nextUrl.searchParams.get('token') || '',
    request.headers.get('x-kiwify-token') || '',
    request.headers.get('x-webhook-token') || '',
    bearer,
    payload.token,
    payload.webhook_token,
    payload.secret,
  ].map(getString))
}

export async function POST(request: NextRequest) {
  try {
    const payload = await readPayload(request)
    const expectedToken = (process.env.KIWIFY_WEBHOOK_TOKEN || '').trim()
    const receivedTokens = getReceivedTokens(request, payload)

    if (expectedToken && !receivedTokens.includes(expectedToken)) {
      return NextResponse.json({ ok: false, error: 'Token Kiwify invalido.' }, { status: 401 })
    }

    if (process.env.NODE_ENV === 'production' && !expectedToken) {
      return NextResponse.json({ ok: false, error: 'Token Kiwify nao configurado.' }, { status: 500 })
    }

    const adminDb = getAdminDb()
    const chatId = findChatId(payload)
    const eventId = makeEventId(payload)
    const eventRef = adminDb.collection('kiwifyEvents').doc(eventId)
    const eventSnapshot = await eventRef.get()

    if (eventSnapshot.exists && eventSnapshot.data()?.processed === true) {
      return NextResponse.json({ ok: true, duplicate: true })
    }

    const paymentStatus = eventPaymentStatus(payload)
    const eventSummary = getEventSummary(payload, chatId)
    await eventRef.set(
      {
        ...eventSummary,
        receivedAt: FieldValue.serverTimestamp(),
        processed: false,
      },
      { merge: true },
    )

    if (!chatId) {
      await eventRef.set(
        {
          unmatchedReason: 'chat_id_not_found_in_tracking',
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      return NextResponse.json({ ok: true, matched: false })
    }

    const chatRef = adminDb.collection('chats').doc(chatId)
    const chatSnapshot = await chatRef.get()

    if (!chatSnapshot.exists) {
      await eventRef.set(
        {
          unmatchedReason: 'chat_not_found',
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      return NextResponse.json({ ok: true, matched: false })
    }

    const chat = chatSnapshot.data() || {}
    const accountId = String(chat.accountId || chat.usernameKey || '').toLowerCase()
    const plan = findPlan(payload) || chat.selectedPlan?.plan
    const paymentUpdate = {
      ...(chat.payment || {}),
      provider: 'kiwify',
      status: paymentStatus,
      code: eventId,
      saleAmount: getSaleAmount(payload),
      customer: getCustomerSummary(payload),
      ...(plan ? { plan } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    }

    const chatUpdate: JsonRecord = {
      payment: paymentUpdate,
      updatedAt: FieldValue.serverTimestamp(),
    }
    const accountUpdate: JsonRecord = {
      payment: paymentUpdate,
      updatedAt: FieldValue.serverTimestamp(),
    }

    if (paymentStatus === 'paid') {
      const isPluginPayment = plan === 'plugin'
      const alreadyPaid = isPluginPayment
        ? chat.plugin?.included === true && chat.plugin?.status === 'active'
        : chat.payment?.status === 'paid' && chat.payment?.plan !== 'plugin'
      const liveIntroEnabled = alreadyPaid || isPluginPayment ? false : await getLiveIntroEnabled(adminDb)
      const confirmationMessages = isPluginPayment
        ? [
            'Plugin confirmado, mano. Agora sua conta ficou permanente e o ServiceSync Core esta liberado.',
            'Pronto, nao precisa pagar mais nada. Seu xit fica com uso vitalicio e atualizacao gratuita pra sempre.',
          ]
        : getPaymentConfirmationMessages(liveIntroEnabled)
      const existingPlugin = chat.plugin && typeof chat.plugin === 'object' ? chat.plugin : {}
      const pluginAlreadyActive = existingPlugin.included === true && existingPlugin.status === 'active'
      const plugin = {
        ...existingPlugin,
        name: 'ServiceSync Core',
        included: isPluginPayment || pluginAlreadyActive,
        status: isPluginPayment || pluginAlreadyActive ? 'active' : 'inactive',
        ...(isPluginPayment ? { activatedAt: FieldValue.serverTimestamp() } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      }
      chatUpdate.funnelStatus = isPluginPayment ? 'activated' : 'paid'
      chatUpdate.lastMessage = alreadyPaid
        ? isPluginPayment
          ? 'Plugin ja confirmado pela Kiwify.'
          : 'Pagamento ja confirmado pela Kiwify.'
        : confirmationMessages.at(-1)
      chatUpdate.lastSender = 'admin'
      chatUpdate.lastMessageAt = FieldValue.serverTimestamp()
      chatUpdate.payment = {
        ...paymentUpdate,
        status: 'paid',
        paidAt: chat.payment?.paidAt || FieldValue.serverTimestamp(),
      }
      chatUpdate.plugin = plugin
      accountUpdate.payment = chatUpdate.payment
      accountUpdate.plugin = plugin

      if (isPluginPayment) {
        const subscription = {
          plan: 'lifetime',
          status: 'active',
          activatedAt: FieldValue.serverTimestamp(),
          expiresAt: null,
        }
        chatUpdate.subscription = subscription
        accountUpdate.subscription = subscription
      }

      if (!alreadyPaid) {
        const messageTimestamp = Date.now()

        await Promise.all(
          confirmationMessages.map((text, index) =>
            chatRef.collection('messages').add({
              sender: 'admin',
              kind: 'text',
              text,
              createdAt: Timestamp.fromMillis(messageTimestamp + index),
            }),
          ),
        )
      }
    }

    if (paymentStatus === 'refunded') {
      chatUpdate.funnelStatus = 'deactivated'
      chatUpdate.lastMessage = 'Pagamento reembolsado pela Kiwify.'
      chatUpdate.lastSender = 'admin'
      chatUpdate.lastMessageAt = FieldValue.serverTimestamp()
      chatUpdate.subscription = {
        ...(chat.subscription || {}),
        status: 'inactive',
        deactivatedAt: FieldValue.serverTimestamp(),
      }
      accountUpdate.subscription = {
        status: 'inactive',
        deactivatedAt: FieldValue.serverTimestamp(),
      }

      if (plan === 'plugin') {
        const existingPlugin = chat.plugin && typeof chat.plugin === 'object' ? chat.plugin : {}
        const plugin = {
          ...existingPlugin,
          name: 'ServiceSync Core',
          included: false,
          status: 'inactive',
          updatedAt: FieldValue.serverTimestamp(),
        }
        chatUpdate.plugin = plugin
        accountUpdate.plugin = plugin
      }
    }

    if (paymentStatus === 'cancelled' || paymentStatus === 'rejected') {
      chatUpdate.lastMessage =
        paymentStatus === 'cancelled'
          ? 'Pagamento cancelado pela Kiwify.'
          : 'Pagamento recusado pela Kiwify.'
      chatUpdate.lastSender = 'admin'
      chatUpdate.lastMessageAt = FieldValue.serverTimestamp()
    }

    if (accountId) {
      await adminDb.collection('accounts').doc(accountId).set(accountUpdate, { merge: true })
    }

    await chatRef.set(chatUpdate, { merge: true })
    await eventRef.set(
      {
        processed: true,
        processedAt: FieldValue.serverTimestamp(),
        matchedChatId: chatId,
        matchedAccountId: accountId || null,
      },
      { merge: true },
    )

    return NextResponse.json({
      ok: true,
      matched: true,
      approved: paymentStatus === 'paid',
      status: paymentStatus,
    })
  } catch (error) {
    console.error('Kiwify webhook error:', error)
    return NextResponse.json({ ok: false, error: 'Nao foi possivel processar o webhook Kiwify.' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    ok: true,
    endpoint: '/api/webhooks/kiwify',
    postbackUrl: `${request.nextUrl.origin}/api/webhooks/kiwify`,
  })
}
