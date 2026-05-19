import { createHash } from 'crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { NextRequest, NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebase-admin'

export const runtime = 'nodejs'

type PlanType = 'weekly' | 'monthly' | 'lifetime'
type PaymentTarget = PlanType | 'plugin'
type JsonRecord = Record<string, unknown>

const approvedStatuses = new Set([2, 10])

const statusLabels: Record<number, string> = {
  1: 'pending',
  2: 'approved',
  3: 'in_process',
  4: 'in_mediation',
  5: 'rejected',
  6: 'cancelled',
  7: 'refunded',
  8: 'authorized',
  9: 'charged_back',
  10: 'completed',
  11: 'checkout_error',
  12: 'precheckout',
  13: 'expired',
  16: 'in_review',
}

const planLabels: Record<PaymentTarget, string> = {
  weekly: 'Semanal',
  monthly: 'Mensal',
  lifetime: 'Vitalicio',
  plugin: 'Plugin ServiceSync Core',
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function getNestedString(source: JsonRecord, ...path: string[]) {
  let current: unknown = source

  for (const part of path) {
    current = asRecord(current)[part]
  }

  return getString(current)
}

function cleanChatId(value: string) {
  const clean = value.trim()
  if (!clean || clean.length > 120 || /\s/.test(clean)) return ''
  return clean
}

function findChatId(payload: JsonRecord) {
  const metadata = asRecord(payload.metadata)
  const candidates = [
    metadata.src,
    metadata.sck,
    metadata.utm_content,
    metadata.utm_term,
    metadata.utm_perfect,
    metadata.s1,
    payload.src,
    payload.sck,
    payload.utm_content,
    payload.chatId,
    payload.s1,
    payload.external_reference,
    getNestedString(payload, 'product', 'external_reference'),
  ]

  for (const candidate of candidates) {
    const chatId = cleanChatId(getString(candidate))
    if (chatId) return chatId
  }

  return ''
}

function findPlan(payload: JsonRecord): PaymentTarget | undefined {
  const metadata = asRecord(payload.metadata)
  const campaign = getString(metadata.utm_campaign || payload.utm_campaign).toLowerCase()
  const trackingPlan = getString(metadata.s2 || payload.s2).toLowerCase()
  if (campaign === 'weekly' || campaign === 'monthly' || campaign === 'lifetime' || campaign === 'plugin') {
    return campaign
  }
  if (
    trackingPlan === 'weekly' ||
    trackingPlan === 'monthly' ||
    trackingPlan === 'lifetime' ||
    trackingPlan === 'plugin'
  ) {
    return trackingPlan
  }

  const planName = getNestedString(payload, 'plan', 'name').toLowerCase()
  const productName = getNestedString(payload, 'product', 'name').toLowerCase()
  const source = `${planName} ${productName}`

  if (source.includes('plugin') || source.includes('servicesync')) return 'plugin'
  if (source.includes('semanal')) return 'weekly'
  if (source.includes('mensal')) return 'monthly'
  if (source.includes('permanente') || source.includes('vital')) return 'lifetime'

  return undefined
}

function getStatusEnum(payload: JsonRecord) {
  const status = Number(payload.sale_status_enum)
  return Number.isFinite(status) ? status : 0
}

function makeEventId(payload: JsonRecord) {
  const code = getString(payload.code)
  const statusPart = String(getStatusEnum(payload) || getString(payload.sale_status_detail) || 'event')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 60)

  if (code) {
    const cleanCode = code.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120)
    return `${cleanCode}_${statusPart}`.slice(0, 180)
  }

  return createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
    .slice(0, 48) + `_${statusPart}`
}

function getCustomerSummary(payload: JsonRecord) {
  const customer = asRecord(payload.customer)
  return {
    name: getString(customer.full_name),
    email: getString(customer.email),
    phone: [getString(customer.phone_area_code), getString(customer.phone_number)].filter(Boolean).join(''),
  }
}

function getEventSummary(payload: JsonRecord, chatId: string) {
  const status = getStatusEnum(payload)
  const plan = findPlan(payload)

  return {
    provider: 'perfect-pay',
    chatId: chatId || null,
    code: getString(payload.code) || null,
    status,
    statusLabel: statusLabels[status] || 'unknown',
    saleAmount: Number(payload.sale_amount) || null,
    currencyEnum: Number(payload.currency_enum) || null,
    plan: plan || null,
    planName: getNestedString(payload, 'plan', 'name') || null,
    productName: getNestedString(payload, 'product', 'name') || null,
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
    request.headers.get('x-perfect-pay-token') || '',
    request.headers.get('x-webhook-token') || '',
    bearer,
    payload.token,
    payload.public_token,
    payload.postback_token,
    payload.secret,
  ].map(getString))
}

export async function POST(request: NextRequest) {
  try {
    const payload = await readPayload(request)
    const expectedToken = (process.env.PERFECT_PAY_PUBLIC_TOKEN || '').trim()
    const receivedTokens = getReceivedTokens(request, payload)

    if (expectedToken && !receivedTokens.includes(expectedToken)) {
      return NextResponse.json({ ok: false, error: 'Token invalido.' }, { status: 401 })
    }

    if (process.env.NODE_ENV === 'production' && !expectedToken) {
      return NextResponse.json({ ok: false, error: 'Token Perfect Pay nao configurado.' }, { status: 500 })
    }

    const adminDb = getAdminDb()
    const chatId = findChatId(payload)
    const status = getStatusEnum(payload)
    const eventId = makeEventId(payload)
    const eventRef = adminDb.collection('perfectPayEvents').doc(eventId)
    const eventSnapshot = await eventRef.get()

    if (eventSnapshot.exists && eventSnapshot.data()?.processed === true) {
      return NextResponse.json({ ok: true, duplicate: true })
    }

    const eventSummary = getEventSummary(payload, chatId)
    await eventRef.set(
      {
        ...eventSummary,
        rawStatusDetail: getString(payload.sale_status_detail) || null,
        receivedAt: FieldValue.serverTimestamp(),
        processed: false,
      },
      { merge: true },
    )

    if (!chatId) {
      await eventRef.set(
        {
          unmatchedReason: 'chat_id_not_found_in_metadata',
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
    const paymentStatus = approvedStatuses.has(status)
      ? 'paid'
      : status === 5
        ? 'rejected'
        : status === 6
          ? 'cancelled'
          : status === 7
            ? 'refunded'
            : statusLabels[status] || 'pending'

    const previousPayment = chat.payment && typeof chat.payment === 'object' ? (chat.payment as JsonRecord) : {}
    const previousPaymentStatus = getString(previousPayment.status)
    const incomingIsProgressStatus =
      !approvedStatuses.has(status) &&
      paymentStatus !== 'refunded' &&
      paymentStatus !== 'cancelled' &&
      paymentStatus !== 'rejected'
    const preserveSettledPayment =
      incomingIsProgressStatus && ['paid', 'refunded', 'cancelled', 'rejected'].includes(previousPaymentStatus)

    const paymentUpdate = preserveSettledPayment
      ? {
          ...previousPayment,
          provider: 'perfect-pay',
          lastStatus: paymentStatus,
          lastCode: getString(payload.code) || null,
          lastStatusReceivedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }
      : {
          ...previousPayment,
          provider: 'perfect-pay',
          status: paymentStatus,
          code: getString(payload.code) || null,
          saleAmount: Number(payload.sale_amount) || null,
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

    if (approvedStatuses.has(status)) {
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
          ? 'Plugin ja confirmado pela Perfect Pay.'
          : 'Pagamento ja confirmado pela Perfect Pay.'
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
      chatUpdate.lastMessage = 'Pagamento reembolsado pela Perfect Pay.'
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
          ? 'Pagamento cancelado pela Perfect Pay.'
          : 'Pagamento recusado pela Perfect Pay.'
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
      approved: approvedStatuses.has(status),
    })
  } catch (error) {
    console.error('Perfect Pay webhook error:', error)
    return NextResponse.json({ ok: false, error: 'Nao foi possivel processar o webhook.' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    ok: true,
    endpoint: '/api/webhooks/perfectpay',
    postbackUrl: `${request.nextUrl.origin}/api/webhooks/perfectpay`,
  })
}
