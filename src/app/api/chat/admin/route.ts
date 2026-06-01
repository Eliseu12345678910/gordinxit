import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { NextRequest, NextResponse } from 'next/server'
import { isAdminUser } from '@/lib/admin-auth'
import { getAdminAuth, getAdminDb, isFirebaseAuthTokenError } from '@/lib/firebase-admin'
import { formatCurrencyFromCents, isPlanType } from '@/lib/payment-catalog'
import { loadServerPlanCatalog, loadServerResellerPlanCatalog } from '@/lib/payment-catalog-server'

export const runtime = 'nodejs'

const validStatuses = new Set([
  'new',
  'device_selected',
  'plan_selected',
  'waiting_receipt',
  'paid',
  'activated',
  'deactivated',
  'deactivate_plan',
])

const planLabels: Record<PlanType | 'plugin', string> = {
  daily: 'Diario',
  weekly: 'Semanal',
  monthly: 'Mensal',
  lifetime: 'Vitalicio',
  plugin: 'Plugin ServiceSync Core',
}

type PlanType = 'daily' | 'weekly' | 'monthly' | 'lifetime'
type PaymentProvider = 'perfect-pay' | 'kiwify' | 'mercado-pago'
type PriceContext = 'gordin' | 'internal' | 'external'

const defaultPaymentProvider: PaymentProvider = 'perfect-pay'
const planOrder: PlanType[] = ['daily', 'weekly', 'monthly', 'lifetime']

function isPlan(value: string): value is PlanType {
  return isPlanType(value)
}

function isPaymentProvider(value: string): value is PaymentProvider {
  return value === 'perfect-pay' || value === 'kiwify' || value === 'mercado-pago'
}

function expirationFor(days: number | null) {
  if (!days) return null

  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + days)
  return Timestamp.fromDate(expiresAt)
}

function normalizePaymentProvider(value: unknown): PaymentProvider {
  const provider = String(value || '').trim()
  return isPaymentProvider(provider) ? provider : defaultPaymentProvider
}

async function getPaymentSettings(adminDb: ReturnType<typeof getAdminDb>) {
  const settingsSnapshot = await adminDb.collection('settings').doc('chat-private').get()
  const settings = settingsSnapshot.data() || {}
  return {
    paymentProvider: normalizePaymentProvider(settings.paymentProvider),
  }
}

async function getPriceSettings(adminDb: ReturnType<typeof getAdminDb>) {
  const [gordinCatalog, resellerCatalog] = await Promise.all([
    loadServerPlanCatalog(adminDb),
    loadServerResellerPlanCatalog(adminDb),
  ])

  return {
    gordin: planOrder.reduce((result, plan) => {
      result[plan] = {
        label: gordinCatalog[plan].label,
        amountCents: gordinCatalog[plan].amountCents,
        priceLabel: gordinCatalog[plan].priceLabel,
        normalPriceLabel: gordinCatalog[plan].normalPriceLabel,
        durationDays: gordinCatalog[plan].durationDays,
        perfectPayLink: gordinCatalog[plan].perfectPayLink,
      }
      return result
    }, {} as Record<PlanType, Record<string, unknown>>),
    internal: planOrder.reduce((result, plan) => {
      result[plan] = {
        label: resellerCatalog.internal[plan].label,
        amountCents: resellerCatalog.internal[plan].amountCents,
        priceLabel: resellerCatalog.internal[plan].priceLabel,
        normalPriceLabel: resellerCatalog.internal[plan].normalPriceLabel,
        durationDays: resellerCatalog.internal[plan].durationDays,
      }
      return result
    }, {} as Record<PlanType, Record<string, unknown>>),
    external: planOrder.reduce((result, plan) => {
      result[plan] = {
        label: resellerCatalog.external[plan].label,
        amountCents: resellerCatalog.external[plan].amountCents,
        priceLabel: resellerCatalog.external[plan].priceLabel,
        normalPriceLabel: resellerCatalog.external[plan].normalPriceLabel,
        durationDays: resellerCatalog.external[plan].durationDays,
      }
      return result
    }, {} as Record<PlanType, Record<string, unknown>>),
  }
}

function cleanAmountCents(value: unknown) {
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric < 100 || numeric > 100000) return null
  return numeric
}

function cleanPlanPrice(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const data = raw as Record<string, unknown>
  const amountCents = cleanAmountCents(data.amountCents)
  if (!amountCents) return null

  return {
    amountCents,
    price: amountCents / 100,
    priceLabel: formatCurrencyFromCents(amountCents),
  }
}

function cleanPriceContext(raw: unknown) {
  const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  return planOrder.reduce((result, plan) => {
    const clean = cleanPlanPrice(data[plan])
    if (clean) result[plan] = clean
    return result
  }, {} as Partial<Record<PlanType, ReturnType<typeof cleanPlanPrice>>>)
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      idToken?: string
      chatId?: string
      action?: string
      plan?: string
      paymentProvider?: string
      priceSettings?: unknown
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
    const planCatalog = await loadServerPlanCatalog(adminDb)
    Object.values(planCatalog).forEach((plan) => {
      planLabels[plan.value] = plan.label
    })
    const chatId = String(body.chatId || '').trim()
    const action = String(body.action || '').trim()

    if (!action) {
      return NextResponse.json({ error: 'Acao invalida.' }, { status: 400 })
    }

    if (action === 'get_payment_settings') {
      return NextResponse.json(await getPaymentSettings(adminDb))
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

    if (action === 'get_price_settings') {
      return NextResponse.json(await getPriceSettings(adminDb))
    }

    if (action === 'set_price_settings') {
      const bodySettings = body.priceSettings && typeof body.priceSettings === 'object'
        ? body.priceSettings as Record<PriceContext, unknown>
        : {} as Partial<Record<PriceContext, unknown>>
      const gordin = cleanPriceContext(bodySettings.gordin)
      const internal = cleanPriceContext(bodySettings.internal)
      const external = cleanPriceContext(bodySettings.external)

      await Promise.all([
        adminDb.collection('settings').doc('payment-plans').set(
          {
            plans: gordin,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: decodedToken.uid,
          },
          { merge: true },
        ),
        adminDb.collection('settings').doc('reseller-payment-plans').set(
          {
            internal,
            external,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: decodedToken.uid,
          },
          { merge: true },
        ),
      ])

      return NextResponse.json({ ok: true, ...(await getPriceSettings(adminDb)) })
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

    if (!accountId) {
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

      const expiresAt = expirationFor(planCatalog[plan].durationDays)
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
    if (isFirebaseAuthTokenError(error)) {
      return NextResponse.json({ error: 'Sessao invalida.' }, { status: 401 })
    }
    console.error('Chat admin action error:', error)
    return NextResponse.json({ error: 'Nao foi possivel atualizar o atendimento Gordin du Xit.' }, { status: 500 })
  }
}
