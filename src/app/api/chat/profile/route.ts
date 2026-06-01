import { FieldValue, type DocumentReference } from 'firebase-admin/firestore'
import { NextRequest, NextResponse } from 'next/server'
import { isAccountAccessBlocked } from '@/lib/account-block'
import { getAdminAuth, getAdminDb, isFirebaseAuthTokenError } from '@/lib/firebase-admin'
import { isPlanType } from '@/lib/payment-catalog'
import { loadServerPlanCatalog } from '@/lib/payment-catalog-server'

export const runtime = 'nodejs'

const deviceLabels = {
  android: 'Android',
  ios: 'iOS',
  emulator: 'Emulador (PC)',
} as const

type DeviceType = keyof typeof deviceLabels
type PlanType = 'daily' | 'weekly' | 'monthly' | 'lifetime'
type PaymentProvider = 'perfect-pay' | 'kiwify' | 'mercado-pago'
type ClientActivityType =
  | 'device_selected'
  | 'device_changed'
  | 'plan_selected'
  | 'payment_opened'
  | 'button_clicked'

const activityTypes = new Set<ClientActivityType>([
  'device_selected',
  'device_changed',
  'plan_selected',
  'payment_opened',
  'button_clicked',
])

function isDevice(value: string): value is DeviceType {
  return value === 'android' || value === 'ios' || value === 'emulator'
}

function isPlan(value: string): value is PlanType {
  return isPlanType(value)
}

function inferPaymentProvider(link: string, explicit?: string): PaymentProvider {
  if (explicit === 'kiwify' || explicit === 'perfect-pay' || explicit === 'mercado-pago') return explicit
  const normalizedLink = link.toLowerCase()
  if (normalizedLink.includes('kiwify')) return 'kiwify'
  if (normalizedLink.includes('mercadopago') || normalizedLink.includes('mercado-pago')) return 'mercado-pago'
  return 'perfect-pay'
}

function isActivityType(value: string): value is ClientActivityType {
  return activityTypes.has(value as ClientActivityType)
}

function cleanActivityKey(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 90) || 'activity'
}

function cleanActivityMeta(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  const meta: Record<string, string | number | boolean | null> = {}
  Object.entries(value as Record<string, unknown>).slice(0, 12).forEach(([rawKey, rawValue]) => {
    const key = cleanActivityKey(rawKey)
    if (
      typeof rawValue === 'string' ||
      typeof rawValue === 'number' ||
      typeof rawValue === 'boolean' ||
      rawValue === null
    ) {
      meta[key] = rawValue
    }
  })

  return Object.keys(meta).length ? meta : undefined
}

async function logClientActivity({
  chatRef,
  chatUpdate,
  type,
  label,
  key,
  meta,
}: {
  chatRef: DocumentReference
  chatUpdate: Record<string, unknown>
  type: ClientActivityType
  label: string
  key?: string
  meta?: Record<string, string | number | boolean | null>
}) {
  const cleanLabel = label.trim().slice(0, 160) || 'Acao do cliente'
  const activityKey = cleanActivityKey(key || `${type}_${cleanLabel}`)
  const summary = {
    type,
    label: cleanLabel,
    count: FieldValue.increment(1),
    lastAt: FieldValue.serverTimestamp(),
  }
  const lastActivity = {
    type,
    label: cleanLabel,
    count: 1,
    lastAt: FieldValue.serverTimestamp(),
  }

  await chatRef.collection('activity').add({
    type,
    key: activityKey,
    label: cleanLabel,
    ...(meta ? { meta } : {}),
    createdAt: FieldValue.serverTimestamp(),
  })

  chatUpdate.activitySummary = {
    ...((chatUpdate.activitySummary as Record<string, unknown> | undefined) || {}),
    [activityKey]: summary,
  }
  chatUpdate.lastClientActivity = lastActivity
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      idToken?: string
      chatId?: string
      accountId?: string
      device?: string
      plan?: string
      paymentAction?: string
      paymentPlan?: string
      paymentLink?: string
      paymentLabel?: string
      paymentProvider?: string
      activityAction?: string
      activityType?: string
      activityLabel?: string
      activityKey?: string
      activityMeta?: unknown
    }

    if (!body.idToken) {
      return NextResponse.json({ error: 'Sessao invalida.' }, { status: 401 })
    }

    const chatId = String(body.chatId || '').trim()
    const accountId = String(body.accountId || '').trim().toLowerCase()
    const device = String(body.device || '')
    const plan = String(body.plan || '')

    const isPaymentAction = body.paymentAction === 'opened_payment'
    const isActivityAction =
      body.activityAction === 'client_activity' && isActivityType(String(body.activityType || ''))

    if (
      !chatId ||
      !accountId ||
      (
        !isDevice(device) &&
        !isPlan(plan) &&
        !isPaymentAction &&
        !isActivityAction
      )
    ) {
      return NextResponse.json({ error: 'Escolha invalida.' }, { status: 400 })
    }

    const adminAuth = getAdminAuth()
    const adminDb = getAdminDb()
    const planCatalog = await loadServerPlanCatalog(adminDb)
    const decodedToken = await adminAuth.verifyIdToken(body.idToken)
    const uid = decodedToken.uid
    const chatRef = adminDb.collection('chats').doc(chatId)
    const chatSnapshot = await chatRef.get()

    if (!chatSnapshot.exists) {
      return NextResponse.json({ error: 'Atendimento Gordin du Xit nao encontrado.' }, { status: 404 })
    }

    const chat = chatSnapshot.data()
    const participants = Array.isArray(chat?.participantUids) ? chat?.participantUids : []

    const chatAccountId = String(chat?.accountId || chat?.usernameKey || '').toLowerCase()
    const normalizedAccountId = accountId.toLowerCase()
    const accountSnapshot = await adminDb.collection('accounts').doc(normalizedAccountId).get()

    // Verifica se usuario tem permissao: precisa ser o dono (accountId) OU estar na lista de participantes
    const isAccountOwner = chatAccountId && chatAccountId === normalizedAccountId
    const isParticipant = participants.includes(uid)

    if (!isAccountOwner && !isParticipant) {
      return NextResponse.json({ error: 'Voce nao pode alterar este atendimento.' }, { status: 403 })
    }

    if (isAccountAccessBlocked(chat) || isAccountAccessBlocked(accountSnapshot.data())) {
      return NextResponse.json({ error: 'Pagina nao encontrada.', code: 'account_blocked' }, { status: 404 })
    }

    const accountUpdate: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    }
    const chatUpdate: Record<string, unknown> = {
      accountId,
      participantUids: FieldValue.arrayUnion(uid),
      updatedAt: FieldValue.serverTimestamp(),
    }

    if (isDevice(device)) {
      const deviceLabel = deviceLabels[device]
      const previousDevice = String(chat?.leadProfile?.device || '')
      const previousLabel = isDevice(previousDevice) ? deviceLabels[previousDevice] : ''
      if (previousLabel && previousDevice !== device) {
        return NextResponse.json(
          { error: `Este numero ja pertence ao dispositivo ${previousLabel} e nao da para alterar. Se quiser alterar, use outro numero.` },
          { status: 409 },
        )
      }
      const changedDevice = Boolean(previousLabel && previousDevice !== device)

      accountUpdate.profile = {
        ...(chat?.leadProfile || {}),
        device,
        deviceLabel,
        ...(chat?.leadProfile?.deviceSelectedAt ? {} : { deviceSelectedAt: FieldValue.serverTimestamp() }),
      }
      chatUpdate.leadProfile = {
        ...(chat?.leadProfile || {}),
        device,
        deviceLabel,
        ...(chat?.leadProfile?.deviceSelectedAt ? {} : { deviceSelectedAt: FieldValue.serverTimestamp() }),
      }
      chatUpdate.funnelStatus = 'device_selected'

      await logClientActivity({
        chatRef,
        chatUpdate,
        type: changedDevice ? 'device_changed' : 'device_selected',
        key: changedDevice ? `device_changed_${device}` : `device_selected_${device}`,
        label: changedDevice
          ? `Trocou dispositivo de ${previousLabel} para ${deviceLabel}`
          : `Escolheu dispositivo ${deviceLabel}`,
        meta: {
          device,
          deviceLabel,
          ...(changedDevice ? { previousDevice, previousLabel } : {}),
        },
      })
    }

    if (isPlan(plan)) {
      const planCatalogItem = planCatalog[plan]
      const selectedPlan = {
        plan,
        label: planCatalogItem.label,
        price: planCatalogItem.price,
        priceLabel: planCatalogItem.priceLabel,
      }
      accountUpdate.purchaseIntent = selectedPlan
      chatUpdate.selectedPlan = selectedPlan
      chatUpdate.funnelStatus = 'plan_selected'

      await logClientActivity({
        chatRef,
        chatUpdate,
        type: 'plan_selected',
        key: `plan_selected_${plan}`,
        label: `Escolheu plano ${selectedPlan.label}`,
        meta: {
          plan,
          priceLabel: selectedPlan.priceLabel,
        },
      })
    }

    if (isPaymentAction) {
      const paymentLink = String(body.paymentLink || '').trim()
      const paymentLabel = String(body.paymentLabel || 'Comprar agora').trim()
      const paymentProvider = inferPaymentProvider(paymentLink, body.paymentProvider)

      if (!paymentLink) {
        return NextResponse.json({ error: 'Link de pagamento invalido.' }, { status: 400 })
      }

      chatUpdate.funnelStatus = 'waiting_receipt'
      chatUpdate.payment = {
        provider: paymentProvider,
        link: paymentLink,
        label: paymentLabel,
        ...(body.paymentPlan ? { plan: String(body.paymentPlan) } : {}),
        status: 'opened',
        openedAt: FieldValue.serverTimestamp(),
      }
      chatUpdate.lastMessage = 'Cliente abriu o pagamento.'
      chatUpdate.lastSender = 'client'
      chatUpdate.lastMessageAt = FieldValue.serverTimestamp()
      accountUpdate.payment = {
        status: 'opened',
        link: paymentLink,
        label: paymentLabel,
        openedAt: FieldValue.serverTimestamp(),
      }

      await logClientActivity({
        chatRef,
        chatUpdate,
        type: 'payment_opened',
        key: `payment_opened_${body.paymentPlan || 'manual'}`,
        label: `Abriu pagamento: ${paymentLabel}`,
        meta: {
        paymentLabel,
        paymentLink,
        paymentProvider,
        ...(body.paymentPlan ? { plan: String(body.paymentPlan) } : {}),
      },
      })
    }

    if (isActivityAction) {
      const activityType = String(body.activityType) as ClientActivityType
      const activityLabel = String(body.activityLabel || 'Acao do cliente').trim()
      const activityKey = String(body.activityKey || activityType).trim()

      await logClientActivity({
        chatRef,
        chatUpdate,
        type: activityType,
        key: activityKey,
        label: activityLabel,
        meta: cleanActivityMeta(body.activityMeta),
      })
    }

    await adminDb.collection('accounts').doc(accountId).set(accountUpdate, { merge: true })
    await chatRef.set(chatUpdate, { merge: true })

    return NextResponse.json({ ok: true })
  } catch (error) {
    if (isFirebaseAuthTokenError(error)) {
      return NextResponse.json({ error: 'Sessao invalida.' }, { status: 401 })
    }
    console.error('Chat profile error:', error)
    return NextResponse.json({ error: 'Nao foi possivel salvar sua escolha.' }, { status: 500 })
  }
}
