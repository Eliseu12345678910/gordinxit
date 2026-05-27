import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { NextRequest, NextResponse } from 'next/server'
import { isAdminUser } from '@/lib/admin-auth'
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin'

export const runtime = 'nodejs'

const validStatuses = new Set([
  'new',
  'device_selected',
  'plans_sent',
  'plan_selected',
  'payment_link_sent',
  'waiting_receipt',
  'paid',
  'activated',
  'deactivated',
  'deactivate_plan',
])

const planDurations = {
  weekly: 7,
  monthly: 30,
  lifetime: null,
} as const

const planLabels = {
  weekly: 'Semanal',
  monthly: 'Mensal',
  lifetime: 'Vitalicio',
  plugin: 'Plugin ServiceSync Core',
} as const

type PlanType = keyof typeof planDurations
type PaymentTarget = PlanType | 'plugin'
type PaymentProvider = 'perfect-pay' | 'kiwify'

const defaultPaymentProvider: PaymentProvider = 'perfect-pay'

function isPlan(value: string): value is PlanType {
  return value === 'weekly' || value === 'monthly' || value === 'lifetime'
}

function isPaymentProvider(value: string): value is PaymentProvider {
  return value === 'perfect-pay' || value === 'kiwify'
}

function expirationFor(plan: PlanType) {
  const days = planDurations[plan]
  if (!days) return null

  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + days)
  return Timestamp.fromDate(expiresAt)
}

function normalizePaymentProvider(value: unknown): PaymentProvider {
  const provider = String(value || '').trim()
  return isPaymentProvider(provider) ? provider : defaultPaymentProvider
}

function timestampMillis(value: unknown) {
  if (!value || typeof value !== 'object') return 0
  const maybeTimestamp = value as { toMillis?: () => number; seconds?: number }
  if (typeof maybeTimestamp.toMillis === 'function') return maybeTimestamp.toMillis()
  if (typeof maybeTimestamp.seconds === 'number') return maybeTimestamp.seconds * 1000
  return 0
}

async function readLatestMessage(chatRef: FirebaseFirestore.DocumentReference) {
  const latestSnapshot = await chatRef
    .collection('messages')
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get()
  const latestMessage = latestSnapshot.docs[0]

  if (!latestMessage) {
    return {
      lastMessage: '',
      lastSender: null,
      lastMessageAt: null,
    }
  }

  const data = latestMessage.data()
  return {
    lastMessage: String(data.text || ''),
    lastSender: data.sender || null,
    lastMessageAt: data.createdAt || null,
  }
}

async function getPaymentSettings(adminDb: ReturnType<typeof getAdminDb>) {
  const settingsSnapshot = await adminDb.collection('settings').doc('chat-private').get()
  const settings = settingsSnapshot.data() || {}
  return {
    liveIntroEnabled: settings.liveIntroEnabled === true,
    paymentProvider: normalizePaymentProvider(settings.paymentProvider),
  }
}

async function getAppUpdateSettings(adminDb: ReturnType<typeof getAdminDb>) {
  const settingsSnapshot = await adminDb.collection('settings').doc('app-update').get()
  const settings = settingsSnapshot.data() || {}

  return {
    latestVersionName: String(settings.latestVersionName || '1.0').trim(),
    apkUrl: String(settings.apkUrl || '').trim(),
  }
}

function addPaymentTrackingToLink(
  link: string,
  chatId: string,
  plan?: PaymentTarget,
  provider: PaymentProvider = defaultPaymentProvider,
) {
  try {
    const url = new URL(link)
    url.searchParams.set('src', chatId)
    url.searchParams.set('sck', chatId)
    url.searchParams.set('utm_source', 'gordin_du_xit')
    url.searchParams.set('utm_medium', 'chat')
    if (plan) url.searchParams.set('utm_campaign', plan)
    url.searchParams.set('utm_content', chatId)
    url.searchParams.set('s1', chatId)
    if (plan) url.searchParams.set('s2', plan)
    url.searchParams.set('s3', provider)
    return url.toString()
  } catch {
    return link
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      idToken?: string
      chatId?: string
      action?: string
      messageId?: string
      messageText?: string
      paymentLink?: string
      paymentMessage?: string
      plan?: string
      liveIntroEnabled?: boolean
      paymentProvider?: string
    }

    if (!body.idToken) {
      return NextResponse.json({ error: 'Sessao invalida.' }, { status: 401 })
    }

    const adminAuth = getAdminAuth()
    const decodedToken = await adminAuth.verifyIdToken(body.idToken)

    if (!(await isAdminUser(decodedToken.uid, decodedToken.email))) {
      return NextResponse.json({ error: 'Admin nao autorizado.' }, { status: 403 })
    }

    const adminDb = getAdminDb()
    const chatId = String(body.chatId || '').trim()
    const action = String(body.action || '').trim()

    if (!action) {
      return NextResponse.json({ error: 'Acao invalida.' }, { status: 400 })
    }

    if (action === 'get_live_intro') {
      return NextResponse.json(await getPaymentSettings(adminDb))
    }

    if (action === 'set_live_intro') {
      const liveIntroEnabled = body.liveIntroEnabled === true
      await adminDb.collection('settings').doc('chat-private').set(
        {
          liveIntroEnabled,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: decodedToken.uid,
        },
        { merge: true },
      )

      return NextResponse.json({ ok: true, liveIntroEnabled })
    }

    if (action === 'set_payment_provider') {
      const paymentProvider = normalizePaymentProvider(body.paymentProvider)
      await adminDb.collection('settings').doc('chat-private').set(
        {
          paymentProvider,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: decodedToken.uid,
        },
        { merge: true },
      )

      return NextResponse.json({ ok: true, ...(await getPaymentSettings(adminDb)) })
    }

    if (!chatId) {
      return NextResponse.json({ error: 'Acao invalida.' }, { status: 400 })
    }

    const chatRef = adminDb.collection('chats').doc(chatId)
    const chatSnapshot = await chatRef.get()

    if (!chatSnapshot.exists) {
      return NextResponse.json({ error: 'Atendimento Gordin du Xit nao encontrado.' }, { status: 404 })
    }

    const chat = chatSnapshot.data()
    const accountId = String(chat?.accountId || chat?.usernameKey || '').toLowerCase()

    if (!accountId && action !== 'edit_message' && action !== 'delete_message') {
      return NextResponse.json({ error: 'Conta nao encontrada para este atendimento.' }, { status: 400 })
    }

    if (action === 'block_account' || action === 'unblock_account') {
      const existingBlock =
        chat?.accountBlock && typeof chat.accountBlock === 'object' ? chat.accountBlock : {}
      const active = action === 'block_account'
      const accountBlock = active
        ? {
            ...existingBlock,
            active: true,
            blockedAt: FieldValue.serverTimestamp(),
            blockedBy: decodedToken.uid,
            updatedAt: FieldValue.serverTimestamp(),
          }
        : {
            ...existingBlock,
            active: false,
            unblockedAt: FieldValue.serverTimestamp(),
            unblockedBy: decodedToken.uid,
            updatedAt: FieldValue.serverTimestamp(),
          }

      await adminDb.collection('accounts').doc(accountId).set(
        {
          accountBlock,
          accessBlocked: active,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )

      await chatRef.set(
        {
          accountBlock,
          accessBlocked: active,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )

      return NextResponse.json({ ok: true, accountBlocked: active })
    }

    if (action === 'edit_message') {
      const messageId = String(body.messageId || '').trim()
      const messageText = String(body.messageText || '').trim()

      if (!messageId) {
        return NextResponse.json({ error: 'Mensagem invalida.' }, { status: 400 })
      }

      if (!messageText) {
        return NextResponse.json({ error: 'A mensagem nao pode ficar vazia.' }, { status: 400 })
      }

      const messageRef = chatRef.collection('messages').doc(messageId)
      const messageSnapshot = await messageRef.get()

      if (!messageSnapshot.exists) {
        return NextResponse.json({ error: 'Mensagem nao encontrada.' }, { status: 404 })
      }

      const message = messageSnapshot.data() || {}
      const messageCreatedAtMillis = timestampMillis(message.createdAt)
      const lastMessageAtMillis = timestampMillis(chat?.lastMessageAt)
      const isLastMessage = Boolean(messageCreatedAtMillis && messageCreatedAtMillis === lastMessageAtMillis)

      await messageRef.set(
        {
          text: messageText,
          editedAt: FieldValue.serverTimestamp(),
          editedBy: decodedToken.uid,
        },
        { merge: true },
      )

      await chatRef.set(
        {
          ...(isLastMessage ? { lastMessage: messageText } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )

      return NextResponse.json({ ok: true })
    }

    if (action === 'delete_message') {
      const messageId = String(body.messageId || '').trim()

      if (!messageId) {
        return NextResponse.json({ error: 'Mensagem invalida.' }, { status: 400 })
      }

      const messageRef = chatRef.collection('messages').doc(messageId)
      const messageSnapshot = await messageRef.get()

      if (!messageSnapshot.exists) {
        return NextResponse.json({ error: 'Mensagem nao encontrada.' }, { status: 404 })
      }

      await messageRef.delete()

      await chatRef.set(
        {
          ...(await readLatestMessage(chatRef)),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )

      return NextResponse.json({ ok: true })
    }

    if (action === 'send_plans') {
      await adminDb.collection('chats').doc(chatId).collection('messages').add({
        sender: 'admin',
        kind: 'plan_options',
        text: 'Planos do painel',
        createdAt: FieldValue.serverTimestamp(),
      })

      await chatRef.set(
        {
          funnelStatus: 'plans_sent',
          lastMessage: 'Planos enviados.',
          lastSender: 'admin',
          lastMessageAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )

      return NextResponse.json({ ok: true })
    }

    if (action === 'send_payment_link') {
      const paymentLink = String(body.paymentLink || '').trim()
      const paymentMessage = String(body.paymentMessage || '').trim()
      const plan = String(body.plan || '')
      const paymentPlan = isPlan(plan) ? plan : undefined
      const settings = await getPaymentSettings(adminDb)
      const paymentProvider = normalizePaymentProvider(body.paymentProvider || settings.paymentProvider)
      const paymentLabel = paymentPlan ? `Comprar ${planLabels[paymentPlan]}` : 'Comprar agora'
      const defaultPaymentMessage = paymentPlan
        ? `Faca o pagamento do plano ${planLabels[paymentPlan]} clicando no botao abaixo.`
        : 'Faca o pagamento clicando no botao abaixo.'
      const trackedPaymentLink = addPaymentTrackingToLink(paymentLink, chatId, paymentPlan, paymentProvider)

      if (!paymentLink) {
        return NextResponse.json({ error: 'Informe o link de pagamento.' }, { status: 400 })
      }

      await adminDb.collection('chats').doc(chatId).collection('messages').add({
        sender: 'admin',
        kind: 'payment_link',
        text: paymentMessage || defaultPaymentMessage,
        paymentLabel,
        paymentLink: trackedPaymentLink,
        ...(paymentPlan ? { paymentPlan } : {}),
        createdAt: FieldValue.serverTimestamp(),
      })

      await chatRef.set(
        {
          funnelStatus: 'payment_link_sent',
          payment: {
            provider: paymentProvider,
            link: trackedPaymentLink,
            status: 'link_sent',
            chatId,
            ...(paymentPlan ? { plan: paymentPlan } : {}),
          },
          lastMessage: 'Link de pagamento enviado.',
          lastSender: 'admin',
          lastMessageAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )

      return NextResponse.json({ ok: true })
    }

    if (action === 'send_plugin_payment_link') {
      const paymentLink = String(body.paymentLink || '').trim()
      const settings = await getPaymentSettings(adminDb)
      const paymentProvider = normalizePaymentProvider(body.paymentProvider || settings.paymentProvider)
      const trackedPaymentLink = addPaymentTrackingToLink(paymentLink, chatId, 'plugin', paymentProvider)

      if (!paymentLink) {
        return NextResponse.json({ error: 'Informe o link de pagamento do plugin.' }, { status: 400 })
      }

      await adminDb.collection('chats').doc(chatId).collection('messages').add({
        sender: 'admin',
        kind: 'plugin_payment_link',
        text: 'O ServiceSync Core libera o uso vitalicio do xit nesta conta.',
        paymentLabel: 'Adquirir plugin',
        paymentLink: trackedPaymentLink,
        paymentPlan: 'plugin',
        createdAt: FieldValue.serverTimestamp(),
      })

      await chatRef.set(
        {
          funnelStatus: 'payment_link_sent',
          payment: {
            provider: paymentProvider,
            link: trackedPaymentLink,
            status: 'link_sent',
            chatId,
            plan: 'plugin',
            label: 'Adquirir plugin',
          },
          lastMessage: 'Link do plugin enviado.',
          lastSender: 'admin',
          lastMessageAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )

      return NextResponse.json({ ok: true })
    }

    if (action === 'send_plugin_diagnostic') {
      const username = String(chat?.accessUsername || chat?.usernameKey || accountId || 'mano')

      await adminDb.collection('chats').doc(chatId).collection('messages').add({
        sender: 'admin',
        kind: 'plugin_diagnostic',
        text: username,
        createdAt: FieldValue.serverTimestamp(),
      })

      await chatRef.set(
        {
          lastMessage: 'Diagnostico tecnico do plugin enviado.',
          lastSender: 'admin',
          lastMessageAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )

      return NextResponse.json({ ok: true })
    }

    if (action === 'send_app_download_link') {
      const username = String(chat?.accessUsername || chat?.usernameKey || accountId || 'mano')
      const appSettings = await getAppUpdateSettings(adminDb)

      if (!appSettings.apkUrl) {
        return NextResponse.json(
          { error: 'Cadastre o link do APK na atualizacao do app antes de enviar o botao.' },
          { status: 400 },
        )
      }

      await adminDb.collection('chats').doc(chatId).collection('messages').add({
        sender: 'admin',
        kind: 'app_download_link',
        text: `Aqui esta o seu xit, meu mano ${username}.`,
        downloadLabel: 'ABAIXAR',
        downloadLink: appSettings.apkUrl,
        appVersionName: appSettings.latestVersionName,
        appName: 'Gordin du Xit',
        createdAt: FieldValue.serverTimestamp(),
      })

      await chatRef.set(
        {
          lastMessage: 'Download do app enviado.',
          lastSender: 'admin',
          lastMessageAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )

      return NextResponse.json({ ok: true })
    }

    if (action === 'activate_plugin') {
      const plugin = {
        name: 'ServiceSync Core',
        status: 'active',
        included: true,
        activatedAt: FieldValue.serverTimestamp(),
      }

      await adminDb.collection('accounts').doc(accountId).set(
        {
          plugin,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )

      await chatRef.set(
        {
          plugin,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )

      return NextResponse.json({ ok: true })
    }

    if (action === 'set_plugin_included' || action === 'set_plugin_not_included') {
      const included = action === 'set_plugin_included'
      const existingPlugin = chat?.plugin && typeof chat.plugin === 'object' ? chat.plugin : {}
      const plugin = {
        ...existingPlugin,
        name: 'ServiceSync Core',
        included,
        ...(included ? {} : { status: 'inactive' }),
        updatedAt: FieldValue.serverTimestamp(),
      }

      await adminDb.collection('accounts').doc(accountId).set(
        {
          plugin,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )

      await chatRef.set(
        {
          plugin,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )

      return NextResponse.json({ ok: true })
    }

    if (!validStatuses.has(action)) {
      return NextResponse.json({ error: 'Status invalido.' }, { status: 400 })
    }

    const chatUpdate: Record<string, unknown> = {
      funnelStatus: action,
      updatedAt: FieldValue.serverTimestamp(),
    }
    const accountUpdate: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    }

    if (action === 'paid') {
      chatUpdate.payment = {
        ...(chat?.payment || {}),
        status: 'paid',
        paidAt: FieldValue.serverTimestamp(),
      }
      accountUpdate.payment = {
        status: 'paid',
        paidAt: FieldValue.serverTimestamp(),
      }
    }

    if (action === 'activated') {
      const plan = String(body.plan || chat?.selectedPlan?.plan || '')

      if (!isPlan(plan)) {
        return NextResponse.json({ error: 'Escolha um plano antes de ativar.' }, { status: 400 })
      }

      const expiresAt = expirationFor(plan)
      const subscription = {
        plan,
        status: 'active',
        activatedAt: FieldValue.serverTimestamp(),
        expiresAt,
      }

      chatUpdate.subscription = subscription
      accountUpdate.subscription = subscription
    }

    if (action === 'deactivate_plan' || action === 'deactivated') {
      chatUpdate.funnelStatus = 'deactivated'
      chatUpdate.subscription = {
        ...(chat?.subscription || {}),
        status: 'inactive',
        deactivatedAt: FieldValue.serverTimestamp(),
      }
      accountUpdate.subscription = {
        status: 'inactive',
        deactivatedAt: FieldValue.serverTimestamp(),
      }
    }

    await adminDb.collection('accounts').doc(accountId).set(accountUpdate, { merge: true })
    await chatRef.set(chatUpdate, { merge: true })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Chat admin action error:', error)
    return NextResponse.json({ error: 'Nao foi possivel atualizar o atendimento Gordin du Xit.' }, { status: 500 })
  }
}
