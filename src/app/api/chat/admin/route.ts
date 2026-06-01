import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { NextRequest, NextResponse } from 'next/server'
import { isAdminUser } from '@/lib/admin-auth'
import { getAdminAuth, getAdminDb, isFirebaseAuthTokenError } from '@/lib/firebase-admin'
import { isPlanType } from '@/lib/payment-catalog'
import { loadServerPlanCatalog } from '@/lib/payment-catalog-server'

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

const defaultPaymentProvider: PaymentProvider = 'perfect-pay'

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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      idToken?: string
      chatId?: string
      action?: string
      plan?: string
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
