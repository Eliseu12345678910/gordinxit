import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
} from 'firebase/firestore'
import { signInAnonymously } from 'firebase/auth'
import { auth, db } from './firebase'
import { defaultPlanCatalog, isPlanType, planCatalogToOptions } from './payment-catalog'
import { getSecureItem, listStorageKeys, removeSecureItem, setSecureItem } from './secure-storage'
import type {
  AdminSettings,
  Chat,
  ClientActivity,
  ClientActivityType,
  DeviceType,
  FunnelStatus,
  PlanType,
  PaymentProvider,
  PaymentTarget,
} from '@/types/chat'

const CHAT_ID_KEY = 'chat-atendimento-id-v3'
const CLIENT_ID_KEY = 'chat-atendimento-client-id-v3'
const USERNAME_KEY = 'chat-atendimento-username-v3'
const ACCOUNT_ID_KEY = 'chat-atendimento-account-id-v3'
const DEVICE_KEY_PREFIX = 'chat-atendimento-device-v3'
const PLAN_KEY_PREFIX = 'chat-atendimento-plan-v3'
const BLOCKED_ACCOUNT_KEY = 'chat-atendimento-account-blocked-v1'
const kiwifyPluginLink = 'https://pay.kiwify.com.br/uOARny8'

export const deviceOptions: Array<{
  value: DeviceType
  label: string
  detail: string
  icon: 'android' | 'ios' | 'desktop'
}> = [
  {
    value: 'android',
    label: 'Android',
    detail: 'Celular Android',
    icon: 'android',
  },
  {
    value: 'ios',
    label: 'iOS',
    detail: 'iPhone ou iPad',
    icon: 'ios',
  },
  {
    value: 'emulator',
    label: 'Emulador',
    detail: 'PC ou notebook',
    icon: 'desktop',
  },
]

export const planOptions: Array<{
  value: PlanType
  label: string
  price: number
  priceLabel: string
  badge: string
  detail: string
}> = planCatalogToOptions(defaultPlanCatalog)

export const paymentLinks: Record<PlanType, string> = {
  daily: defaultPlanCatalog.daily.perfectPayLink,
  weekly: defaultPlanCatalog.weekly.perfectPayLink,
  monthly: defaultPlanCatalog.monthly.perfectPayLink,
  lifetime: defaultPlanCatalog.lifetime.perfectPayLink,
}

export const paymentProviderLabels: Record<PaymentProvider, string> = {
  'perfect-pay': 'Perfect Pay',
  kiwify: 'Kiwify',
  'mercado-pago': 'Mercado Pago',
}

export const paymentLinksByProvider: Record<PaymentProvider, Record<PlanType, string>> = {
  'perfect-pay': paymentLinks,
  kiwify: {
    daily: process.env.NEXT_PUBLIC_KIWIFY_DAILY_LINK || '',
    weekly: process.env.NEXT_PUBLIC_KIWIFY_WEEKLY_LINK || '',
    monthly: process.env.NEXT_PUBLIC_KIWIFY_MONTHLY_LINK || '',
    lifetime: process.env.NEXT_PUBLIC_KIWIFY_LIFETIME_LINK || '',
  },
  'mercado-pago': {
    daily: '',
    weekly: '',
    monthly: '',
    lifetime: '',
  },
}

export const pluginPaymentLinksByProvider: Record<PaymentProvider, string> = {
  'perfect-pay':
    process.env.NEXT_PUBLIC_PERFECT_PAY_PLUGIN_LINK ||
    process.env.NEXT_PUBLIC_KIWIFY_PLUGIN_LINK ||
    kiwifyPluginLink,
  kiwify: process.env.NEXT_PUBLIC_KIWIFY_PLUGIN_LINK || kiwifyPluginLink,
  'mercado-pago': '',
}

export function isPaymentProvider(value: unknown): value is PaymentProvider {
  return value === 'perfect-pay' || value === 'kiwify' || value === 'mercado-pago'
}

export function getPaymentLinks(provider?: PaymentProvider) {
  return paymentLinksByProvider[provider || 'perfect-pay']
}

export function getPluginPaymentLink(provider?: PaymentProvider) {
  return pluginPaymentLinksByProvider[provider || 'perfect-pay']
}

export function addPaymentTrackingToLink(
  link: string,
  chatId: string,
  plan?: PaymentTarget,
  provider: PaymentProvider = 'perfect-pay',
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

export const savedReplies = [
  'Depois do pagamento eu libero seu acesso imediatamente no Gordin du Xit e te envio os tutoriais de download, instalacao e uso.',
  'Fechado, mano. Me fala se voce vai usar no Android, iOS ou emulador que eu te direciono certinho.',
  'Funciona em Android, iOS e emulador. Depois do pagamento eu libero os tutoriais de download, instalacao e uso no Gordin du Xit.',
  'A instalacao e simples. Eu te mando o passo a passo e fico aqui ate voce conseguir abrir tudo.',
  'Tem garantia de 7 dias caso apresente mau funcionamento e eu nao consiga resolver.',
  'Me manda o comprovante por aqui que eu confiro e libero seu acesso.',
  'Se for usar em outro celular, me avisa antes para eu te orientar do jeito certo.',
]

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase()
}

export function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function isDeviceType(value: unknown): value is DeviceType {
  return value === 'android' || value === 'ios' || value === 'emulator'
}

function normalizeAccessProfile(profile?: { device?: unknown; plan?: unknown }) {
  return {
    device: isDeviceType(profile?.device) ? profile.device : undefined,
    plan: isPlanType(profile?.plan) ? profile.plan : undefined,
  }
}

export function getStoredChatId() {
  return getSecureItem(CHAT_ID_KEY)
}

export function storeChatId(chatId: string) {
  setSecureItem(CHAT_ID_KEY, chatId)
}

export function getStoredUsername() {
  return getSecureItem(USERNAME_KEY) || ''
}

export function storeUsername(username: string) {
  setSecureItem(USERNAME_KEY, username)
}

export function getStoredAccountId() {
  return getSecureItem(ACCOUNT_ID_KEY) || ''
}

export function storeAccountId(accountId: string) {
  setSecureItem(ACCOUNT_ID_KEY, accountId)
}

export function getStoredAccountBlocked() {
  return getSecureItem(BLOCKED_ACCOUNT_KEY) === '1'
}

export function storeAccountBlocked(blocked: boolean) {
  if (blocked) {
    setSecureItem(BLOCKED_ACCOUNT_KEY, '1')
  } else {
    removeSecureItem(BLOCKED_ACCOUNT_KEY)
  }
}

export function getStoredDevice(chatId: string) {
  if (typeof window === 'undefined' || !chatId) return ''
  const device = getSecureItem(`${DEVICE_KEY_PREFIX}-${chatId}`)
  return isDeviceType(device) ? device : ''
}

export function storeDevice(chatId: string, device: DeviceType) {
  setSecureItem(`${DEVICE_KEY_PREFIX}-${chatId}`, device)
}

export function getStoredPlan(chatId: string) {
  if (typeof window === 'undefined' || !chatId) return ''
  const plan = getSecureItem(`${PLAN_KEY_PREFIX}-${chatId}`)
  return isPlanType(plan) ? plan : ''
}

export function storePlan(chatId: string, plan: PlanType) {
  setSecureItem(`${PLAN_KEY_PREFIX}-${chatId}`, plan)
}

export function clearClientSession() {
  if (typeof window === 'undefined') return

  const prefixes = [
    CHAT_ID_KEY,
    CLIENT_ID_KEY,
    USERNAME_KEY,
    ACCOUNT_ID_KEY,
    DEVICE_KEY_PREFIX,
    PLAN_KEY_PREFIX,
  ]

  listStorageKeys().forEach((key) => {
    if (prefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}-`))) {
      removeSecureItem(key)
    }
  })
}

export function getClientId() {
  const existing = getSecureItem(CLIENT_ID_KEY)
  if (existing) return existing

  const clientId = makeId('client')
  setSecureItem(CLIENT_ID_KEY, clientId)
  return clientId
}

export async function ensureAnonymousSession() {
  if (auth.currentUser) return auth.currentUser
  const result = await signInAnonymously(auth)
  return result.user
}

export async function checkClientSessionAccess() {
  const user = await ensureAnonymousSession()
  const idToken = await user.getIdToken()

  const response = await fetch('/api/chat/session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idToken,
      chatId: getStoredChatId(),
      accountId: getStoredAccountId(),
    }),
  })

  const payload = (await response.json()) as { blocked?: boolean; code?: string; error?: string }

  if (response.status === 404 && (payload.blocked || payload.code === 'account_blocked')) {
    storeAccountBlocked(true)
    return { blocked: true }
  }

  if (!response.ok) {
    throw new ChatAccessError(payload.error || 'Nao foi possivel validar a sessao.', payload.code)
  }

  storeAccountBlocked(false)
  return { blocked: false }
}

export class ChatAccessError extends Error {
  code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'ChatAccessError'
    this.code = code
  }
}

export async function requestChatAccess({
  username,
  password,
  device,
  mode,
  clientId,
  requestedChatId,
}: {
  username: string
  password?: string
  device?: DeviceType
  mode: 'login' | 'signup'
  clientId: string
  requestedChatId?: string
}) {
  const user = await ensureAnonymousSession()
  const idToken = await user.getIdToken()

  const response = await fetch('/api/chat/access', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idToken,
      username,
      password,
      device,
      mode,
      clientId,
      requestedChatId,
    }),
  })

  const payload = (await response.json()) as {
    chatId?: string
    accountId?: string
    recovered?: boolean
    accessUsername?: string
    profile?: {
      device?: unknown
      plan?: unknown
    }
    code?: string
    error?: string
  }

  if (!response.ok || !payload.chatId) {
    throw new ChatAccessError(payload.error || 'Nao foi possivel validar o acesso.', payload.code)
  }

  return {
    chatId: payload.chatId,
    accountId: payload.accountId || normalizeUsername(username),
    recovered: Boolean(payload.recovered),
    accessUsername: payload.accessUsername || username,
    profile: normalizeAccessProfile(payload.profile),
  }
}

export async function saveDeviceSelection({
  chatId,
  accountId,
  device,
}: {
  chatId: string
  accountId: string
  device: DeviceType
}) {
  const user = await ensureAnonymousSession()
  const idToken = await user.getIdToken()

  const response = await fetch('/api/chat/profile', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idToken,
      chatId,
      accountId,
      device,
    }),
  })

  const payload = (await response.json()) as { error?: string }

  if (!response.ok) {
    throw new Error(payload.error || 'Nao foi possivel salvar sua escolha.')
  }
}

export async function savePlanSelection({
  chatId,
  accountId,
  plan,
}: {
  chatId: string
  accountId: string
  plan: PlanType
}) {
  const user = await ensureAnonymousSession()
  const idToken = await user.getIdToken()

  const response = await fetch('/api/chat/profile', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idToken,
      chatId,
      accountId,
      plan,
    }),
  })

  const payload = (await response.json()) as { error?: string }

  if (!response.ok) {
    throw new Error(payload.error || 'Nao foi possivel salvar o plano.')
  }
}

export async function registerPaymentClick({
  chatId,
  accountId,
  plan,
  paymentLink,
  paymentLabel,
  paymentProvider,
}: {
  chatId: string
  accountId: string
  plan?: PaymentTarget
  paymentLink: string
  paymentLabel: string
  paymentProvider?: PaymentProvider
}) {
  const user = await ensureAnonymousSession()
  const idToken = await user.getIdToken()

  const response = await fetch('/api/chat/profile', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idToken,
      chatId,
      accountId,
      plan,
      paymentAction: 'opened_payment',
      paymentPlan: plan,
      paymentLink,
      paymentLabel,
      paymentProvider,
    }),
  })

  const payload = (await response.json()) as { error?: string }

  if (!response.ok) {
    throw new Error(payload.error || 'Nao foi possivel registrar o pagamento.')
  }
}

export async function registerClientActivity({
  chatId,
  accountId,
  type,
  label,
  key,
  meta,
}: {
  chatId: string
  accountId: string
  type: ClientActivityType
  label: string
  key?: string
  meta?: Record<string, string | number | boolean | null | undefined>
}) {
  const user = await ensureAnonymousSession()
  const idToken = await user.getIdToken()

  const response = await fetch('/api/chat/profile', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idToken,
      chatId,
      accountId,
      activityAction: 'client_activity',
      activityType: type,
      activityLabel: label,
      activityKey: key,
      activityMeta: meta,
    }),
  })

  const payload = (await response.json()) as { error?: string }

  if (!response.ok) {
    throw new Error(payload.error || 'Nao foi possivel registrar a atividade.')
  }
}

export async function updateChatFunnel({
  chatId,
  action,
  paymentLink,
  paymentMessage,
  plan,
  paymentProvider,
}: {
  chatId: string
  action:
    | FunnelStatus
    | 'deactivate_plan'
    | 'activate_plugin'
    | 'set_plugin_included'
    | 'set_plugin_not_included'
    | 'block_account'
    | 'unblock_account'
  paymentLink?: string
  paymentMessage?: string
  plan?: PlanType
  paymentProvider?: PaymentProvider
}) {
  const user = auth.currentUser
  if (!user || user.isAnonymous) throw new Error('Admin nao autenticado.')

  const idToken = await user.getIdToken()
  const response = await fetch('/api/chat/admin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idToken,
      chatId,
      action,
      paymentLink,
      paymentMessage,
      plan,
      paymentProvider,
    }),
  })

  const payload = (await response.json()) as { error?: string }

  if (!response.ok) {
    throw new Error(payload.error || 'Nao foi possivel atualizar o atendimento do Gordin du Xit.')
  }
}

async function requestAdminSettingsAction(
  action: 'get_payment_settings' | 'set_payment_provider',
  paymentProvider?: PaymentProvider,
) {
  const user = auth.currentUser
  if (!user || user.isAnonymous) throw new Error('Admin nao autenticado.')

  const idToken = await user.getIdToken()
  const response = await fetch('/api/chat/admin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idToken,
      action,
      paymentProvider,
    }),
  })

  const payload = (await response.json()) as AdminSettings & { error?: string }

  if (!response.ok) {
    throw new Error(payload.error || 'Nao foi possivel atualizar a configuracao.')
  }

  return payload
}

export async function loadAdminSettings() {
  return requestAdminSettingsAction('get_payment_settings')
}

export async function updatePaymentProviderSetting(paymentProvider: PaymentProvider) {
  return requestAdminSettingsAction('set_payment_provider', paymentProvider)
}

export function listenChat(chatId: string, callback: (chat: Chat | null) => void): Unsubscribe {
  return onSnapshot(doc(db, 'chats', chatId), (snapshot) => {
    callback(snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as Chat) : null)
  })
}

export function listenClientActivity(
  chatId: string,
  callback: (activities: ClientActivity[]) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, 'chats', chatId, 'activity'), orderBy('createdAt', 'desc'), limit(18)),
    (snapshot) => {
      callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as ClientActivity))
    },
  )
}

export function listenChats(callback: (chats: Chat[]) => void): Unsubscribe {
  return onSnapshot(query(collection(db, 'chats'), orderBy('updatedAt', 'desc')), (snapshot) => {
    const chats = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Chat)
    chats.sort((first, second) => {
      const firstTime =
        first.lastMessageAt?.toMillis?.() ||
        first.updatedAt?.toMillis?.() ||
        first.createdAt?.toMillis?.() ||
        0
      const secondTime =
        second.lastMessageAt?.toMillis?.() ||
        second.updatedAt?.toMillis?.() ||
        second.createdAt?.toMillis?.() ||
        0

      return secondTime - firstTime
    })
    callback(chats)
  })
}
