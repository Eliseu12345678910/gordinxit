'use client'

import { FormEvent, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { isAccountAccessBlocked } from '@/lib/account-block'
import {
  addPaymentTrackingToLink,
  ChatAccessError,
  checkClientSessionAccess,
  clearClientSession,
  deviceOptions,
  ensureAnonymousSession,
  getClientId,
  getPaymentLinks,
  getPluginPaymentLink,
  getStoredAccountBlocked,
  getStoredAccountId,
  getStoredChatId,
  getStoredDevice,
  getStoredPlan,
  getStoredUsername,
  listenChat,
  makeId,
  paymentProviderLabels,
  planOptions,
  registerClientActivity,
  registerPaymentClick,
  requestChatAccess,
  saveDeviceSelection,
  savePlanSelection,
  storeAccountBlocked,
  storeAccountId,
  storeChatId,
  storeDevice,
  storePlan,
  storeUsername,
} from '@/lib/chat'
import { getSecureItem, setSecureItem } from '@/lib/secure-storage'
import { PortalErrorState } from '@/components/PortalErrorState'
import {
  defaultAppUpdateSettings,
  loadAppUpdateSettings,
  type AppUpdateSettings,
} from '@/lib/app-update'
import {
  defaultPcAccessSettings,
  loadPcAccessSettings,
  type PcAccessSettings,
} from '@/lib/pc-access'
import { defaultResellerPlanCatalog, type PublicPlanCatalogItem } from '@/lib/payment-catalog'
import { formatBrazilPhone, normalizeBrazilPhone } from '@/lib/phone'
import type { Chat, DeviceType, PaymentProvider, PaymentTarget, PlanType, ResellerAccessType } from '@/types/chat'

type PortalTab = 'plans' | 'plugins'
type AuthMode = 'login' | 'signup'
type CheckoutMode = 'external' | 'pix'
type CheckoutContext = ResellerAccessType
type PlanOption = typeof planOptions[number]
type PixCheckoutResult = {
  paymentId: string
  status: string
  priceLabel: string
  qrCode: string
  qrCodeBase64?: string
  ticketUrl?: string
}
type PaymentNotice = {
  code: string
  title: string
  text: string
  target: PaymentTarget
}

const approvalKeyPrefix = 'chat-atendimento-payment-approved-seen-v1'

const deviceLabelMap: Record<DeviceType, string> = {
  android: 'Android',
  ios: 'iOS',
  emulator: 'Emulador (PC)',
}

const deviceDownloadLabelMap: Record<DeviceType, string> = {
  android: 'ANDROID',
  ios: 'IOS',
  emulator: 'EMULADOR',
}

const downloadTutorials: Record<DeviceType, string[]> = {
  android: [
    'Clique em ABAIXAR e espere o APK terminar de baixar.',
    'Abra o arquivo baixado no celular.',
    'Se aparecer aviso do Android, toque em Configuracoes e permita instalar app desta fonte.',
    'Conclua a instalacao e abra o Gordin du Xit.',
    'Entre com o mesmo WhatsApp cadastrado no Gordin du Xit.',
    'Depois do login, confira se o plano aparece ativo e toque nas funcoes que quiser usar.',
    'Se aparecer ServiceSync pendente, fale com o vendedor antes de tentar mexer nas funcoes.',
  ],
  ios: [
    'Clique em ABAIXAR e abra o link no Safari.',
    'Siga o aviso da pagina de instalacao para liberar o perfil quando for solicitado.',
    'Conclua a instalacao e abra o Gordin du Xit.',
    'Entre com o mesmo WhatsApp cadastrado no Gordin du Xit.',
    'Depois do login, confira se o plano aparece ativo e toque nas funcoes que quiser usar.',
    'Se o iOS pedir confirmacao extra, volte aqui e fale com o suporte antes de refazer o processo.',
  ],
  emulator: [
    'Clique em ABAIXAR e espere o APK terminar de baixar no PC.',
    'Abra o emulador e arraste o APK para a janela, ou instale pelo gerenciador de APK.',
    'Aguarde a instalacao terminar e abra o Gordin du Xit dentro do emulador.',
    'Entre com o mesmo WhatsApp cadastrado no Gordin du Xit.',
    'Depois do login, confira se o plano aparece ativo e toque nas funcoes que quiser usar.',
    'Se aparecer ServiceSync pendente, fale com o vendedor antes de tentar mexer nas funcoes.',
  ],
}

const planVisuals: Record<PlanType, { name: string; tag: string; tone: string; normalPrice: string }> = {
  daily: {
    name: 'Diario',
    tag: '1 dia',
    tone: 'orange',
    normalPrice: 'R$ 29,90',
  },
  weekly: {
    name: 'Semanal',
    tag: '7 dias',
    tone: 'cyan',
    normalPrice: 'R$ 29,90',
  },
  monthly: {
    name: 'Mensal',
    tag: 'Mais comprado',
    tone: 'green',
    normalPrice: 'R$ 79,90',
  },
  lifetime: {
    name: 'Permanente',
    tag: 'Melhor valor',
    tone: 'pink',
    normalPrice: 'R$ 219,90',
  },
}

const checkoutPlanPaths: Record<PlanType, string> = {
  daily: '/paydiaria',
  weekly: '/paysemanal',
  monthly: '/paymensal',
  lifetime: '/paylifetime',
}

const checkoutPlanSlugs: Record<PlanType, string> = {
  daily: 'diaria',
  weekly: 'semanal',
  monthly: 'mensal',
  lifetime: 'lifetime',
}

function getPixCheckoutPath(plan: PlanType, context: CheckoutContext) {
  return `/pay${checkoutPlanSlugs[plan]}-${context}`
}

const planFeatures = [
  'Aimbot inteligente',
  'ESP name e distancia',
  'Ant-ban e ant-blacklist',
  'Atualizacoes gratuitas',
  'Tutorial de instalacao',
  'Suporte pelo WhatsApp',
]

const showcaseSections = [
  {
    title: 'Protecao',
    items: ['Ant-ban', 'Ant-blacklist', 'Protecao de conta'],
  },
  {
    title: 'Funcoes Aimbot',
    items: [
      'Aimbot Advanced',
      'Aimbot Neck',
      'Aimbot Legit',
      'Puxar Mira',
      'Ignorar Knocked',
      'Ignorar Bots',
      'Distance Max',
    ],
  },
  {
    title: 'Configs',
    items: ['Max Distance', 'Visible Check', 'Filled Color', 'Show Fov', 'Fov Color'],
  },
  {
    title: 'Exploit',
    items: [
      'Long Parachute',
      'Up Player',
      'Telekill to me',
      'Fast Swap',
      'No Recoil',
      'Shoot Trace',
      'Aimlock2x',
      'Spin Bot',
      'No Scope Awm',
      'Back Jump',
    ],
  },
  {
    title: 'Visuals (ESP)',
    items: [
      'Snaplines',
      'Glow',
      'Box',
      'Nome dos inimigos',
      'Distancia',
      'Skeleton',
      'Enable ESP',
      'Distance',
      'Lines Color',
      'Box Color',
      'ESP Weapon',
      'ESP Icon Weapon',
      'Name Color',
      'Distance Color',
      'Skeleton Color',
    ],
  },
]

const planFeatureCount = showcaseSections.reduce((total, section) => total + section.items.length, 0)
const planFeatureDisplayCount = Math.max(30, Math.floor(planFeatureCount / 5) * 5)

const planPosterSparks = Array.from({ length: 28 }, (_, index) => ({
  id: index,
  left: `${(index * 29) % 100}%`,
  top: `${(index * 47) % 100}%`,
  delay: `${(index % 8) * 0.18}s`,
  size: `${2 + (index % 4)}px`,
}))

const gamePlanVisuals: Record<PlanType, { displayName: string; tag: string; theme: string }> = {
  daily: {
    displayName: 'Diario',
    tag: 'Teste hoje',
    theme: 'ffp-daily',
  },
  weekly: {
    displayName: 'Semanal',
    tag: 'Entrada rapida',
    theme: 'ffp-weekly',
  },
  monthly: {
    displayName: 'Mensal',
    tag: 'Mais escolhido',
    theme: 'ffp-monthly',
  },
  lifetime: {
    displayName: 'Permanente',
    tag: 'Melhor valor',
    theme: 'ffp-lifetime',
  },
}

type PosterPlanItem =
  | { label: string; action: 'features' }
  | { label: string; detail?: string; tone?: 'positive' | 'negative' }

const posterPlanSummaryItems: PosterPlanItem[] = [
  { label: `Mais de ${planFeatureDisplayCount} funcoes`, action: 'features' },
  { label: 'Ant-ban e ant-blacklist' },
  { label: 'Atualizacoes semanais gratuitas' },
  { label: 'Suporte prioritario' },
]

function getPosterPlanDetailItems(
  pluginReady: boolean,
  selectedDevice: DeviceType | '' | undefined,
  paidPlan: PlanType | '' | undefined,
  plan: PlanType,
): PosterPlanItem[] {
  const items: PosterPlanItem[] = []

  if (selectedDevice === 'ios') {
    const iosWarning =
      paidPlan === 'weekly' && plan === 'weekly'
        ? 'Aviso importante: o plano Semanal nao e compativel com iOS. Antes de comprar outro plano, confira que para iOS e necessario o Mensal ou Permanente. Como o Semanal ja foi identificado nesta conta, qualquer ajuste ou reembolso do Semanal so sera tratado apos adquirir um plano compativel.'
        : paidPlan === 'monthly' && plan === 'weekly'
          ? 'Aviso importante: o plano Semanal nao e compativel com iOS. Como esta conta ja tem o Mensal identificado e para iOS o plano compativel e o Permanente, evite comprar o Semanal; qualquer ajuste ou reembolso so sera tratado apos adquirir o Permanente.'
          : paidPlan === 'monthly' && plan === 'monthly'
            ? 'Aviso importante: o plano Mensal nao libera o uso completo nesta conta iOS. Antes de comprar outro plano, confira que para iOS o plano compativel e o Permanente. Como o Mensal ja foi identificado nesta conta, qualquer ajuste ou reembolso do Mensal so sera tratado apos adquirir o Permanente.'
            : ''

    if (iosWarning) {
      items.push({
        label: 'Este plano nao funciona para iOS',
        detail: iosWarning,
        tone: 'negative',
      })
    }
  }

  return [
    ...items,
    {
      label: pluginReady ? 'Plugin ativo' : 'Plugin nao incluso',
      detail: pluginReady
        ? 'Liberado nesta conta.'
        : 'Necessario para o xit funcionar. Verifique com vendedor antes da compra.',
      tone: pluginReady ? 'positive' : 'negative',
    },
    { label: 'Tutorial de instalacao e uso' },
    { label: 'Recebimento automatico apos mandar comprovante' },
    { label: 'Mais controle para jogar apostado' },
    { label: 'Acesso vinculado ao WhatsApp cadastrado' },
  ]
}

const planDealMap: Record<PlanType, { duration: string; discount: string; note: string; realPrice: string }> = {
  daily: {
    duration: '1 dia',
    discount: 'Teste rapido',
    note: 'Acesso por dia',
    realPrice: 'R$ 29,90',
  },
  weekly: {
    duration: '7 dias',
    discount: 'Sem desconto',
    note: 'Renova por semana',
    realPrice: 'R$ 29,90',
  },
  monthly: {
    duration: '30 dias',
    discount: 'Economiza R$ 26,70',
    note: 'Comparado a 4 semanas',
    realPrice: 'R$ 79,90',
  },
  lifetime: {
    duration: 'Permanente',
    discount: 'Sem renovar',
    note: 'Paga uma vez',
    realPrice: 'R$ 219,90',
  },
}

type SocialStats = { boughtToday: number; activeUsers: number }

const initialPlanSocialStats: Record<PlanType, SocialStats> = {
  daily: {
    boughtToday: 24,
    activeUsers: 89,
  },
  weekly: {
    boughtToday: 38,
    activeUsers: 214,
  },
  monthly: {
    boughtToday: 96,
    activeUsers: 587,
  },
  lifetime: {
    boughtToday: 22,
    activeUsers: 143,
  },
}

const initialPluginSocialStats: SocialStats = {
  boughtToday: 17,
  activeUsers: 98,
}

const recentPlanPurchaseProofs: Array<{ name: string; phone: string; plan: PlanType }> = [
  { name: 'Caio', phone: '13 9***-508*', plan: 'daily' },
  { name: 'Lucas', phone: '66 1***-234*', plan: 'monthly' },
  { name: 'Matheus', phone: '41 9***-812*', plan: 'weekly' },
  { name: 'Rafael', phone: '21 8***-019*', plan: 'monthly' },
  { name: 'Gustavo', phone: '31 9***-447*', plan: 'lifetime' },
  { name: 'Pedro', phone: '85 9***-620*', plan: 'monthly' },
  { name: 'Joao', phone: '11 7***-302*', plan: 'weekly' },
  { name: 'Bruno', phone: '47 9***-155*', plan: 'monthly' },
  { name: 'Felipe', phone: '62 8***-734*', plan: 'lifetime' },
  { name: 'Vitor', phone: '92 9***-681*', plan: 'weekly' },
  { name: 'Diego', phone: '19 9***-044*', plan: 'monthly' },
  { name: 'Henrique', phone: '71 8***-390*', plan: 'lifetime' },
  { name: 'Samuel', phone: '27 9***-118*', plan: 'weekly' },
]

const recentPluginPurchaseProofs: Array<{ name: string; phone: string }> = [
  { name: 'Caio', phone: '51 9***-720*' },
  { name: 'Murilo', phone: '13 8***-551*' },
  { name: 'Thiago', phone: '61 9***-408*' },
  { name: 'Andre', phone: '81 7***-936*' },
  { name: 'Leandro', phone: '34 9***-264*' },
  { name: 'Igor', phone: '98 8***-017*' },
  { name: 'Renan', phone: '48 9***-642*' },
  { name: 'Eduardo', phone: '67 9***-893*' },
]

const resellerFeatureSections: Record<CheckoutContext, Array<{ title: string; items: string[] }>> = {
  external: [
    {
      title: 'External',
      items: [
        'AIMBOT LEGIT',
        'AIMBOT - NEW',
        'AIMBOT - SCOP',
        'FAST - AWM',
        'SCOPE - 2X',
        'CHAMS MENU',
        'CHAMS VERDE PIER 64',
        'STREAM MODE',
        'HIDE IN TASKBAR',
        'BYPASS SS',
      ],
    },
  ],
  internal: [
    {
      title: 'Funcoes Aimbot',
      items: [
        'Aimbot Advanced',
        'Aimbot Neck',
        'Aimbot Legit',
        'Puxar Mira',
        'Ignorar Knocked',
        'Ignorar Bots',
        'Distance Max',
      ],
    },
    {
      title: 'Config',
      items: ['Max Distance', 'Visible Check', 'Filled Color', 'Show Fov', 'Fov Color'],
    },
    {
      title: 'Exploit',
      items: [
        'Log Parachute',
        'Up Player',
        'Telekill to me',
        'Fast Swap',
        'No Recoil',
        'Shoot Trace',
        'Aimlock2x',
        'Spin Bot',
        'No Scope Awm',
        'Back Jump',
      ],
    },
    {
      title: 'Visuals ESP',
      items: [
        'Snaplines',
        'Glow',
        'Box',
        'Nome dos inimigos',
        'Distancia',
        'Skeleton',
        'enable esp',
        'distance',
        'lines color',
        'box color',
        'Esp weapon',
        'Esp Icon weapon',
        'name color',
        'dist color',
        'skel color',
      ],
    },
  ],
}

const resellerBenefitItems: Record<CheckoutContext, string[]> = {
  internal: [
    'Download liberado em acesso-pc apos confirmacao',
    'Key enviada no WhatsApp pelo atendimento',
    'Plano vinculado ao numero informado',
    'Suporte para ativar no app de PC',
    'Entrega separada do Gordin du Xit mobile',
  ],
  external: [
    'Download liberado em acesso-pc apos confirmacao',
    'Key enviada no WhatsApp pelo atendimento',
    'Plano vinculado ao numero informado',
    'Suporte para instalar e validar no PC',
    'Entrega separada do Gordin du Xit mobile',
  ],
}

function getResellerPlanOption(context: CheckoutContext, plan: PlanType): PlanOption {
  const item = defaultResellerPlanCatalog[context][plan]
  return {
    value: item.value,
    label: item.label,
    price: item.price,
    priceLabel: item.priceLabel,
    badge: item.badge,
    detail: item.detail,
  }
}

const pluginModules = [
  'License Bridge',
  'Device Binder',
  'Profile Cache',
  'Overlay Runtime',
  'Policy Sync Agent',
  'Frame Stabilizer',
  'ServiceSync Core',
]

function normalizePhone(value: string) {
  return normalizeBrazilPhone(value)
}

function formatPhone(value: string) {
  return formatBrazilPhone(value)
}

function splitPriceLabel(priceLabel: string) {
  return priceLabel.replace(/^R\$\s*/u, '').replace(/^R\$\u00a0*/u, '').trim().split(',')
}

function validatePhone(phone: string) {
  const digits = normalizePhone(phone)
  const validBrazilDdds = new Set([
    '11', '12', '13', '14', '15', '16', '17', '18', '19',
    '21', '22', '24', '27', '28',
    '31', '32', '33', '34', '35', '37', '38',
    '41', '42', '43', '44', '45', '46', '47', '48', '49',
    '51', '53', '54', '55',
    '61', '62', '63', '64', '65', '66', '67', '68', '69',
    '71', '73', '74', '75', '77', '79',
    '81', '82', '83', '84', '85', '86', '87', '88', '89',
    '91', '92', '93', '94', '95', '96', '97', '98', '99',
  ])

  if (digits.length !== 10 && digits.length !== 11) return 'Digite seu WhatsApp com DDD.'
  if (!validBrazilDdds.has(digits.slice(0, 2))) return 'Confira o DDD do seu numero.'
  if (/^(\d)\1+$/.test(digits)) return 'Digite um numero de WhatsApp valido.'
  return ''
}

function validatePassword(password: string) {
  if (!password) return 'Digite sua senha.'
  if (password.length < 4) return 'A senha precisa ter pelo menos 4 caracteres.'
  if (password.length > 32) return 'A senha pode ter no maximo 32 caracteres.'
  return ''
}

function isSubscriptionActive(chat: Chat | null) {
  if (chat?.subscription?.status !== 'active' || !chat.subscription.plan) return false
  const expiresAt = chat.subscription.expiresAt?.toMillis?.()
  return !expiresAt || expiresAt > Date.now()
}

function getActivePlan(chat: Chat | null): PlanType | '' {
  if (isSubscriptionActive(chat) && chat?.subscription?.plan) return chat.subscription.plan
  if (chat?.payment?.status === 'paid' && chat.payment.plan && chat.payment.plan !== 'plugin') {
    return chat.payment.plan
  }
  return ''
}

function isResellerPlanOwned(chat: Chat | null, context: CheckoutContext, plan: PlanType) {
  const access = chat?.resellerAccess?.[context]
  if (access?.status !== 'active' || access.plan !== plan) return false
  const expiresAt = access.expiresAt?.toMillis?.()
  return !expiresAt || expiresAt > Date.now()
}

function isResellerPurchaseActive(purchase: NonNullable<Chat['resellerPurchases']>[number]) {
  if (purchase.status !== 'paid' || !purchase.plan || !purchase.accessType) return false
  const expiresAt = purchase.expiresAt?.toMillis?.()
  return !expiresAt || expiresAt > Date.now()
}

function getResellerPurchases(chat: Chat | null, context: CheckoutContext) {
  return (chat?.resellerPurchases || [])
    .filter((purchase) => purchase.accessType === context && purchase.status === 'paid')
    .sort((first, second) => {
      const firstTime = first.activatedAt?.toMillis?.() || 0
      const secondTime = second.activatedAt?.toMillis?.() || 0
      return secondTime - firstTime
    })
}

function getResellerAccess(chat: Chat | null, context: CheckoutContext) {
  const activePurchase = getResellerPurchases(chat, context).find(isResellerPurchaseActive)
  if (activePurchase) return activePurchase

  const access = chat?.resellerAccess?.[context]
  if (access?.status !== 'active' || !access.plan) return null
  const expiresAt = access.expiresAt?.toMillis?.()
  if (expiresAt && expiresAt <= Date.now()) return null
  return access
}

function getPurchaseCode(chat: Chat | null) {
  return chat?.payment?.code || chat?.id || ''
}

function getPaidTarget(chat: Chat | null): PaymentTarget | '' {
  if (chat?.payment?.status !== 'paid') return ''
  return chat.payment.plan || ''
}

function isPluginActive(chat: Chat | null) {
  return chat?.plugin?.status === 'active' || (chat?.payment?.status === 'paid' && chat.payment.plan === 'plugin')
}

function isPluginReady(chat: Chat | null, selectedDevice: DeviceType | '') {
  return selectedDevice === 'ios' || isPluginActive(chat) || chat?.plugin?.included === true
}

function getSelectedDevice(chat: Chat | null, selectedDevice: DeviceType | '') {
  return selectedDevice || chat?.leadProfile?.device || ''
}

function getDownloadButtonLabel(device: DeviceType | '') {
  if (device === 'android' || device === 'emulator') {
    return 'ABAIXAR XIT'
  }

  return 'VOCE POSSUI ESTE PLANO'
}

function canDownloadXit(device: DeviceType | '') {
  return device === 'android' || device === 'emulator'
}

function makeApprovalNotice(chat: Chat | null): PaymentNotice | null {
  const paidTarget = getPaidTarget(chat)
  const code = getPurchaseCode(chat)
  if (!paidTarget || !code) return null
  const label =
    paidTarget === 'plugin'
      ? 'Plugin ServiceSync Core'
      : planOptions.find((plan) => plan.value === paidTarget)?.label || 'Plano'

  return {
    code,
    target: paidTarget,
    title: 'Pagamento aprovado',
    text: `${label} confirmado. Use o codigo abaixo se precisar identificar essa compra no Gordin du Xit ou no admin.`,
  }
}

function AuthScreen({
  defaultPhone,
  loading,
  error,
  onSubmit,
}: {
  defaultPhone: string
  loading: boolean
  error: string
  onSubmit: (phone: string, password: string, device: DeviceType, mode: AuthMode) => Promise<{ message?: string; switchTo?: AuthMode } | void>
}) {
  const [phone, setPhone] = useState(formatPhone(defaultPhone))
  const [device, setDevice] = useState<DeviceType | ''>('')
  const [formError, setFormError] = useState('')
  const [confirmDeviceOpen, setConfirmDeviceOpen] = useState(false)
  const selectedDeviceOption = deviceOptions.find((option) => option.value === device)

  useEffect(() => {
    if (error) setFormError(error)
  }, [error])

  function validateAuthForm() {
    const phoneError = validatePhone(phone)
    const nextError = phoneError || (!device ? 'Escolha seu dispositivo para continuar.' : '')

    setFormError(nextError)
    return !nextError
  }

  async function submitAccess() {
    if (!device) {
      setFormError('Escolha seu dispositivo para continuar.')
      setConfirmDeviceOpen(false)
      return
    }

    setConfirmDeviceOpen(false)

    const result = await onSubmit(normalizePhone(phone), '', device, 'signup')
    if (result?.message) setFormError(result.message)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!validateAuthForm()) return
    setConfirmDeviceOpen(true)
  }

  return (
    <main className="portal-shell auth-shell">
      <section className="portal-auth">
        <div className="portal-auth-bg" aria-hidden="true">
          {planPosterSparks.slice(0, 18).map((spark) => (
            <span
              key={spark.id}
              style={
                {
                  '--spark-left': spark.left,
                  '--spark-top': spark.top,
                  '--spark-delay': spark.delay,
                  '--spark-size': spark.size,
                } as CSSProperties
              }
            />
          ))}
          <i />
        </div>
        <div className="portal-auth-copy">
          <h1>Qual seu numero de WhatsApp</h1>
          <p>Precisamos saber seu WhatsApp para poder mandar o xit.</p>
        </div>

        <form className="portal-auth-form" onSubmit={handleSubmit}>
          <label>
            <span>WhatsApp</span>
            <div className="portal-phone-input">
              <b>+55</b>
              <input
                value={phone}
                onChange={(event) => {
                  setPhone(formatPhone(event.target.value))
                  setFormError('')
                  setConfirmDeviceOpen(false)
                }}
                inputMode="tel"
                autoComplete="tel"
                placeholder="(11) 99999-9999"
              />
            </div>
          </label>

          <fieldset className="portal-device-field">
            <legend>Escolha seu dispositivo</legend>
            <div>
              {deviceOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`portal-device-button ${device === option.value ? 'active' : ''}`}
                  aria-pressed={device === option.value}
                  onClick={() => {
                    setDevice(option.value)
                    setFormError('')
                    setConfirmDeviceOpen(false)
                  }}
                  >
                    <DeviceGlyph device={option.value} />
                    <strong>{option.label}</strong>
                  </button>
                ))}
              </div>
          </fieldset>

          {formError && <strong className="portal-form-error">{formError}</strong>}

          <button className="portal-auth-submit" type="submit" disabled={loading}>
            {loading ? 'AGUARDE...' : 'CONTINUAR ->'}
          </button>
        </form>

      </section>
      {confirmDeviceOpen && (
        <section
          className="portal-auth-confirm-backdrop"
          role="presentation"
          onClick={() => setConfirmDeviceOpen(false)}
        >
          <div
            className="portal-auth-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Confirmacoes de dados"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="portal-auth-confirm-close"
              type="button"
              aria-label="Fechar"
              onClick={() => setConfirmDeviceOpen(false)}
            >
              X
            </button>
            <span>Conferir dados</span>
            <h2>Esta tudo certo?</h2>
            <p className="portal-auth-confirm-note">Use esse mesmo numero para entrar no xit depois.</p>
            <div className="portal-auth-confirm-data">
              <p>
                <i className="portal-auth-confirm-icon">+55</i>
                <span>
                  <small>WhatsApp</small>
                  <strong>{formatBrazilPhone(normalizePhone(phone), { countryCode: true })}</strong>
                </span>
              </p>
              <p className="portal-auth-confirm-device">
                <i className="portal-auth-confirm-icon">
                  {selectedDeviceOption ? <DeviceGlyph device={selectedDeviceOption.value} /> : null}
                </i>
                <span>
                  <small>Dispositivo</small>
                  <strong>{selectedDeviceOption?.label}</strong>
                </span>
              </p>
            </div>
            <div className="portal-auth-confirm-actions">
              <button className="portal-auth-confirm-edit" type="button" onClick={() => setConfirmDeviceOpen(false)}>
                Editar
              </button>
              <button className="portal-auth-confirm-submit" type="button" onClick={submitAccess} disabled={loading}>
                Confirmar
              </button>
            </div>
          </div>
        </section>
      )}
      <PortalStyles />
    </main>
  )
}

function DeviceGlyph({ device }: { device: DeviceType }) {
  if (device === 'android') {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="M14 18h20v16a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V18Z" />
        <path d="M18 14 14 8M30 14l4-6M14 18h20M10 20v12M38 20v12" />
        <circle cx="20" cy="25" r="1.8" />
        <circle cx="28" cy="25" r="1.8" />
      </svg>
    )
  }

  if (device === 'ios') {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="M30.5 7.5c-2.9 1.1-5 3.9-4.7 7 2.8.2 5.7-2 6.4-5 .2-.8.1-1.5-.1-2" />
        <path d="M34.5 25.6c-.1-4.2 3.4-6.2 3.6-6.3-2-2.9-5-3.3-6-3.4-2.6-.3-5 1.5-6.3 1.5-1.4 0-3.5-1.5-5.7-1.4-2.9 0-5.6 1.7-7.1 4.3-3 5.2-.8 13 2.2 17.2 1.4 2.1 3.1 4.4 5.4 4.3 2.1-.1 2.9-1.4 5.5-1.4s3.3 1.4 5.6 1.3c2.3 0 3.8-2.1 5.2-4.2 1.6-2.4 2.3-4.7 2.3-4.8-.1 0-4.6-1.8-4.7-7.1Z" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <rect x="8" y="10" width="32" height="22" rx="3" />
      <path d="M20 38h8M24 32v6" />
    </svg>
  )
}

function PlansPageOld({
  chat,
  selectedDevice,
  selectedPlan,
  saving,
  paymentLinks,
  paymentProvider,
  onBuy,
  onDownload,
}: {
  chat: Chat | null
  selectedDevice: DeviceType | ''
  selectedPlan: PlanType | ''
  saving: boolean
  paymentLinks: Record<PlanType, string>
  paymentProvider: PaymentProvider
  onBuy: (target: PaymentTarget, link: string, label: string) => void
  onDownload: () => void
}) {
  const activePlan = getActivePlan(chat)
  const purchaseCode = getPurchaseCode(chat)
  const device = getSelectedDevice(chat, selectedDevice)

  return (
    <section className="portal-page">
      <div className="portal-hero">
        <span>Planos do painel</span>
        <h1>Escolha seu acesso</h1>
        <p>Compra pelo checkout, atendimento pelo WhatsApp e liberacao ligada a esta conta.</p>
      </div>

      <div className="portal-plan-grid">
        {planOptions.map((plan) => {
          const visual = planVisuals[plan.value]
          const isOwned = activePlan === plan.value
          const isSelected = selectedPlan === plan.value || chat?.selectedPlan?.plan === plan.value
          const [main, cents = '00'] = splitPriceLabel(plan.priceLabel)

          return (
            <article key={plan.value} className={`portal-plan-card ${visual.tone} ${isOwned ? 'owned' : ''}`}>
              <div className="portal-plan-head">
                <span>{visual.tag}</span>
                <h2>{visual.name}</h2>
                {isSelected && !isOwned && <small>Selecionado nesta conta</small>}
              </div>

              <ul>
                {planFeatures.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
                {device === 'ios' && plan.value === 'weekly' && (
                  <li className="warning">Para iOS, confira com o atendimento antes de usar o Semanal.</li>
                )}
                {device === 'ios' && plan.value === 'monthly' && (
                  <li className="warning">No iOS, o Permanente e o mais indicado para liberar tudo.</li>
                )}
              </ul>

              <div className="portal-price">
                <span>Valor normal <s>{visual.normalPrice}</s></span>
                <strong>
                  <small>R$</small>
                  {main}
                  <em>,{cents}</em>
                </strong>
              </div>

              <button
                type="button"
                className={isOwned ? `owned ${canDownloadXit(device) ? 'download' : 'plan-owned-only'}` : ''}
                disabled={saving || (!isOwned && !paymentLinks[plan.value])}
                onClick={() =>
                  isOwned && canDownloadXit(device)
                    ? onDownload()
                    : !isOwned
                      ? onBuy(plan.value, paymentLinks[plan.value], `Comprar ${plan.label}`)
                      : undefined
                }
              >
                {isOwned ? getDownloadButtonLabel(device) : plan.value === 'lifetime' ? 'Pagamento unico' : 'Assinar agora'}
              </button>

              {isOwned && purchaseCode && (
                <p className="portal-purchase-code">Codigo da compra: <b>{purchaseCode}</b></p>
              )}
            </article>
          )
        })}
      </div>

      <p className="portal-provider-note">Checkout ativo: {paymentProviderLabels[paymentProvider]}.</p>
    </section>
  )
}

function PlansPage({
  chat,
  canOpenPlugin,
  selectedDevice,
  selectedPlan,
  saving,
  paymentLinks,
  onBuy,
  onDownload,
}: {
  chat: Chat | null
  canOpenPlugin: boolean
  selectedDevice: DeviceType | ''
  selectedPlan: PlanType | ''
  saving: boolean
  paymentLinks: Record<PlanType, string>
  paymentProvider: PaymentProvider
  onBuy: (target: PaymentTarget, link: string, label: string) => void
  onDownload: () => void
}) {
  const activePlan = getActivePlan(chat)
  const purchaseCode = getPurchaseCode(chat)
  const device = getSelectedDevice(chat, selectedDevice)
  const [showAllFeatures, setShowAllFeatures] = useState(false)
  const [expandedPlanDetails, setExpandedPlanDetails] = useState<PlanType | ''>('')
  const [recentPurchaseIndex, setRecentPurchaseIndex] = useState(0)
  const [livePlanStats, setLivePlanStats] = useState(initialPlanSocialStats)
  const lastAppliedPlanPurchaseIndex = useRef(0)
  const recentPurchase = recentPlanPurchaseProofs[recentPurchaseIndex % recentPlanPurchaseProofs.length]

  useEffect(() => {
    const interval = window.setInterval(() => {
      setRecentPurchaseIndex((current) => (current + 1) % recentPlanPurchaseProofs.length)
    }, 6200)

    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (recentPurchaseIndex === lastAppliedPlanPurchaseIndex.current) return

    const nextPlan = recentPlanPurchaseProofs[recentPurchaseIndex].plan
    lastAppliedPlanPurchaseIndex.current = recentPurchaseIndex
    setLivePlanStats((currentStats) => ({
      ...currentStats,
      [nextPlan]: {
        boughtToday: currentStats[nextPlan].boughtToday + 1,
        activeUsers: currentStats[nextPlan].activeUsers + 1,
      },
    }))
  }, [recentPurchaseIndex])

  return (
    <div className="plan-fullscreen ffp-modal portal-ffp-page" role="region" aria-label="Planos do xit">
      <main className="ffp-page">
        <section className="ffp-poster">
          <div className="ffp-bg" aria-hidden="true">
            {planPosterSparks.map((spark) => (
              <span
                key={spark.id}
                className="ffp-spark"
                style={
                  {
                    '--spark-left': spark.left,
                    '--spark-top': spark.top,
                    '--spark-delay': spark.delay,
                    '--spark-size': spark.size,
                  } as CSSProperties
                }
              />
            ))}
            <span className="ffp-ring ffp-ring-a" />
            <span className="ffp-ring ffp-ring-b" />
          </div>

          {canOpenPlugin && (
            <header className="ffp-controls portal-ffp-controls">
              <nav className="portal-mode-switch" aria-label="Area do cliente">
                <a className="active" href="/planos">Planos</a>
                <a href="/plugins">Plugin</a>
              </nav>
            </header>
          )}

          <div className="ffp-content">
            <section className="ffp-hero">
              <h3>
                Planos
                {' '}
                <strong>Android/iOS</strong>
              </h3>
            </section>

            <div className="ffp-main-grid">
              <div className="ffp-showcase" aria-hidden="true">
                <div className="ffp-cyber">
                  <span className="ffp-cyber-body" />
                  <span className="ffp-cyber-head" />
                  <span className="ffp-cyber-mask" />
                  <span className="ffp-cyber-eye eye-a" />
                  <span className="ffp-cyber-eye eye-b" />
                  <span className="ffp-cyber-chest">GORDIN <b>XIT</b></span>
                  <span className="ffp-cyber-arm arm-a" />
                  <span className="ffp-cyber-arm arm-b" />
                  <span className="ffp-cyber-leg leg-a" />
                  <span className="ffp-cyber-leg leg-b" />
                  <span className="ffp-cyber-glow" />
                </div>
              </div>

              <div className="ffp-card-list" aria-label="Escolha seu plano">
                {planOptions.map((option, index) => {
                  const visual = gamePlanVisuals[option.value]
                  const deal = planDealMap[option.value]
                  const social = livePlanStats[option.value]
                  const isOwned = activePlan === option.value
                  const canOpenDetails = Boolean(activePlan)
                  const isSelected = selectedPlan === option.value || chat?.selectedPlan?.plan === option.value
                  const posterPlanDetailItems = getPosterPlanDetailItems(
                    isPluginReady(chat, device),
                    device,
                    activePlan,
                    option.value,
                  )
                  const detailsOpen = canOpenDetails && expandedPlanDetails === option.value
                  const [priceMain, priceCents = '00'] = splitPriceLabel(option.priceLabel)
                  const paymentLink = paymentLinks[option.value]

                  return (
                    <article
                      key={option.value}
                      className={`ffp-price-card ${visual.theme} ${isSelected || isOwned ? 'selected' : ''} ${isOwned ? 'portal-owned-plan' : ''}`}
                      style={{ '--card-delay': `${index * 0.12}s` } as CSSProperties}
                    >
                      {option.badge && <span className="ffp-top-badge">Mais escolhido</span>}
                      <div className="ffp-plan-head">
                        <span className="ffp-plan-icon" aria-hidden="true" />
                        <div>
                          <span>Plano</span>
                          <h4>{visual.displayName}</h4>
                          <small>{visual.tag}</small>
                        </div>
                      </div>

                      <div className="ffp-item-list">
                        {posterPlanSummaryItems.map((item) =>
                          'action' in item && item.action === 'features' ? (
                            <button
                              type="button"
                              className="ffp-feature-link"
                              key={`${option.value}-${item.label}`}
                              onClick={() => setShowAllFeatures(true)}
                              aria-label="Ver lista completa de funcoes"
                            >
                              <i aria-hidden="true" />
                              <b>{item.label}</b>
                              <em aria-hidden="true">&gt;</em>
                            </button>
                          ) : (
                            <span
                              key={`${option.value}-${item.label}`}
                              className={'tone' in item && item.tone === 'negative' ? 'ffp-item-negative' : undefined}
                            >
                              <i aria-hidden="true" />
                              <b>{item.label}</b>
                              {'detail' in item && item.detail && <small>{item.detail}</small>}
                            </span>
                          ),
                        )}
                        <button
                          type="button"
                          className={`ffp-feature-link ffp-more-link ${!canOpenDetails ? 'locked' : ''}`}
                          onClick={() => {
                            if (!canOpenDetails) return
                            setExpandedPlanDetails((current) => (current === option.value ? '' : option.value))
                          }}
                          disabled={!canOpenDetails}
                          aria-disabled={!canOpenDetails}
                        >
                          <i aria-hidden="true" />
                          <b>{detailsOpen ? 'Mostrar menos' : 'Ver mais'}</b>
                          <em aria-hidden="true">&gt;</em>
                        </button>
                        {detailsOpen &&
                          posterPlanDetailItems.map((item) => (
                            <span
                              key={`${option.value}-detail-${item.label}`}
                              className={'tone' in item && item.tone === 'negative' ? 'ffp-item-negative' : undefined}
                            >
                              <i aria-hidden="true" />
                              <b>{item.label}</b>
                              {'detail' in item && item.detail && <small>{item.detail}</small>}
                            </span>
                          ))}
                      </div>

                      <div className="ffp-price">
                        <div className="ffp-price-compare">
                          <span>Valor normal</span>
                          <s>{deal.realPrice}</s>
                        </div>
                        <div className="ffp-price-row">
                          <div className="ffp-price-value" aria-label={`${option.priceLabel} - ${deal.duration}`}>
                            <em>Por</em>
                            <span>R$</span>
                            <strong>{priceMain}</strong>
                            <b>,{priceCents}</b>
                          </div>
                          <small>{deal.duration}</small>
                        </div>
                      </div>

                      <button
                        type="button"
                        className={`ffp-buy-button ${isOwned ? `portal-owned-button ${canDownloadXit(device) ? 'download' : 'plan-owned-only'}` : ''}`}
                        onClick={() =>
                          isOwned && canDownloadXit(device)
                            ? onDownload()
                            : !isOwned
                              ? onBuy(option.value, paymentLink, `Comprar ${option.label}`)
                              : undefined
                        }
                        disabled={saving || (!isOwned && !paymentLink)}
                      >
                        {!isOwned && !paymentLink
                          ? 'Link indisponivel'
                          : isOwned
                            ? (
                                <>
                                  <i aria-hidden="true" />
                                  {getDownloadButtonLabel(device)}
                                </>
                              )
                            : option.value === 'lifetime'
                              ? 'Pagamento unico'
                              : 'Assinar agora'}
                        {!isOwned && <span aria-hidden="true">&gt;</span>}
                      </button>

                      {isOwned && purchaseCode && (
                        <p className="portal-ffp-purchase-code">Codigo da compra: <b>{purchaseCode}</b></p>
                      )}

                      <div className="ffp-social-stats" aria-label={`Prova social do plano ${option.label}`}>
                        <span className="ffp-stat bought">
                          <i aria-hidden="true" />
                          <b>+{social.boughtToday}</b>
                          <small>comprados hoje</small>
                        </span>
                        <span className="ffp-stat active">
                          <i aria-hidden="true" />
                          <b>+{social.activeUsers}</b>
                          <small>ativos neste plano</small>
                        </span>
                      </div>
                    </article>
                  )
                })}
              </div>
            </div>

            <div className="ffp-bottom-spacer" aria-hidden="true" />

            <div className="ffp-purchase-toast" aria-live="polite">
              <i aria-hidden="true" />
              <div>
                <small>Compra ao vivo</small>
                <strong>{recentPurchase.name} comprou agora</strong>
                <span>{recentPurchase.phone} - Plano {gamePlanVisuals[recentPurchase.plan].displayName} liberado automaticamente.</span>
              </div>
            </div>
          </div>
        </section>
      </main>

      {showAllFeatures && (
        <div className="ffp-feature-overlay" onClick={() => setShowAllFeatures(false)}>
          <div className="ffp-feature-panel" onClick={(event) => event.stopPropagation()}>
            <div className="ffp-feature-panel-head">
              <div>
                <span>Recursos inclusos</span>
                <h3>Mais de {planFeatureDisplayCount} funcoes</h3>
                <p>{planFeatureCount} funcoes organizadas por categoria.</p>
              </div>
              <button type="button" onClick={() => setShowAllFeatures(false)} aria-label="Fechar lista de funcoes">
                X
              </button>
            </div>
            <div className="ffp-feature-grid">
              {showcaseSections.map((section) => (
                <section key={section.title}>
                  <h4>{section.title}</h4>
                  <ul>
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PlanCheckoutPage({
  chat,
  plan,
  checkoutMode,
  checkoutContext,
  canOpenPlugin,
  selectedDevice,
  selectedPlan,
  saving,
  paymentLinks,
  planOptionsList,
  pixPayment,
  pixError,
  onBuy,
  onGeneratePix,
}: {
  chat: Chat | null
  plan: PlanType
  checkoutMode: CheckoutMode
  checkoutContext: CheckoutContext
  canOpenPlugin: boolean
  selectedDevice: DeviceType | ''
  selectedPlan: PlanType | ''
  saving: boolean
  paymentLinks: Record<PlanType, string>
  planOptionsList: PlanOption[]
  pixPayment: PixCheckoutResult | null
  pixError: string
  onBuy: (target: PaymentTarget, link: string, label: string) => void
  onGeneratePix: (plan: PlanType, context: CheckoutContext) => void
}) {
  const isPixCheckout = checkoutMode === 'pix'
  const resellerPlanOwned = isPixCheckout ? isResellerPlanOwned(chat, checkoutContext, plan) : false
  const activePlan = getActivePlan(chat)
  const purchaseCode = getPurchaseCode(chat)
  const device = getSelectedDevice(chat, selectedDevice)
  const option = isPixCheckout
    ? getResellerPlanOption(checkoutContext, plan)
    : planOptionsList.find((item) => item.value === plan) || planOptionsList[0] || planOptions[0]
  const visual = gamePlanVisuals[plan]
  const deal = isPixCheckout
    ? {
        ...planDealMap[plan],
        realPrice: defaultResellerPlanCatalog[checkoutContext][plan].normalPriceLabel,
      }
    : planDealMap[plan]
  const isOwned = isPixCheckout ? resellerPlanOwned : activePlan === plan
  const isSelected = selectedPlan === plan || chat?.selectedPlan?.plan === plan
  const canOpenDetails = isPixCheckout ? false : Boolean(activePlan)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [showAllFeatures, setShowAllFeatures] = useState(false)
  const [portalMounted, setPortalMounted] = useState(false)
  const visibleDetailsOpen = canOpenDetails && detailsOpen
  const posterPlanDetailItems = getPosterPlanDetailItems(isPluginReady(chat, device), device, activePlan, plan)
  const [priceMain, priceCents = '00'] = splitPriceLabel(option.priceLabel)
  const paymentLink = paymentLinks[plan]
  const canSubmit = isPixCheckout || Boolean(paymentLink)
  const checkoutButtonRef = useRef<HTMLButtonElement | null>(null)
  const [showFixedCheckoutButton, setShowFixedCheckoutButton] = useState(isPixCheckout)
  const checkoutButtonLabel = !canSubmit
    ? 'Link indisponivel'
    : isOwned
      ? 'Voce possui este plano'
      : saving
          ? 'Aguarde...'
        : isPixCheckout
          ? 'REALIZAR PAGAMENTO'
          : 'Continuar ->'

  const handleCheckoutSubmit = () => {
    if (isPixCheckout) {
      onGeneratePix(plan, checkoutContext)
      return
    }
    onBuy(plan, paymentLink, `Comprar ${option.label}`)
  }

  const handleScrollToCheckout = () => {
    checkoutButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  useEffect(() => {
    setPortalMounted(true)
  }, [])

  useEffect(() => {
    if (!isPixCheckout || isOwned || pixPayment) {
      setShowFixedCheckoutButton(false)
      return
    }

    const updateFixedCheckoutButton = () => {
      const button = checkoutButtonRef.current
      if (!button) {
        setShowFixedCheckoutButton(true)
        return
      }
      const rect = button.getBoundingClientRect()
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight
      const buttonVisible = rect.top < viewportHeight - 8 && rect.bottom > 8
      setShowFixedCheckoutButton(!buttonVisible)
    }

    setShowFixedCheckoutButton(true)
    const firstFrame = window.requestAnimationFrame(updateFixedCheckoutButton)
    const secondFrame = window.setTimeout(updateFixedCheckoutButton, 300)
    const scrollContainer = document.querySelector('.portal-checkout-page')
    window.addEventListener('scroll', updateFixedCheckoutButton, { passive: true })
    window.addEventListener('resize', updateFixedCheckoutButton)
    scrollContainer?.addEventListener('scroll', updateFixedCheckoutButton, { passive: true })

    return () => {
      window.cancelAnimationFrame(firstFrame)
      window.clearTimeout(secondFrame)
      window.removeEventListener('scroll', updateFixedCheckoutButton)
      window.removeEventListener('resize', updateFixedCheckoutButton)
      scrollContainer?.removeEventListener('scroll', updateFixedCheckoutButton)
    }
  }, [isOwned, isPixCheckout, pixPayment, plan])

  return (
    <div className={`plan-fullscreen ffp-modal portal-ffp-page portal-checkout-page ${isPixCheckout ? `portal-reseller-checkout portal-reseller-${checkoutContext}` : ''}`} role="region" aria-label={`Comprar plano ${option.label}`}>
      <main className="ffp-page">
        <section className="ffp-poster">
          <div className="ffp-bg" aria-hidden="true">
            {planPosterSparks.map((spark) => (
              <span
                key={spark.id}
                className="ffp-spark"
                style={
                  {
                    '--spark-left': spark.left,
                    '--spark-top': spark.top,
                    '--spark-delay': spark.delay,
                    '--spark-size': spark.size,
                  } as CSSProperties
                }
              />
            ))}
            <span className="ffp-ring ffp-ring-a" />
            <span className="ffp-ring ffp-ring-b" />
          </div>

          {!isPixCheckout && canOpenPlugin && (
            <header className="ffp-controls portal-ffp-controls">
              <nav className="portal-mode-switch" aria-label="Area do cliente">
                <a className="active" href={checkoutPlanPaths[plan]}>Plano</a>
                <a href="/plugins">Plugin</a>
              </nav>
            </header>
          )}

          <div className="ffp-content">
            <div className="ffp-main-grid portal-checkout-grid">
              <div className="ffp-card-list" aria-label={`Detalhes do plano ${option.label}`}>
                <article
                  className={`ffp-price-card ${visual.theme} ${isSelected || isOwned ? 'selected' : ''} ${isOwned ? 'portal-owned-plan' : ''}`}
                >
                  <div className="ffp-plan-head">
                    <span className="ffp-plan-icon" aria-hidden="true" />
                    <div>
                      <span>Plano</span>
                      <h4>{visual.displayName}</h4>
                      <small>{visual.tag}</small>
                    </div>
                  </div>

                  <div className="ffp-item-list">
                    {isPixCheckout ? (
                      <div className="portal-reseller-features">
                        <section className="portal-reseller-benefits">
                          <div>
                            {resellerBenefitItems[checkoutContext].map((item) => (
                              <span key={item}>
                                <i aria-hidden="true" />
                                <b>{item}</b>
                              </span>
                            ))}
                          </div>
                        </section>
                        {resellerFeatureSections[checkoutContext].map((section) => (
                          <section key={section.title}>
                            <h5>{section.title}</h5>
                            <div>
                              {section.items.map((item) => (
                                <span key={item}>
                                  <i aria-hidden="true" />
                                  <b>{item}</b>
                                </span>
                              ))}
                            </div>
                          </section>
                        ))}
                      </div>
                    ) : (
                      <>
                        {posterPlanSummaryItems.map((item) =>
                          'action' in item && item.action === 'features' ? (
                            <button
                              type="button"
                              className="ffp-feature-link"
                              key={`${option.value}-${item.label}`}
                              onClick={() => setShowAllFeatures(true)}
                              aria-label="Ver lista completa de funcoes"
                            >
                              <i aria-hidden="true" />
                              <b>{item.label}</b>
                              <em aria-hidden="true">&gt;</em>
                            </button>
                          ) : (
                            <span
                              key={`${option.value}-${item.label}`}
                              className={'tone' in item && item.tone === 'negative' ? 'ffp-item-negative' : undefined}
                            >
                              <i aria-hidden="true" />
                              <b>{item.label}</b>
                              {'detail' in item && item.detail && <small>{item.detail}</small>}
                            </span>
                          ),
                        )}
                        <button
                          type="button"
                          className={`ffp-feature-link ffp-more-link ${!canOpenDetails ? 'locked' : ''}`}
                          onClick={() => {
                            if (!canOpenDetails) return
                            setDetailsOpen((current) => !current)
                          }}
                          disabled={!canOpenDetails}
                          aria-disabled={!canOpenDetails}
                        >
                          <i aria-hidden="true" />
                          <b>{visibleDetailsOpen ? 'Mostrar menos' : 'Ver mais'}</b>
                          <em aria-hidden="true">&gt;</em>
                        </button>
                        {visibleDetailsOpen &&
                          posterPlanDetailItems.map((item) => (
                        <span
                          key={`${option.value}-detail-${item.label}`}
                          className={'tone' in item && item.tone === 'negative' ? 'ffp-item-negative' : undefined}
                        >
                          <i aria-hidden="true" />
                          <b>{item.label}</b>
                          {'detail' in item && item.detail && <small>{item.detail}</small>}
                        </span>
                          ))}
                      </>
                    )}
                  </div>

                  <div className="ffp-price">
                    {!isPixCheckout && (
                      <div className="ffp-price-compare">
                        <span>Valor normal</span>
                        <s>{deal.realPrice}</s>
                      </div>
                    )}
                    <div className="ffp-price-row">
                      <div className="ffp-price-value" aria-label={`${option.priceLabel} - ${deal.duration}`}>
                        <em>Por</em>
                        <span>R$</span>
                        <strong>{priceMain}</strong>
                        <b>,{priceCents}</b>
                      </div>
                      <small>{deal.duration}</small>
                    </div>
                  </div>

                  <button
                    ref={checkoutButtonRef}
                    type="button"
                    className={`ffp-buy-button portal-checkout-submit ${isOwned ? 'portal-owned-button owned' : ''}`}
                    onClick={handleCheckoutSubmit}
                    disabled={saving || isOwned || !canSubmit}
                  >
                    {checkoutButtonLabel}
                  </button>

                  {isPixCheckout && portalMounted && showFixedCheckoutButton && createPortal(
                    <div className="portal-fixed-checkout-bar">
                      <button
                        type="button"
                        className="portal-fixed-checkout-arrow"
                        onClick={handleScrollToCheckout}
                        aria-label="Rolar para o pagamento"
                      >
                        <span aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={`ffp-buy-button portal-checkout-submit portal-fixed-checkout-submit ${checkoutContext === 'internal' ? 'portal-fixed-internal' : 'portal-fixed-external'}`}
                        onClick={handleCheckoutSubmit}
                        disabled={saving || isOwned || !canSubmit}
                      >
                        {checkoutButtonLabel}
                      </button>
                    </div>,
                    document.body,
                  )}

                  {!isPixCheckout && (
                    <p className="portal-checkout-secure">
                      Pagamento 100% seguro, processado com criptografia 128bits.
                    </p>
                  )}

                  {pixError && <p className="portal-checkout-pix-error">{pixError}</p>}

                  {isPixCheckout && pixPayment && (
                    <section className="portal-pix-panel" aria-label="Pix gerado">
                      <span>Pix {pixPayment.status}</span>
                      <strong>{pixPayment.priceLabel}</strong>
                      {pixPayment.qrCodeBase64 && (
                        <img src={`data:image/png;base64,${pixPayment.qrCodeBase64}`} alt="QR Code Pix" />
                      )}
                      <label>
                        <small>Copia e cola</small>
                        <textarea value={pixPayment.qrCode} readOnly rows={4} />
                      </label>
                      <button
                        type="button"
                        onClick={() => navigator.clipboard?.writeText(pixPayment.qrCode).catch(() => undefined)}
                      >
                        Copiar PIX
                      </button>
                    </section>
                  )}

                  {isOwned && purchaseCode && (
                    <p className="portal-ffp-purchase-code">Codigo da compra: <b>{purchaseCode}</b></p>
                  )}
                </article>
              </div>
            </div>

            <div className="ffp-bottom-spacer" aria-hidden="true" />
          </div>
        </section>
      </main>

      {showAllFeatures && (
        <div className="ffp-feature-overlay" onClick={() => setShowAllFeatures(false)}>
          <div className="ffp-feature-panel" onClick={(event) => event.stopPropagation()}>
            <div className="ffp-feature-panel-head">
              <div>
                <span>Recursos inclusos</span>
                <h3>Mais de {planFeatureDisplayCount} funcoes</h3>
                <p>{planFeatureCount} funcoes organizadas por categoria.</p>
              </div>
              <button type="button" onClick={() => setShowAllFeatures(false)} aria-label="Fechar lista de funcoes">
                X
              </button>
            </div>
            <div className="ffp-feature-grid">
              {showcaseSections.map((section) => (
                <section key={section.title}>
                  <h4>{section.title}</h4>
                  <ul>
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PluginPageOld({
  chat,
  saving,
  pluginLink,
  onBuy,
}: {
  chat: Chat | null
  saving: boolean
  pluginLink: string
  onBuy: (target: PaymentTarget, link: string, label: string) => void
}) {
  const active = isPluginActive(chat)
  const purchaseCode = getPurchaseCode(chat)

  return (
    <section className="portal-page plugin-page">
      <div className="portal-hero plugin">
        <span>Ativacao final</span>
        <h1>ServiceSync Core</h1>
        <p>O plugin fecha a sincronizacao da conta e deixa tudo pronto para jogar.</p>
      </div>

      <section className="portal-plugin-card">
        <div className="plugin-status-grid">
          {pluginModules.map((module) => {
            const missing = module === 'ServiceSync Core' && !active

            return (
              <div key={module} className={missing ? 'missing' : 'ready'}>
                <i>{missing ? '!' : 'OK'}</i>
                <strong>{module}</strong>
                <small>{missing ? 'Pendente' : 'Validado'}</small>
              </div>
            )
          })}
        </div>

        <div className="plugin-offer">
          <span>Ativacao unica</span>
          <strong>R$ 79,90</strong>
          <p>Com o plugin ativo, sua conta fica permanente, com atualizacoes gratuitas e modulo final liberado.</p>
        </div>

        <button
          type="button"
          className={active ? 'owned' : ''}
          disabled={saving || active || !pluginLink}
          onClick={() => onBuy('plugin', pluginLink, 'Adquirir plugin')}
        >
          {active ? 'PLUGIN JA ADQUIRIDO' : 'Adquirir plugin'}
        </button>

        {active && purchaseCode && (
          <p className="portal-purchase-code">Codigo da compra: <b>{purchaseCode}</b></p>
        )}
      </section>
    </section>
  )
}

function PluginPage({
  chat,
  saving,
  pluginLink,
  onBuy,
  onBack,
}: {
  chat: Chat | null
  saving: boolean
  pluginLink: string
  onBuy: (target: PaymentTarget, link: string, label: string) => void
  onBack: () => void
}) {
  const active = isPluginActive(chat)
  const purchaseCode = getPurchaseCode(chat)
  const [recentPluginPurchaseIndex, setRecentPluginPurchaseIndex] = useState(0)
  const [livePluginStats, setLivePluginStats] = useState(initialPluginSocialStats)
  const lastAppliedPluginPurchaseIndex = useRef(0)
  const recentPluginPurchase = recentPluginPurchaseProofs[recentPluginPurchaseIndex % recentPluginPurchaseProofs.length]

  useEffect(() => {
    const interval = window.setInterval(() => {
      setRecentPluginPurchaseIndex((current) => (current + 1) % recentPluginPurchaseProofs.length)
    }, 6800)

    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (recentPluginPurchaseIndex === lastAppliedPluginPurchaseIndex.current) return

    lastAppliedPluginPurchaseIndex.current = recentPluginPurchaseIndex
    setLivePluginStats((currentStats) => ({
      boughtToday: currentStats.boughtToday + 1,
      activeUsers: currentStats.activeUsers + 1,
    }))
  }, [recentPluginPurchaseIndex])

  return (
    <div className="plan-fullscreen ffp-modal portal-ffp-page portal-plugin-ffp" role="region" aria-label="Plugin ServiceSync Core">
      <main className="ffp-page">
        <section className="ffp-poster">
          <div className="ffp-bg" aria-hidden="true">
            {planPosterSparks.map((spark) => (
              <span
                key={spark.id}
                className="ffp-spark"
                style={
                  {
                    '--spark-left': spark.left,
                    '--spark-top': spark.top,
                    '--spark-delay': spark.delay,
                    '--spark-size': spark.size,
                  } as CSSProperties
                }
              />
            ))}
            <span className="ffp-ring ffp-ring-a" />
            <span className="ffp-ring ffp-ring-b" />
          </div>

          <header className="ffp-controls portal-ffp-controls">
            <nav className="portal-mode-switch" aria-label="Area do cliente">
              <button className="portal-plugin-back" type="button" onClick={onBack}>Voltar</button>
              <a className="active" href="/plugins">Plugin</a>
            </nav>
          </header>

          <div className="ffp-content">
            <section className="ffp-hero portal-plugin-hero">
              <h3>
                Plugin
                <strong>ServiceSync</strong>
              </h3>
            </section>

            <div className="ffp-main-grid portal-plugin-grid">
              <div className="ffp-showcase" aria-hidden="true">
                <div className="ffp-cyber">
                  <span className="ffp-cyber-body" />
                  <span className="ffp-cyber-head" />
                  <span className="ffp-cyber-mask" />
                  <span className="ffp-cyber-eye eye-a" />
                  <span className="ffp-cyber-eye eye-b" />
                  <span className="ffp-cyber-chest">SYNC <b>CORE</b></span>
                  <span className="ffp-cyber-arm arm-a" />
                  <span className="ffp-cyber-arm arm-b" />
                  <span className="ffp-cyber-leg leg-a" />
                  <span className="ffp-cyber-leg leg-b" />
                  <span className="ffp-cyber-glow" />
                </div>
              </div>

              <div className="ffp-card-list portal-plugin-card-list" aria-label="Comprar plugin">
                <article className={`ffp-price-card ffp-lifetime selected ${active ? 'portal-owned-plan' : ''}`}>
                  <span className={`ffp-top-badge ${active ? '' : 'is-pending'}`}>{active ? 'Ativo' : 'Modulo pendente'}</span>
                  <div className="ffp-plan-head">
                    <span className="ffp-plan-icon" aria-hidden="true" />
                    <div>
                      <span>Plugin</span>
                      <h4>ServiceSync Core</h4>
                      <small>Pagamento unico</small>
                    </div>
                  </div>

                  <div className="portal-plugin-progress">
                    <div>
                      <span>Conta protegida</span>
                      <strong>{active ? 'liberado' : 'quase pronto'}</strong>
                    </div>
                    <i aria-hidden="true" />
                  </div>

                  <div className="ffp-item-list">
                    {[
                      'Todas as funcoes do xit liberadas',
                      'Execucao completa sem erro de sincronizacao',
                      'Conta pronta para jogar apos a confirmacao',
                      'ServiceSync Core ativado nesta conta',
                      'Ganha a versao vitalicia e atualizacao gratuitas',
                    ].map((item) => (
                      <span key={item}>
                        <i aria-hidden="true" />
                        <b>{item}</b>
                      </span>
                    ))}
                    {!active && (
                      <span className="ffp-plugin-included-note">
                        <i aria-hidden="true" />
                        <b>Vem com o plugin</b>
                        <small>Apos isso nao precisa pagar por mais nada.</small>
                      </span>
                    )}
                  </div>

                  <div className="ffp-price">
                    <div className="ffp-price-compare">
                      <span>Pagamento unico</span>
                      <s>R$ 149,90</s>
                    </div>
                    <div className="ffp-price-row">
                      <div className="ffp-price-value" aria-label="R$ 79,90">
                        <em>Por</em>
                        <span>R$</span>
                        <strong>79</strong>
                        <b>,90</b>
                      </div>
                      <small>vitalicio</small>
                    </div>
                  </div>

                  <button
                    type="button"
                    className={`ffp-buy-button ${active ? 'portal-owned-button' : ''}`}
                    disabled={saving || active || !pluginLink}
                    onClick={() => onBuy('plugin', pluginLink, 'Adquirir plugin')}
                  >
                    {!pluginLink
                      ? 'Link indisponivel'
                      : active
                        ? (
                            <>
                              <i aria-hidden="true" />
                              PLUGIN JA ADQUIRIDO
                            </>
                          )
                        : 'Adquirir plugin'}
                    {!active && <span aria-hidden="true">&gt;</span>}
                  </button>

                  {active && purchaseCode && (
                    <p className="portal-ffp-purchase-code">Codigo da compra: <b>{purchaseCode}</b></p>
                  )}

                  <div className="portal-plugin-after" aria-label="Resultado apos ativar o plugin">
                    <div className="portal-plugin-after-head">
                      <span>Depois do pagamento</span>
                      <strong>Conta pronta para jogar</strong>
                    </div>
                    <div className="portal-plugin-after-grid">
                      <span>
                        <b>1</b>
                        <strong>ServiceSync ativo</strong>
                        <small>O modulo pendente e liberado nesta conta.</small>
                      </span>
                      <span>
                        <b>2</b>
                        <strong>Funcoes completas</strong>
                        <small>O xit deixa de reverter os controles.</small>
                      </span>
                      <span>
                        <b>3</b>
                        <strong>Uso vitalicio</strong>
                        <small>Plano permanente e atualizacoes gratuitas.</small>
                      </span>
                    </div>
                    <div className="portal-plugin-proof-row">
                      <span>
                        <b>{active ? '7/7' : '6/7'}</b>
                        <small>{active ? 'modulos sincronizados' : 'modulos prontos, falta o ServiceSync'}</small>
                      </span>
                      <span>
                        <b>+{livePluginStats.activeUsers}</b>
                        <small>clientes com plugin ativo</small>
                      </span>
                      <span>
                        <b>+{livePluginStats.boughtToday}</b>
                        <small>plugins hoje</small>
                      </span>
                    </div>
                  </div>
                </article>
              </div>
            </div>

            <div className="ffp-bottom-spacer" aria-hidden="true" />

            <div className="ffp-purchase-toast portal-plugin-purchase-toast" aria-live="polite">
              <i aria-hidden="true" />
              <div>
                <small>Plugin ao vivo</small>
                <strong>{recentPluginPurchase.name} ativou agora</strong>
                <span>{recentPluginPurchase.phone} - ServiceSync Core liberado.</span>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

function ApprovalModal({ notice, onClose }: { notice: PaymentNotice; onClose: () => void }) {
  return (
    <div className="portal-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="portal-approved-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Pagamento aprovado"
        onClick={(event) => event.stopPropagation()}
      >
        <span>Aprovado</span>
        <h2>{notice.title}</h2>
        <p>{notice.text}</p>
        <div>
          <small>Codigo da compra</small>
          <strong>{notice.code}</strong>
        </div>
        <button type="button" onClick={onClose}>
          Fechar
        </button>
      </section>
    </div>
  )
}

function DownloadPage({
  chat,
  selectedDevice,
  settings,
  onBack,
  onDownloadClick,
}: {
  chat: Chat | null
  selectedDevice: DeviceType | ''
  settings: AppUpdateSettings
  onBack: () => void
  onDownloadClick: () => void
}) {
  const device = getSelectedDevice(chat, selectedDevice)
  const activePlan = getActivePlan(chat)
  const planName = activePlan ? gamePlanVisuals[activePlan].displayName : 'Sem plano ativo'
  const accountLogin = chat?.accessUsername || ''
  const [copiedLogin, setCopiedLogin] = useState(false)
  const hasDownload = Boolean(settings.apkUrl)
  const downloadEnabled = canDownloadXit(device) && Boolean(activePlan) && hasDownload
  const noActivePlanMessage = 'Obtenha um plano ativo primeiro. O download do xit so fica disponivel apos um plano ativo.'
  const unavailableMessage = !activePlan
    ? noActivePlanMessage
    : device === 'ios'
      ? `Download do xit nao esta disponivel para o plano adquirido (${planName}). Verifique com o vendedor antes de tentar instalar.`
      : !canDownloadXit(device)
        ? 'Este dispositivo nao possui download liberado nesta pagina. Verifique com o vendedor antes de tentar instalar.'
        : 'Link de download ainda nao cadastrado. Verifique com o vendedor.'
  const tutorial = downloadEnabled
    ? downloadTutorials[device]
    : activePlan && device === 'ios'
      ? [
          `O plano adquirido e ${planName}, mas o download do xit nao esta disponivel para iOS nesta pagina.`,
          'Verifique com o vendedor antes de tentar instalar qualquer arquivo.',
          'Mantenha seu WhatsApp autenticado para conferir liberacao, troca de plano ou orientacao correta.',
        ]
      : [
          'Autentique seu WhatsApp no Gordin du Xit.',
          'Obtenha um plano ativo antes de tentar baixar.',
          'Volte nesta pagina quando o plano estiver ativo para liberar o download.',
        ]
  async function handleCopyLogin() {
    if (!accountLogin) {
      return
    }

    function copyWithTemporaryInput() {
      const input = document.createElement('textarea')
      input.value = accountLogin
      input.setAttribute('readonly', 'true')
      input.style.position = 'fixed'
      input.style.left = '-9999px'
      input.style.top = '0'
      document.body.appendChild(input)
      input.focus()
      input.select()
      input.setSelectionRange(0, accountLogin.length)

      try {
        document.execCommand('copy')
        return true
      } finally {
        document.body.removeChild(input)
      }
    }

    let copied = false

    try {
      copied = copyWithTemporaryInput()
    } catch {
      copied = false
    }

    if (!copied) {
      try {
        if (!navigator.clipboard?.writeText) {
          throw new Error('clipboard unavailable')
        }

        await Promise.race([
          navigator.clipboard.writeText(accountLogin),
          new Promise<never>((_, reject) => {
            window.setTimeout(() => reject(new Error('clipboard timeout')), 250)
          }),
        ])
        copied = true
      } catch {
        copied = false
      }
    }

    if (!copied) {
      copied = true
    }

    if (copied) {
      setCopiedLogin(true)
      window.setTimeout(() => setCopiedLogin(false), 1600)
    } else {
      setCopiedLogin(false)
    }
  }

  return (
    <div className="plan-fullscreen ffp-modal portal-ffp-page portal-download-page" role="region" aria-label="Baixar Gordin du Xit">
      <main className="ffp-page">
        <section className="ffp-poster">
          <div className="ffp-bg" aria-hidden="true">
            {planPosterSparks.map((spark) => (
              <span
                key={spark.id}
                className="ffp-spark"
                style={
                  {
                    '--spark-left': spark.left,
                    '--spark-top': spark.top,
                    '--spark-delay': spark.delay,
                    '--spark-size': spark.size,
                  } as CSSProperties
                }
              />
            ))}
            <span className="ffp-ring ffp-ring-a" />
            <span className="ffp-ring ffp-ring-b" />
          </div>

          <header className="ffp-controls portal-ffp-controls">
            <nav className="portal-mode-switch" aria-label="Navegacao do download">
              <button className="portal-plugin-back" type="button" onClick={onBack}>Voltar</button>
              <a className="active" href="/acesso-aqui">Download</a>
            </nav>
          </header>

          <div className="ffp-content portal-download-content">
            <section className="ffp-hero portal-download-hero">
              <h3>
                <span>BAIXAR</span>
                {' '}
                <strong>O XIT</strong>
              </h3>
            </section>

            <div className="portal-download-grid">
              <section className="portal-download-main-card">
                <div className="portal-download-product">
                  <span aria-hidden="true">GX</span>
                  <div>
                    <small>Versao atual</small>
                    <strong>{settings.latestVersionName || '1.0'}</strong>
                  </div>
                </div>

                {downloadEnabled ? (
                  <a
                    className="portal-download-primary"
                    href={settings.apkUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={onDownloadClick}
                  >
                    BAIXAR XIT
                  </a>
                ) : (
                  <p className="portal-download-unavailable">
                    {unavailableMessage}
                  </p>
                )}

                <div className="portal-download-status-grid portal-download-status-compact">
                  <span className="portal-download-login-item">
                    <small>Numero para entrar no xit</small>
                    <b>{accountLogin || 'Autentique seu WhatsApp'}</b>
                    {accountLogin && (
                      <button type="button" onClick={handleCopyLogin}>
                        {copiedLogin ? 'Copiado' : 'Copiar'}
                      </button>
                    )}
                  </span>
                  <span>
                    <small>Plano atual</small>
                    <b>{planName}</b>
                  </span>
                </div>
              </section>

              <section className="portal-download-guide" aria-label="Passos de instalacao">
                <span>Como instalar</span>
                <h4>{downloadEnabled ? 'Instalacao limpa' : 'Antes de baixar'}</h4>
                <ol>
                  {tutorial.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </section>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

function PcAccessPage({
  chat,
  settings,
}: {
  chat: Chat | null
  settings: PcAccessSettings
}) {
  const entries: Array<{ type: ResellerAccessType; label: string }> = [
    { type: 'internal', label: 'Internal' },
    { type: 'external', label: 'External' },
  ]
  const activeEntries = entries
    .map((entry) => ({
      ...entry,
      access: getResellerAccess(chat, entry.type),
      download: settings[entry.type],
    }))
    .filter((entry) => Boolean(entry.access))
  const tutorialGroups = activeEntries
    .map((entry) => ({
      ...entry,
      links: [
        ...(entry.download.tutorials || []),
        ...(entry.download.tutorialUrl ? [{ label: `Tutorial ${entry.label}`, url: entry.download.tutorialUrl }] : []),
      ],
    }))
    .filter((entry) => entry.links.length > 0)
  const fixErrorGroups = activeEntries
    .map((entry) => ({
      ...entry,
      links: entry.download.fixErrors || [],
    }))
    .filter((entry) => entry.links.length > 0)

  return (
    <div className="plan-fullscreen ffp-modal portal-ffp-page portal-download-page" role="region" aria-label="Acesso PC">
      <main className="ffp-page">
        <section className="ffp-poster">
          <div className="ffp-content portal-download-content">
            <section className="ffp-hero portal-download-hero">
              <span className="ffp-badge">Acesso PC</span>
              <h3><span>acesso</span> <strong>pc</strong></h3>
              <p>Downloads liberados apos confirmacao do Pix. A key final e enviada pelo atendimento no WhatsApp.</p>
            </section>

            <div className="portal-download-grid">
              {entries.map(({ type, label }) => {
                const access = getResellerAccess(chat, type)
                const purchases = getResellerPurchases(chat, type)
                const download = settings[type]
                const files = download.files?.length
                  ? download.files
                  : download.downloadUrl
                    ? [{ label: download.title || label, url: download.downloadUrl }]
                    : []
                const available = Boolean(access && download.enabled && files.length > 0)

                return (
                  <section key={type} className="portal-download-main-card">
                    <div className="portal-download-product">
                      <span>{label.slice(0, 3).toUpperCase()}</span>
                      <div>
                        <small>{label}</small>
                        <strong>{download.title || label}</strong>
                        <p>{access ? `Plano ${planOptions.find((plan) => plan.value === access.plan)?.label || access.plan} ativo.` : 'Nenhum plano ativo nesta categoria.'}</p>
                      </div>
                    </div>

                    {available ? (
                      <div className="portal-pc-download-files">
                        {files.map((file) => (
                          <a
                            key={`${type}-${file.label}-${file.url}`}
                            className="portal-download-primary"
                            href={file.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Baixar {file.label}
                          </a>
                        ))}
                        {download.tutorialUrl && (
                          <a
                            className="portal-download-secondary"
                            href={download.tutorialUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Ver tutorial
                          </a>
                        )}
                      </div>
                    ) : (
                      <p className="portal-download-unavailable">
                        {!access
                          ? `Compre e confirme o ${label} para liberar este download.`
                          : 'Download ainda nao cadastrado no painel admin.'}
                      </p>
                    )}

                    <div className="portal-download-status-grid portal-download-status-compact">
                      <span>
                        <small>Status</small>
                        <b>{access ? 'Compra confirmada' : 'Pendente'}</b>
                      </span>
                      <span>
                        <small>Versao</small>
                        <b>{download.versionName || '1.0'}</b>
                      </span>
                    </div>

                    {purchases.length > 0 && (
                      <div className="portal-pc-purchase-list">
                        <small>Compras registradas</small>
                        {purchases.map((purchase) => {
                          const planLabel = planOptions.find((plan) => plan.value === purchase.plan)?.label || purchase.plan || 'Plano'
                          const expiresAt = purchase.expiresAt?.toDate?.()

                          return (
                            <span key={purchase.id || purchase.paymentCode}>
                              <b>{planLabel}</b>
                              <em>{purchase.priceLabel || ''}</em>
                              <strong>{purchase.paymentCode || purchase.platformCode || purchase.id}</strong>
                              <i>{expiresAt ? `Expira ${expiresAt.toLocaleDateString('pt-BR')}` : 'Lifetime'}</i>
                            </span>
                          )
                        })}
                      </div>
                    )}

                    {download.notes && <p className="portal-download-unavailable">{download.notes}</p>}
                  </section>
                )
              })}
            </div>

            {tutorialGroups.length > 0 && (
              <section className="portal-pc-resource-section" aria-label="Tutoriais">
                <div className="portal-pc-resource-head">
                  <span>Tutoriais</span>
                  <strong>Instalacao e uso</strong>
                </div>
                <div className="portal-pc-resource-grid">
                  {tutorialGroups.map(({ type, label, links }) => (
                    <article key={`tutorial-${type}`} className="portal-pc-resource-card">
                      <small>{label}</small>
                      <strong>Acessar tutoriais {label}</strong>
                      <div>
                        {links.map((item) => (
                          <a
                            key={`${type}-tutorial-${item.label}-${item.url}`}
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {item.label}
                          </a>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {fixErrorGroups.length > 0 && (
              <section className="portal-pc-resource-section" aria-label="Fix erros">
                <div className="portal-pc-resource-head">
                  <span>Fix errors</span>
                  <strong>Erros e solucoes</strong>
                </div>
                <div className="portal-pc-resource-grid">
                  {fixErrorGroups.map(({ type, label, links }) => (
                    <article key={`fix-${type}`} className="portal-pc-resource-card">
                      <small>{label}</small>
                      <strong>Correcoes {label}</strong>
                      <div>
                        {links.map((item) => (
                          <a
                            key={`${type}-fix-${item.label}-${item.url}`}
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {item.label}
                          </a>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

function DownloadModal({
  device,
  settings,
  onClose,
}: {
  device: DeviceType | ''
  settings: AppUpdateSettings
  onClose: () => void
}) {
  const selectedDevice = device || 'android'
  const downloadLabel = getDownloadButtonLabel(selectedDevice)
  const tutorial = downloadTutorials[selectedDevice]
  const hasDownload = Boolean(settings.apkUrl)

  return (
    <div className="portal-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="portal-download-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Download do xit"
        onClick={(event) => event.stopPropagation()}
      >
        <span>{deviceLabelMap[selectedDevice]}</span>
        <h2>{downloadLabel}</h2>
        <p>Baixe a versao liberada para sua conta e entre com o mesmo WhatsApp cadastrado no portal.</p>

        <div className="portal-download-info">
          <small>Versao</small>
          <strong>{settings.latestVersionName || '1.0'}</strong>
        </div>

        {hasDownload ? (
          <a
            className="portal-download-action"
            href={settings.apkUrl}
            target="_blank"
            rel="noreferrer"
          >
            Abrir link de download
          </a>
        ) : (
          <p className="portal-download-warning">
            Link de download ainda nao cadastrado. Verifique com o vendedor.
          </p>
        )}

        <ol className="portal-download-steps">
          {tutorial.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>

        <button type="button" onClick={onClose}>
          Fechar
        </button>
      </section>
    </div>
  )
}

function NotFoundAccess() {
  return (
    <PortalErrorState
      title="Pagina nao encontrada"
      text="Esse acesso nao esta disponivel ou nao pertence a esta conta do Gordin du Xit."
      primaryLabel="Ir para planos"
      primaryHref="/planos"
    />
  )
}

export function ClientPortal({
  initialTab = 'plans',
  checkoutPlan,
  checkoutMode = 'external',
  checkoutContext = 'external',
  downloadPage = false,
  pcAccessPage = false,
  previewAuth = false,
  previewPlugin = false,
}: {
  initialTab?: PortalTab
  checkoutPlan?: PlanType
  checkoutMode?: CheckoutMode
  checkoutContext?: CheckoutContext
  downloadPage?: boolean
  pcAccessPage?: boolean
  previewAuth?: boolean
  previewPlugin?: boolean
}) {
  const [chatId, setChatId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [selectedDevice, setSelectedDevice] = useState<DeviceType | ''>('')
  const [selectedPlan, setSelectedPlan] = useState<PlanType | ''>('')
  const [chatMeta, setChatMeta] = useState<Chat | null>(null)
  const [loading, setLoading] = useState(true)
  const [accessLoading, setAccessLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [blockedAccess, setBlockedAccess] = useState(() => getStoredAccountBlocked())
  const [paymentProvider, setPaymentProvider] = useState<PaymentProvider>('perfect-pay')
  const [paymentLinks, setPaymentLinks] = useState<Record<PlanType, string>>(getPaymentLinks('perfect-pay'))
  const [planOptionsList, setPlanOptionsList] = useState<PlanOption[]>(planOptions)
  const [pluginPaymentLink, setPluginPaymentLink] = useState(getPluginPaymentLink('perfect-pay'))
  const [pixPayment, setPixPayment] = useState<PixCheckoutResult | null>(null)
  const [pixError, setPixError] = useState('')
  const [approvalNotice, setApprovalNotice] = useState<PaymentNotice | null>(null)
  const [appUpdateSettings, setAppUpdateSettings] = useState<AppUpdateSettings>(defaultAppUpdateSettings)
  const [pcAccessSettings, setPcAccessSettings] = useState<PcAccessSettings>(defaultPcAccessSettings)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [authPreview, setAuthPreview] = useState(previewAuth)
  const activePlan = getActivePlan(chatMeta)
  const currentDevice = getSelectedDevice(chatMeta, selectedDevice)
  const canOpenPlugin = Boolean(activePlan && (currentDevice === 'android' || currentDevice === 'emulator'))
  const visibleTab = initialTab === 'plugins' && canOpenPlugin ? 'plugins' : 'plans'
  const expectedAuthReturnPath = checkoutPlan
    ? checkoutMode === 'pix'
      ? getPixCheckoutPath(checkoutPlan, checkoutContext)
      : checkoutPlanPaths[checkoutPlan]
    : downloadPage
      ? '/acesso-aqui'
      : pcAccessPage
        ? '/acesso-pc'
        : initialTab === 'plugins'
          ? '/plugins'
          : ''

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setAuthPreview(previewAuth || params.get('preview') === 'login' || params.get('loginPreview') === '1')
  }, [previewAuth])

  useEffect(() => {
    let active = true

    async function loadPaymentSettings() {
      try {
        const response = await fetch('/api/payment/settings', { cache: 'no-store' })
        const payload = (await response.json()) as {
          paymentProvider?: PaymentProvider
          links?: Record<PlanType, string>
          plans?: PublicPlanCatalogItem[]
          pluginLink?: string
        }

        if (!active || !response.ok) return
        const provider =
          payload.paymentProvider === 'kiwify' || payload.paymentProvider === 'perfect-pay'
            ? payload.paymentProvider
            : 'perfect-pay'
        setPaymentProvider(provider)
        setPaymentLinks(payload.links || getPaymentLinks(provider))
        if (payload.plans?.length) {
          setPlanOptionsList(payload.plans.map((plan) => ({
            value: plan.value,
            label: plan.label,
            price: plan.price,
            priceLabel: plan.priceLabel,
            badge: plan.badge,
            detail: plan.detail,
          })))
        }
        setPluginPaymentLink(payload.pluginLink || getPluginPaymentLink(provider))
      } catch {
        if (active) {
          setPaymentProvider('perfect-pay')
          setPaymentLinks(getPaymentLinks('perfect-pay'))
          setPluginPaymentLink(getPluginPaymentLink('perfect-pay'))
        }
      }
    }

    loadPaymentSettings()
    const interval = window.setInterval(loadPaymentSettings, 15000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    async function boot() {
      try {
        await ensureAnonymousSession()
        const sessionAccess = await checkClientSessionAccess()
        if (sessionAccess.blocked) {
          setBlockedAccess(true)
          setLoading(false)
          return
        }

        const params = new URLSearchParams(window.location.search)
        const loginRequested = params.get('login') === '1' || params.get('entrar') === '1'

        if (loginRequested) {
          clearClientSession()
          storeAccountBlocked(false)
          setChatMeta(null)
          setChatId('')
          setAccountId('')
          setSelectedDevice('')
          setSelectedPlan('')
          setBlockedAccess(false)
          setLoading(false)
          return
        }

        const storedChatId = getStoredChatId() || ''
        setChatId(storedChatId)
        setAccountId(getStoredAccountId())
        setSelectedDevice((storedChatId ? getStoredDevice(storedChatId) : '') as DeviceType | '')
        setSelectedPlan((storedChatId ? getStoredPlan(storedChatId) : '') as PlanType | '')
        setBlockedAccess(false)
        setLoading(false)
      } catch (bootError) {
        console.error('Erro ao iniciar area do cliente:', bootError)
        setError('Nao foi possivel iniciar a area do cliente.')
        setLoading(false)
      }
    }

    boot()
  }, [])

  useEffect(() => {
    if (!downloadPage || !chatId) return undefined

    let active = true

    loadAppUpdateSettings({ chatId, accountId })
      .then((settings) => {
        if (active) setAppUpdateSettings(settings)
      })
      .catch((settingsError) => {
        console.error('Nao foi possivel carregar o download do app:', settingsError)
      })

    return () => {
      active = false
    }
  }, [accountId, downloadPage, chatId])

  useEffect(() => {
    if (!pcAccessPage || !chatId) return undefined

    let active = true

    loadPcAccessSettings({ chatId, accountId })
      .then((settings) => {
        if (active) setPcAccessSettings(settings)
      })
      .catch((settingsError) => {
        console.error('Nao foi possivel carregar os downloads PC:', settingsError)
      })

    return () => {
      active = false
    }
  }, [accountId, pcAccessPage, chatId])

  useEffect(() => {
    if (!chatId) {
      setChatMeta(null)
      return undefined
    }

    return listenChat(chatId, (chat) => {
      setChatMeta(chat)
      if (isAccountAccessBlocked(chat)) {
        storeAccountBlocked(true)
        setBlockedAccess(true)
        return
      }

      storeAccountBlocked(false)
      setBlockedAccess(false)

      const notice = makeApprovalNotice(chat)
      if (!notice) return
      const seenKey = `${approvalKeyPrefix}-${notice.code}-${notice.target}`
      if (getSecureItem(seenKey) !== '1') setApprovalNotice(notice)
    })
  }, [chatId])

  async function handleLogin(
    phoneValue: string,
    passwordValue: string,
    device: DeviceType,
    mode: AuthMode,
  ) {
    setError('')
    setAccessLoading(true)

    try {
      const access = await requestChatAccess({
        username: phoneValue,
        password: passwordValue,
        device,
        mode,
        clientId: getClientId(),
        requestedChatId: getStoredChatId() || makeId('site'),
      })

      storeChatId(access.chatId)
      storeAccountId(access.accountId)
      storeUsername(access.accessUsername)
      setChatId(access.chatId)
      setAccountId(access.accountId)

      const recoveredDevice = access.profile.device || getStoredDevice(access.chatId)
      const recoveredPlan = access.profile.plan || getStoredPlan(access.chatId)

      if (!recoveredDevice) {
        await saveDeviceSelection({
          chatId: access.chatId,
          accountId: access.accountId,
          device,
        })
        storeDevice(access.chatId, device)
        setSelectedDevice(device)
      } else {
        storeDevice(access.chatId, recoveredDevice)
        setSelectedDevice(recoveredDevice)
      }

      if (recoveredPlan) {
        storePlan(access.chatId, recoveredPlan)
        setSelectedPlan(recoveredPlan)
      }

      if (expectedAuthReturnPath && window.location.pathname !== expectedAuthReturnPath) {
        window.history.replaceState(null, '', expectedAuthReturnPath)
      }
    } catch (accessError) {
      const message = accessError instanceof Error ? accessError.message : 'Acesso invalido.'
      if (accessError instanceof ChatAccessError && accessError.code === 'account_exists') {
        return { message, switchTo: 'login' as const }
      }
      if (accessError instanceof ChatAccessError && accessError.code === 'account_not_found') {
        return { message, switchTo: 'signup' as const }
      }
      if (accessError instanceof ChatAccessError && accessError.code === 'account_blocked') {
        storeAccountBlocked(true)
        setBlockedAccess(true)
        return { message }
      }
      setError(message)
      return { message }
    } finally {
      setAccessLoading(false)
    }

    return undefined
  }

  async function handleBuy(target: PaymentTarget, link: string, label: string) {
    if (!chatId || !accountId || saving) return
    setSaving(true)
    setError('')

    let paymentWindow: Window | null = null

    try {
      const trackedPaymentLink = addPaymentTrackingToLink(link, chatId, target, paymentProvider)
      paymentWindow = window.open('', '_blank')
      if (paymentWindow) {
        paymentWindow.opener = null
        paymentWindow.document.title = 'Abrindo pagamento'
        paymentWindow.document.body.innerHTML =
          '<main style="min-height:100vh;display:grid;place-items:center;background:#020617;color:#fff;font-family:Arial,sans-serif;text-align:center"><div><strong>Abrindo pagamento...</strong><p style="color:#cbd5e1">Aguarde um instante.</p></div></main>'
      }

      await registerPaymentClick({
        chatId,
        accountId,
        plan: target,
        paymentLink: trackedPaymentLink,
        paymentLabel: label,
        paymentProvider,
      })

      if (target !== 'plugin') {
        await savePlanSelection({ chatId, accountId, plan: target })
        storePlan(chatId, target)
        setSelectedPlan(target)
      }

      if (paymentWindow && !paymentWindow.closed) {
        paymentWindow.location.replace(trackedPaymentLink)
      } else {
        window.location.assign(trackedPaymentLink)
      }
    } catch (paymentError) {
      if (paymentWindow && !paymentWindow.closed) paymentWindow.close()
      setError(paymentError instanceof Error ? paymentError.message : 'Nao foi possivel abrir o pagamento.')
    } finally {
      setSaving(false)
    }
  }

  async function handleGeneratePix(plan: PlanType, context: CheckoutContext) {
    if (!chatId || !accountId || saving) return
    setSaving(true)
    setError('')
    setPixError('')
    setPixPayment(null)

    try {
      await savePlanSelection({ chatId, accountId, plan })
      storePlan(chatId, plan)
      setSelectedPlan(plan)

      const user = await ensureAnonymousSession()
      const idToken = await user.getIdToken()
      const response = await fetch('/api/payment/pix', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          idToken,
          chatId,
          accountId,
          plan,
          context,
        }),
      })
      const payload = (await response.json()) as PixCheckoutResult & { error?: string }

      if (!response.ok || !payload.qrCode) {
        throw new Error(payload.error || 'Nao foi possivel gerar o Pix.')
      }

      setPaymentProvider('mercado-pago')
      setPixPayment(payload)
    } catch (pixGenerationError) {
      const message = pixGenerationError instanceof Error ? pixGenerationError.message : 'Nao foi possivel gerar o Pix.'
      setPixError(message)
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  async function handleOpenDownload() {
    if (!canDownloadXit(currentDevice)) return

    if (!chatId || !accountId) return
    registerClientActivity({
      chatId,
      accountId,
      type: 'button_clicked',
      label: getDownloadButtonLabel(currentDevice),
      key: 'open_xit_download',
      meta: {
        device: currentDevice || null,
        version: appUpdateSettings.latestVersionName || null,
      },
    }).catch((activityError) => {
      console.error('Nao foi possivel registrar o clique de download:', activityError)
    })

      window.location.assign('/acesso-aqui')
  }

  function handleDownloadLinkClick() {
    if (!chatId || !accountId) return
    registerClientActivity({
      chatId,
      accountId,
      type: 'button_clicked',
      label: 'Baixar Gordin du Xit',
      key: 'download_xit_file',
      meta: {
        device: currentDevice || null,
        version: appUpdateSettings.latestVersionName || null,
      },
    }).catch((activityError) => {
      console.error('Nao foi possivel registrar o download do xit:', activityError)
    })
  }

  function handleBackFromPlugin() {
    if (window.history.length > 1) {
      window.history.back()
      return
    }

    window.location.assign('/planos')
  }

  function closeApprovalNotice() {
    if (approvalNotice) {
      setSecureItem(`${approvalKeyPrefix}-${approvalNotice.code}-${approvalNotice.target}`, '1')
    }
    setApprovalNotice(null)
  }

  if (authPreview) {
    return (
      <AuthScreen
        defaultPhone=""
        loading={false}
        error=""
        onSubmit={async () => ({ message: 'Preview visual: use a pagina normal para entrar.' })}
      />
    )
  }

  if (previewPlugin) {
    return (
      <main className="portal-shell">
        <PluginPage
          chat={null}
          saving={false}
          pluginLink={pluginPaymentLink}
          onBuy={() => undefined}
          onBack={() => window.location.assign('/planos')}
        />
        <PortalStyles />
      </main>
    )
  }

  if (blockedAccess) return <NotFoundAccess />
  if (loading) return <main className="portal-shell" aria-hidden="true" />
  if (!chatId) {
    return (
      <AuthScreen
        defaultPhone={getStoredUsername()}
        loading={accessLoading}
        error={error}
        onSubmit={handleLogin}
      />
    )
  }

  return (
    <main className="portal-shell">
      {error && <div className="portal-error-banner">{error}</div>}

      {pcAccessPage ? (
        <PcAccessPage chat={chatMeta} settings={pcAccessSettings} />
      ) : downloadPage ? (
        <DownloadPage
          chat={chatMeta}
          selectedDevice={selectedDevice}
          settings={appUpdateSettings}
          onBack={handleBackFromPlugin}
          onDownloadClick={handleDownloadLinkClick}
        />
      ) : checkoutPlan ? (
        <PlanCheckoutPage
          chat={chatMeta}
          plan={checkoutPlan}
          checkoutMode={checkoutMode}
          checkoutContext={checkoutContext}
          canOpenPlugin={canOpenPlugin}
          selectedDevice={selectedDevice}
          selectedPlan={selectedPlan}
          saving={saving}
          paymentLinks={paymentLinks}
          planOptionsList={planOptionsList}
          pixPayment={pixPayment}
          pixError={pixError}
          onBuy={handleBuy}
          onGeneratePix={handleGeneratePix}
        />
      ) : visibleTab === 'plugins' ? (
        <PluginPage
          chat={chatMeta}
          saving={saving}
          pluginLink={pluginPaymentLink}
          onBuy={handleBuy}
          onBack={handleBackFromPlugin}
        />
      ) : (
        <PlansPage
          chat={chatMeta}
          canOpenPlugin={canOpenPlugin}
          selectedDevice={selectedDevice}
          selectedPlan={selectedPlan}
          saving={saving}
          paymentLinks={paymentLinks}
          paymentProvider={paymentProvider}
          onBuy={handleBuy}
          onDownload={handleOpenDownload}
        />
      )}

      {approvalNotice && <ApprovalModal notice={approvalNotice} onClose={closeApprovalNotice} />}
      {downloadOpen && (
        <DownloadModal
          device={currentDevice}
          settings={appUpdateSettings}
          onClose={() => setDownloadOpen(false)}
        />
      )}
      <PortalStyles />
    </main>
  )
}

function PortalStyles() {
  return (
    <style jsx global>{`
      .portal-shell {
        min-height: 100vh;
        background:
          radial-gradient(circle at 12% 0%, rgba(14, 165, 233, 0.18), transparent 26rem),
          radial-gradient(circle at 92% 12%, rgba(34, 197, 94, 0.13), transparent 24rem),
          linear-gradient(180deg, #06111f 0%, #08131f 44%, #f8fafc 44%, #eef2f7 100%);
        color: #0f172a;
        padding: 14px;
      }

      .portal-shell.auth-shell {
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at 15% 12%, rgba(14, 165, 233, 0.18), transparent 24rem),
          radial-gradient(circle at 85% 0%, rgba(34, 197, 94, 0.14), transparent 22rem),
          #06111f;
      }

      .portal-auth {
        position: relative;
        overflow: hidden;
        width: min(100%, 480px);
        display: grid;
        gap: 16px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 28px;
        background:
          radial-gradient(circle at 20% 0%, rgba(251, 146, 60, 0.24), transparent 34%),
          linear-gradient(180deg, rgba(20, 24, 42, 0.96), rgba(5, 7, 16, 0.98));
        color: #ffffff;
        padding: clamp(18px, 5vw, 28px);
        box-shadow:
          0 28px 80px rgba(0, 0, 0, 0.42),
          inset 0 0 0 1px rgba(255, 255, 255, 0.035);
      }

      .portal-auth > *:not(.portal-auth-bg) {
        position: relative;
        z-index: 1;
      }

      .portal-auth-bg {
        position: absolute;
        inset: 0;
        overflow: hidden;
        pointer-events: none;
      }

      .portal-auth-bg span {
        position: absolute;
        left: var(--spark-left);
        top: var(--spark-top);
        width: var(--spark-size);
        height: var(--spark-size);
        border-radius: 999px;
        background: #fbbf24;
        box-shadow: 0 0 16px rgba(251, 191, 36, 0.72);
        opacity: 0.48;
        animation: ffpSpark 4.8s ease-in-out infinite;
        animation-delay: var(--spark-delay);
      }

      .portal-auth-bg i {
        position: absolute;
        inset: auto -20% -28% -20%;
        height: 42%;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(14, 165, 233, 0.18), transparent 62%);
      }

      .portal-auth-copy span,
      .portal-auth-confirm-modal > span,
      .portal-hero span,
      .portal-topbar span,
      .portal-plan-head span,
      .plugin-offer span,
      .portal-download-modal > span,
      .portal-approved-modal > span {
        color: #0284c7;
        font-size: 12px;
        font-weight: 950;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .portal-auth h1,
      .portal-hero h1 {
        margin: 6px 0 0;
        color: #0f172a;
        font-size: clamp(38px, 10vw, 62px);
        line-height: 0.9;
        letter-spacing: 0;
      }

      .portal-auth h1 {
        color: #ffffff;
        font-size: clamp(54px, 14vw, 82px);
        font-style: italic;
        text-transform: uppercase;
        text-shadow: 0 16px 36px rgba(0, 0, 0, 0.42);
      }

      .portal-auth h1 strong {
        display: block;
        background: linear-gradient(135deg, #f97316 0%, #facc15 38%, #22c55e 72%, #22d3ee 100%);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
      }

      .portal-auth p,
      .portal-hero p {
        margin: 10px 0 0;
        color: #64748b;
        line-height: 1.42;
      }

      .portal-auth p {
        border: 1px solid rgba(255, 255, 255, 0.09);
        border-radius: 16px;
        background: rgba(0, 0, 0, 0.24);
        color: rgba(255, 255, 255, 0.78);
        padding: 10px 12px;
        font-size: 13px;
        font-weight: 850;
        text-align: center;
      }

      .portal-auth-tabs,
      .portal-topbar nav {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px;
        padding: 5px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 8px;
        background: rgba(2, 6, 23, 0.36);
      }

      .portal-auth-tabs button,
      .portal-topbar nav a {
        min-height: 42px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        background: transparent;
        color: rgba(255, 255, 255, 0.72);
        font-weight: 900;
        text-decoration: none;
      }

      .portal-auth-tabs .active,
      .portal-topbar nav .active {
        background: linear-gradient(135deg, #22c55e, #0ea5e9);
        color: #02030a;
        box-shadow: 0 10px 22px rgba(14, 165, 233, 0.22);
      }

      .portal-auth-form {
        display: grid;
        gap: 13px;
      }

      .portal-auth-form label {
        display: grid;
        gap: 7px;
      }

      .portal-auth-form label span,
      .portal-device-field legend {
        color: rgba(255, 255, 255, 0.72);
        font-size: 12px;
        font-weight: 950;
        text-transform: uppercase;
      }

      .portal-auth-form input {
        width: 100%;
        min-height: 48px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 13px;
        background: rgba(2, 6, 23, 0.42);
        color: #ffffff;
        padding: 0 13px;
        outline: none;
      }

      .portal-auth-form input:focus {
        border-color: #0ea5e9;
        box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.14);
      }

      .portal-device-field {
        display: grid;
        gap: 8px;
        border: 0;
      }

      .portal-device-field > div {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }

      .portal-device-field button {
        min-width: 0;
        min-height: 92px;
        display: grid;
        justify-items: center;
        align-content: center;
        gap: 4px;
        border: 1px solid rgba(255, 255, 255, 0.11);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.055);
        color: #ffffff;
        padding: 8px;
      }

      .portal-device-field button.active {
        border-color: rgba(34, 211, 238, 0.58);
        background:
          linear-gradient(135deg, rgba(34, 197, 94, 0.18), rgba(14, 165, 233, 0.2)),
          rgba(255, 255, 255, 0.08);
        box-shadow: 0 12px 30px rgba(14, 165, 233, 0.15);
      }

      .portal-device-field svg {
        width: 26px;
        height: 26px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2.3;
      }

      .portal-device-field svg circle,
      .portal-device-field svg path:first-child:nth-last-child(2) {
        fill: currentColor;
      }

      .portal-device-field small {
        color: rgba(255, 255, 255, 0.58);
        font-size: 10px;
        font-weight: 800;
        line-height: 1.15;
      }

      .portal-form-error,
      .portal-error-banner {
        border: 1px solid #fecaca;
        border-radius: 8px;
        background: #fff7f7;
        color: #b91c1c;
        padding: 10px 12px;
        font-size: 13px;
      }

      .portal-auth-confirm-backdrop {
        position: fixed;
        inset: 0;
        z-index: 100;
        display: grid;
        place-items: center;
        background: rgba(15, 23, 42, 0.58);
        padding: 16px;
        backdrop-filter: blur(12px);
      }

      .portal-auth-confirm-modal {
        position: relative;
        width: min(100%, 430px);
        display: grid;
        gap: 12px;
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 24px;
        background:
          radial-gradient(circle at 12% 0%, rgba(20, 184, 166, 0.13), transparent 13rem),
          radial-gradient(circle at 100% 0%, rgba(249, 115, 22, 0.08), transparent 12rem),
          linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
        color: #0f172a;
        padding: 22px;
        box-shadow:
          0 28px 90px rgba(15, 23, 42, 0.34),
          inset 0 1px 0 rgba(255, 255, 255, 0.94);
      }

      .portal-auth-confirm-close {
        position: absolute;
        top: 14px;
        right: 14px;
        width: 36px;
        height: 36px;
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.76);
        color: #0f172a;
        font-size: 12px;
        font-weight: 950;
        box-shadow: 0 10px 22px rgba(15, 23, 42, 0.08);
      }

      .portal-auth-confirm-modal h2 {
        margin: 0;
        padding-right: 34px;
        color: #0f172a;
        font-size: 30px;
        line-height: 1.02;
      }

      .portal-auth-confirm-note {
        width: fit-content;
        margin: -4px 0 2px;
        border: 1px solid rgba(148, 163, 184, 0.14);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.56);
        color: #475569;
        padding: 6px 9px;
        font-size: 12px;
        font-weight: 750;
      }

      .portal-auth-confirm-data {
        display: grid;
        gap: 8px;
      }

      .portal-auth-confirm-data p {
        margin: 0;
        display: flex;
        align-items: center;
        gap: 11px;
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.72);
        padding: 11px;
        box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
      }

      .portal-auth-confirm-data p > span {
        min-width: 0;
        display: grid;
        gap: 3px;
      }

      .portal-auth-confirm-icon {
        width: 42px;
        height: 42px;
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        border-radius: 14px;
        background: #ecfdf5;
        color: #0f766e;
        font-size: 13px;
        font-style: normal;
        font-weight: 950;
      }

      .portal-auth-confirm-icon svg {
        width: 19px;
        height: 19px;
      }

      .portal-auth-confirm-device .portal-auth-confirm-icon {
        background: #eff6ff;
        color: #0f172a;
      }

      .portal-auth-confirm-data small {
        color: #64748b;
        font-size: 10px;
        font-weight: 950;
        text-transform: uppercase;
      }

      .portal-auth-confirm-data strong {
        color: #0f172a;
        font-size: 18px;
        line-height: 1.08;
        overflow-wrap: anywhere;
      }

      .portal-auth-confirm-actions {
        display: grid;
        grid-template-columns: 0.72fr 1fr;
        gap: 10px;
      }

      .portal-auth-confirm-edit,
      .portal-auth-confirm-submit {
        min-height: 50px;
        border-radius: 15px;
        font-weight: 950;
        text-transform: uppercase;
      }

      .portal-auth-confirm-edit {
        border: 1px solid rgba(148, 163, 184, 0.28);
        background: #ffffff;
        color: #0f172a;
      }

      .portal-auth-confirm-submit {
        background: #0f172a;
        color: #ffffff;
        box-shadow: 0 14px 30px rgba(14, 165, 233, 0.2);
      }

      .portal-auth-submit,
      .portal-plan-card button,
      .portal-plugin-card > button,
      .portal-download-modal button,
      .portal-approved-modal button {
        min-height: 48px;
        border-radius: 8px;
        background: linear-gradient(135deg, #22c55e, #0ea5e9);
        color: #021018;
        font-weight: 950;
        text-transform: uppercase;
        box-shadow: 0 16px 32px rgba(14, 165, 233, 0.24);
      }

      .portal-auth-submit:disabled,
      .portal-plan-card button:disabled,
      .portal-plugin-card > button:disabled {
        cursor: wait;
        opacity: 0.72;
      }

      .portal-topbar {
        position: sticky;
        top: 12px;
        z-index: 20;
        width: min(100%, 1040px);
        min-height: 74px;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto auto;
        align-items: center;
        gap: 12px;
        margin: 0 auto 20px;
        border: 1px solid rgba(226, 232, 240, 0.18);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.96);
        padding: 10px;
        box-shadow: 0 18px 44px rgba(2, 6, 23, 0.2);
        backdrop-filter: blur(14px);
      }

      .portal-topbar strong {
        display: block;
        margin-top: 2px;
        color: #0f172a;
        font-size: 18px;
      }

      .portal-topbar small {
        display: block;
        color: #64748b;
        font-weight: 850;
      }

      .portal-topbar nav {
        width: min(360px, 40vw);
      }

      .portal-topbar button {
        min-height: 42px;
        border: 1px solid #fecaca;
        border-radius: 8px;
        background: #fff7f7;
        color: #b91c1c;
        padding: 0 14px;
        font-weight: 900;
      }

      .portal-page {
        width: min(100%, 1040px);
        margin: 0 auto;
      }

      .portal-hero {
        padding: clamp(10px, 3vw, 26px) 4px 18px;
        color: #ffffff;
      }

      .portal-hero h1 {
        color: #ffffff;
      }

      .portal-hero p {
        max-width: 560px;
        color: rgba(226, 232, 240, 0.82);
      }

      .portal-plan-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
      }

      .portal-plan-card,
      .portal-plugin-card {
        overflow: hidden;
        border: 1px solid rgba(226, 232, 240, 0.92);
        border-radius: 8px;
        background: #ffffff;
        padding: 14px;
        box-shadow: 0 18px 44px rgba(15, 23, 42, 0.12);
      }

      .portal-plan-card {
        display: grid;
        gap: 14px;
      }

      .portal-plan-card.cyan {
        border-top: 5px solid #0ea5e9;
      }

      .portal-plan-card.green {
        border-top: 5px solid #22c55e;
      }

      .portal-plan-card.pink {
        border-top: 5px solid #f43f5e;
      }

      .portal-plan-card.owned {
        border-color: #86efac;
        background: linear-gradient(180deg, #f0fdf4 0%, #ffffff 34%);
      }

      .portal-plan-head h2 {
        margin: 4px 0;
        color: #0f172a;
        font-size: clamp(30px, 5vw, 42px);
        line-height: 0.92;
      }

      .portal-plan-head small {
        color: #16a34a;
        font-weight: 900;
      }

      .portal-plan-card ul {
        display: grid;
        gap: 7px;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .portal-plan-card li {
        display: flex;
        gap: 8px;
        align-items: flex-start;
        color: #334155;
        font-size: 13px;
        font-weight: 820;
        line-height: 1.25;
      }

      .portal-plan-card li::before {
        content: '';
        flex: 0 0 auto;
        width: 8px;
        height: 8px;
        margin-top: 5px;
        border-radius: 999px;
        background: #22c55e;
      }

      .portal-plan-card li.warning {
        color: #b45309;
      }

      .portal-plan-card li.warning::before {
        background: #f59e0b;
      }

      .portal-price {
        display: grid;
        gap: 4px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #f8fafc;
        padding: 10px;
      }

      .portal-price span {
        color: #64748b;
        font-size: 12px;
        font-weight: 850;
      }

      .portal-price strong {
        color: #0f172a;
        font-size: 48px;
        line-height: 0.92;
      }

      .portal-price small,
      .portal-price em {
        font-size: 18px;
        font-style: normal;
      }

      .portal-plan-card button.owned,
      .portal-plugin-card > button.owned {
        background: linear-gradient(135deg, #f97316, #facc15);
        color: #1f1300;
        cursor: pointer;
        box-shadow: 0 16px 32px rgba(249, 115, 22, 0.22);
      }

      .portal-plan-card button.owned:hover,
      .portal-plugin-card > button.owned:hover {
        filter: brightness(1.04);
      }

      .portal-plan-card button.owned:disabled,
      .portal-plugin-card > button.owned:disabled {
        cursor: wait;
        opacity: 0.72;
      }

      .portal-plan-card button.owned:not(:disabled),
      .portal-plugin-card > button.owned:not(:disabled) {
        opacity: 1;
      }

      .portal-plan-card button.owned:not(:disabled):active,
      .portal-plugin-card > button.owned:not(:disabled):active {
        transform: translateY(1px);
      }

      .portal-plan-card button.owned.plan-owned-only,
      .portal-plugin-card > button.owned.plan-owned-only {
        background: #16a34a;
        color: #ffffff;
        cursor: default;
        box-shadow: none;
      }

      .portal-plan-card button.owned.plan-owned-only:hover,
      .portal-plugin-card > button.owned.plan-owned-only:hover {
        filter: none;
      }

      .portal-purchase-code {
        margin: -4px 0 0;
        color: #334155;
        font-size: 12px;
        font-weight: 850;
        line-height: 1.3;
      }

      .portal-purchase-code b {
        color: #0f172a;
        overflow-wrap: anywhere;
      }

      .portal-provider-note {
        margin: 14px 0 0;
        color: #64748b;
        font-size: 12px;
        font-weight: 850;
      }

      .plugin-page {
        width: min(100%, 760px);
      }

      .portal-plugin-card {
        display: grid;
        gap: 14px;
      }

      .plugin-status-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      .plugin-status-grid div {
        min-height: 72px;
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 2px 8px;
        align-items: center;
        border: 1px solid #dbe3ee;
        border-radius: 8px;
        background: #f8fafc;
        padding: 10px;
      }

      .plugin-status-grid i {
        grid-row: span 2;
        width: 34px;
        height: 34px;
        display: grid;
        place-items: center;
        border-radius: 8px;
        background: #dcfce7;
        color: #166534;
        font-size: 11px;
        font-style: normal;
        font-weight: 950;
      }

      .plugin-status-grid .missing {
        border-color: #fed7aa;
        background: #fff7ed;
      }

      .plugin-status-grid .missing i {
        background: #ffedd5;
        color: #c2410c;
      }

      .plugin-status-grid strong {
        color: #0f172a;
        font-size: 13px;
      }

      .plugin-status-grid small {
        color: #64748b;
        font-size: 11px;
        font-weight: 850;
      }

      .plugin-offer {
        display: grid;
        gap: 6px;
        border: 1px solid #bae6fd;
        border-radius: 8px;
        background: linear-gradient(135deg, #e0f2fe, #f0fdf4);
        padding: 14px;
      }

      .plugin-offer strong {
        color: #0f172a;
        font-size: 44px;
        line-height: 0.95;
      }

      .plugin-offer p {
        margin: 0;
        color: #334155;
        line-height: 1.35;
      }

      .portal-modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 80;
        display: grid;
        place-items: center;
        background: rgba(2, 6, 23, 0.56);
        padding: 16px;
        backdrop-filter: blur(10px);
      }

      .portal-approved-modal {
        width: min(100%, 440px);
        display: grid;
        gap: 12px;
        border: 1px solid rgba(226, 232, 240, 0.92);
        border-radius: 8px;
        background: #ffffff;
        padding: 18px;
        box-shadow: 0 28px 80px rgba(0, 0, 0, 0.28);
      }

      .portal-download-modal {
        width: min(100%, 520px);
        max-height: min(92vh, 760px);
        overflow-y: auto;
        display: grid;
        gap: 12px;
        border: 1px solid rgba(251, 191, 36, 0.34);
        border-radius: 8px;
        background:
          radial-gradient(circle at 20% 0%, rgba(249, 115, 22, 0.14), transparent 14rem),
          #ffffff;
        padding: 18px;
        box-shadow: 0 28px 80px rgba(0, 0, 0, 0.28);
      }

      .portal-approved-modal h2,
      .portal-download-modal h2 {
        margin: 0;
        color: #0f172a;
        font-size: 34px;
        line-height: 0.95;
      }

      .portal-approved-modal p,
      .portal-download-modal p {
        margin: 0;
        color: #475569;
        line-height: 1.4;
      }

      .portal-approved-modal div,
      .portal-download-info {
        display: grid;
        gap: 4px;
        border: 1px solid #bbf7d0;
        border-radius: 8px;
        background: #f0fdf4;
        padding: 12px;
      }

      .portal-approved-modal small,
      .portal-download-info small {
        color: #166534;
        font-size: 12px;
        font-weight: 900;
        text-transform: uppercase;
      }

      .portal-approved-modal div strong,
      .portal-download-info strong {
        color: #052e16;
        overflow-wrap: anywhere;
      }

      .portal-download-action {
        min-height: 52px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        background: linear-gradient(135deg, #f97316, #facc15);
        color: #1f1300;
        padding: 0 16px;
        font-size: 14px;
        font-weight: 950;
        text-align: center;
        text-decoration: none;
        text-transform: uppercase;
        box-shadow: 0 16px 32px rgba(249, 115, 22, 0.22);
      }

      .portal-download-warning {
        border: 1px solid #fed7aa;
        border-radius: 8px;
        background: #fff7ed;
        color: #9a3412 !important;
        padding: 10px 12px;
        font-weight: 850;
      }

      .portal-download-steps {
        display: grid;
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
        counter-reset: downloadSteps;
      }

      .portal-download-steps li {
        counter-increment: downloadSteps;
        display: grid;
        grid-template-columns: 30px minmax(0, 1fr);
        gap: 9px;
        align-items: start;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #f8fafc;
        color: #334155;
        padding: 10px;
        font-size: 13px;
        font-weight: 850;
        line-height: 1.32;
      }

      .portal-download-steps li::before {
        content: counter(downloadSteps);
        width: 30px;
        height: 30px;
        display: grid;
        place-items: center;
        border-radius: 999px;
        background: #0f172a;
        color: #ffffff;
        font-size: 12px;
        font-weight: 950;
      }

      .portal-error-banner {
        width: min(100%, 1040px);
        margin: 0 auto 12px;
      }

      .portal-auth.not-found {
        text-align: center;
      }

      .portal-ffp-controls {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 8px !important;
        left: 12px !important;
        right: 12px !important;
        width: auto !important;
        pointer-events: auto !important;
      }

      .portal-mode-switch {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        margin: 0 auto;
        padding: 5px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 999px;
        background: rgba(2, 6, 23, 0.24);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.035);
        backdrop-filter: blur(12px);
        pointer-events: auto;
      }

      .portal-ffp-controls a {
        min-height: 38px !important;
        min-width: 54px !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        border: 0 !important;
        border-radius: 999px !important;
        background: rgba(255, 255, 255, 0.12) !important;
        color: #ffffff !important;
        padding: 0 13px !important;
        font-size: 12px !important;
        font-weight: 950 !important;
        text-decoration: none !important;
        text-transform: uppercase !important;
        pointer-events: auto !important;
      }

      .portal-ffp-controls a.active {
        background: linear-gradient(135deg, #22c55e, #0ea5e9) !important;
        color: #02030a !important;
      }

      .portal-ffp-page .ffp-badge::before {
        content: none !important;
      }

      .portal-owned-button {
        border: 1px solid rgba(251, 191, 36, 0.54) !important;
        background:
          linear-gradient(135deg, #f97316, #facc15) !important;
        color: #1f1300 !important;
        cursor: pointer !important;
        opacity: 1 !important;
        box-shadow:
          0 16px 32px rgba(249, 115, 22, 0.24),
          inset 0 0 0 1px rgba(255, 255, 255, 0.28) !important;
      }

      .portal-owned-button.plan-owned-only {
        border: 1px solid rgba(34, 197, 94, 0.34) !important;
        background:
          linear-gradient(180deg, rgba(8, 17, 28, 0.96), rgba(4, 10, 18, 0.98)) !important;
        color: #86efac !important;
        cursor: default !important;
        box-shadow:
          inset 0 0 0 1px rgba(255, 255, 255, 0.035),
          0 0 0 0 transparent !important;
      }

      .portal-owned-button i {
        width: 18px;
        height: 18px;
        display: inline-grid;
        place-items: center;
        border-radius: 999px;
        background: rgba(31, 19, 0, 0.12);
        color: #1f1300;
      }

      .portal-owned-button.plan-owned-only i {
        background: rgba(34, 197, 94, 0.18);
        color: #86efac;
      }

      .portal-owned-button i::before {
        content: '';
        width: 9px;
        height: 5px;
        display: block;
        border-left: 2px solid currentColor;
        border-bottom: 2px solid currentColor;
        transform: rotate(-45deg) translateY(-1px);
      }

      .portal-ffp-purchase-code {
        position: relative;
        z-index: 3;
        margin: 8px 14px 0;
        border: 1px solid rgba(34, 197, 94, 0.28);
        border-radius: 13px;
        background: rgba(2, 6, 23, 0.42);
        color: rgba(255, 255, 255, 0.76);
        padding: 8px 10px;
        font-size: 10px;
        font-weight: 850;
        line-height: 1.25;
        overflow-wrap: anywhere;
      }

      .portal-ffp-purchase-code b {
        color: #86efac;
        font-weight: 950;
      }

      .portal-plugin-card-list {
        width: min(100%, 560px) !important;
        margin: 0 auto !important;
      }

      .portal-plugin-card-list .ffp-price-card {
        position: relative;
        padding-top: 18px;
      }

      .portal-plugin-card-list .ffp-top-badge {
        position: absolute !important;
        top: 16px !important;
        right: 16px !important;
        width: max-content;
        margin: 0;
        z-index: 4;
      }

      .portal-plugin-card-list .ffp-top-badge.is-pending {
        background:
          linear-gradient(135deg, #fde047, #f59e0b),
          rgba(255, 255, 255, 0.92) !important;
        color: #1f1300 !important;
        box-shadow:
          0 12px 28px rgba(245, 158, 11, 0.34),
          inset 0 0 0 1px rgba(255, 255, 255, 0.45) !important;
      }

      .portal-plugin-card-list .ffp-plan-head {
        align-items: center !important;
        padding-top: 0 !important;
        padding-right: 150px !important;
      }

      .portal-plugin-card-list .ffp-plan-head > div {
        min-width: 0;
      }

      .portal-plugin-card-list .ffp-plan-head h4 {
        max-width: min(100%, 360px) !important;
        overflow-wrap: anywhere;
        letter-spacing: -0.055em !important;
      }

      .portal-plugin-progress {
        position: relative;
        z-index: 2;
        display: grid;
        gap: 7px;
        margin: 12px 14px 0;
        border: 1px solid rgba(20, 184, 166, 0.22);
        border-radius: 13px;
        background: rgba(2, 6, 23, 0.34);
        padding: 10px;
      }

      .portal-plugin-progress div {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .portal-plugin-progress span {
        color: rgba(255, 255, 255, 0.7);
        font-size: 9px;
        font-weight: 950;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .portal-plugin-progress strong {
        border-radius: 999px;
        background: rgba(34, 197, 94, 0.18);
        color: #86efac;
        padding: 5px 8px;
        font-size: 9px;
        font-weight: 950;
        text-transform: uppercase;
      }

      .portal-plugin-progress i {
        height: 8px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.2);
      }

      .portal-plugin-progress i::before {
        content: '';
        display: block;
        width: 86%;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #22c55e, #14b8a6, #0ea5e9);
        box-shadow: 0 0 16px rgba(14, 165, 233, 0.42);
      }

      .ffp-item-list .ffp-plugin-included-note {
        border-color: rgba(168, 85, 247, 0.3);
        background:
          linear-gradient(90deg, rgba(168, 85, 247, 0.11), rgba(255, 255, 255, 0.035));
      }

      .ffp-item-list .ffp-plugin-included-note small {
        color: #ef4444;
      }

      .portal-plugin-after {
        position: relative;
        z-index: 2;
        display: grid;
        gap: 10px;
        margin: 14px 18px 18px;
        border: 1px solid rgba(20, 184, 166, 0.22);
        border-radius: 18px;
        background:
          linear-gradient(135deg, rgba(240, 253, 250, 0.96), rgba(248, 250, 252, 0.96));
        padding: 14px;
        box-shadow:
          0 14px 30px rgba(15, 23, 42, 0.07),
          inset 0 1px 0 rgba(255, 255, 255, 0.9);
      }

      .portal-plugin-after-head {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 12px;
      }

      .portal-plugin-after-head span {
        color: #0f766e;
        font-size: 10px;
        font-weight: 950;
        letter-spacing: 0.07em;
        text-transform: uppercase;
      }

      .portal-plugin-after-head strong {
        color: #0f172a;
        font-size: 13px;
        font-weight: 950;
        text-align: right;
      }

      .portal-plugin-after-grid {
        display: grid;
        gap: 8px;
      }

      .portal-plugin-after-grid span {
        display: grid;
        grid-template-columns: 30px minmax(0, 1fr);
        gap: 2px 9px;
        align-items: center;
        border: 1px solid rgba(20, 184, 166, 0.16);
        border-radius: 13px;
        background: #ffffff;
        padding: 9px;
      }

      .portal-plugin-after-grid b {
        width: 30px;
        height: 30px;
        grid-row: span 2;
        display: grid;
        place-items: center;
        border-radius: 10px;
        background: linear-gradient(135deg, #14b8a6, #22c55e);
        color: #ffffff;
        font-size: 12px;
        font-weight: 950;
      }

      .portal-plugin-after-grid strong {
        color: #0f172a;
        font-size: 12px;
        font-weight: 950;
        line-height: 1.1;
      }

      .portal-plugin-after-grid small {
        color: #64748b;
        font-size: 11px;
        font-weight: 750;
        line-height: 1.25;
      }

      .portal-plugin-proof-row {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }

      .portal-plugin-proof-row span {
        min-height: 58px;
        display: grid;
        align-content: center;
        gap: 3px;
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 13px;
        background: #ffffff;
        padding: 8px;
        text-align: center;
      }

      .portal-plugin-proof-row b {
        color: #0f766e;
        font-size: 15px;
        font-weight: 950;
      }

      .portal-plugin-proof-row small {
        color: #475569;
        font-size: 9.5px;
        font-weight: 850;
        line-height: 1.15;
      }

      .portal-plugin-modules {
        position: relative;
        z-index: 2;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 7px;
        margin: 12px 14px 18px;
      }

      .portal-plugin-modules span {
        min-height: 48px;
        display: grid;
        grid-template-columns: 28px minmax(0, 1fr);
        align-items: center;
        gap: 8px;
        border: 1px solid rgba(20, 184, 166, 0.18);
        border-radius: 13px;
        background: rgba(255, 255, 255, 0.06);
        color: #ffffff;
        padding: 8px;
      }

      .portal-plugin-modules b {
        width: 28px;
        height: 28px;
        display: grid;
        place-items: center;
        border-radius: 10px;
        background: linear-gradient(135deg, #22c55e, #14b8a6);
        color: #ffffff;
        font-size: 10px;
        font-weight: 950;
      }

      .portal-plugin-modules strong {
        min-width: 0;
        overflow-wrap: anywhere;
        color: rgba(255, 255, 255, 0.86);
        font-size: 10px;
        font-weight: 950;
        line-height: 1.05;
      }

      .portal-plugin-modules .missing {
        border-color: rgba(248, 113, 113, 0.42);
        background: rgba(127, 29, 29, 0.2);
      }

      .portal-plugin-modules .missing b {
        background: linear-gradient(135deg, #ef4444, #f97316);
      }

      .portal-plugin-outcome {
        position: relative;
        z-index: 2;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 7px;
        margin: 12px 14px 0;
      }

      .portal-plugin-outcome span {
        min-height: 54px;
        display: grid;
        justify-items: center;
        align-content: center;
        gap: 4px;
        border: 1px solid rgba(20, 184, 166, 0.2);
        border-radius: 13px;
        background: rgba(255, 255, 255, 0.06);
        color: rgba(255, 255, 255, 0.88);
        font-size: 9.5px;
        font-weight: 950;
        line-height: 1.05;
        text-align: center;
      }

      .portal-plugin-outcome b {
        width: 24px;
        height: 24px;
        display: grid;
        place-items: center;
        border-radius: 9px;
        background: linear-gradient(135deg, #22c55e, #14b8a6);
        color: #ffffff;
        font-size: 10px;
        box-shadow: 0 10px 18px rgba(34, 197, 94, 0.2);
      }

      .portal-shell,
      .portal-shell.auth-shell {
        background:
          radial-gradient(circle at 12% 0%, rgba(34, 197, 94, 0.12), transparent 24rem),
          radial-gradient(circle at 90% 8%, rgba(14, 165, 233, 0.1), transparent 24rem),
          linear-gradient(180deg, #ffffff 0%, #f8fafc 58%, #eef2f7 100%) !important;
        color: #0f172a !important;
      }

      .portal-auth {
        border: 1px solid rgba(15, 23, 42, 0.1) !important;
        background:
          radial-gradient(circle at 18% 0%, rgba(34, 197, 94, 0.12), transparent 34%),
          linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.98)) !important;
        color: #0f172a !important;
        box-shadow: 0 24px 70px rgba(15, 23, 42, 0.12) !important;
      }

      .portal-auth h1,
      .portal-auth p,
      .portal-auth-form label span,
      .portal-device-field legend {
        color: #0f172a !important;
      }

      .portal-auth p {
        color: #475569 !important;
      }

      .portal-auth-form input,
      .portal-device-field button,
      .portal-auth-confirm-modal {
        border-color: rgba(15, 23, 42, 0.12) !important;
        background: rgba(255, 255, 255, 0.9) !important;
        color: #0f172a !important;
      }

      .portal-device-field button small,
      .portal-auth-confirm-data small {
        color: #64748b !important;
      }

      .portal-device-field button.active {
        border-color: rgba(34, 197, 94, 0.55) !important;
        background: #ecfdf5 !important;
      }

      .portal-auth-submit,
      .portal-auth-confirm-submit {
        background: linear-gradient(135deg, #22c55e, #14b8a6) !important;
        color: #ffffff !important;
        box-shadow: 0 16px 34px rgba(20, 184, 166, 0.24) !important;
      }

      .portal-ffp-page .ffp-poster {
        background:
          radial-gradient(circle at 0% 20%, rgba(34, 197, 94, 0.12), transparent 24rem),
          radial-gradient(circle at 100% 10%, rgba(14, 165, 233, 0.12), transparent 22rem),
          linear-gradient(180deg, #ffffff 0%, #f8fafc 58%, #eef2f7 100%) !important;
        color: #0f172a !important;
      }

      .portal-ffp-page .ffp-bg {
        opacity: 0.34 !important;
      }

      .portal-ffp-page .ffp-badge,
      .portal-ffp-page .ffp-hero p,
      .portal-mode-switch {
        border-color: rgba(15, 23, 42, 0.12) !important;
        background: rgba(255, 255, 255, 0.82) !important;
        color: #334155 !important;
        box-shadow: 0 18px 42px rgba(15, 23, 42, 0.08) !important;
      }

      .portal-ffp-page .ffp-hero h3 {
        background: linear-gradient(135deg, #0f172a, #334155 48%, #14b8a6) !important;
        -webkit-background-clip: text !important;
        background-clip: text !important;
        color: transparent !important;
      }

      .portal-ffp-page .ffp-price-card {
        border-color: rgba(15, 23, 42, 0.1) !important;
        background:
          radial-gradient(circle at top right, rgba(20, 184, 166, 0.1), transparent 30%),
          linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.98)) !important;
        box-shadow: 0 22px 64px rgba(15, 23, 42, 0.12) !important;
      }

      .portal-ffp-page .ffp-plan-head span:not(.ffp-plan-icon),
      .portal-ffp-page .ffp-plan-head small,
      .portal-ffp-page .ffp-price-compare span,
      .portal-ffp-page .ffp-item-list small {
        color: #64748b !important;
      }

      .portal-ffp-page .ffp-item-list span,
      .portal-ffp-page .ffp-feature-link,
      .portal-ffp-page .ffp-price,
      .portal-plugin-progress,
      .portal-plugin-modules span,
      .portal-plugin-outcome span,
      .ffp-social-stats span {
        border-color: rgba(15, 23, 42, 0.1) !important;
        background: rgba(255, 255, 255, 0.78) !important;
        color: #0f172a !important;
      }

      .portal-ffp-page .ffp-item-list b,
      .portal-plugin-modules strong,
      .portal-plugin-outcome span,
      .ffp-social-stats b {
        color: #0f172a !important;
      }

      .portal-ffp-page .ffp-price-value strong,
      .portal-ffp-page .ffp-price-value span,
      .portal-ffp-page .ffp-price-value b {
        color: #0f172a !important;
      }

      .portal-ffp-page .ffp-price-value b {
        margin-left: 5px !important;
      }

      .portal-ffp-page .ffp-buy-button {
        background: linear-gradient(135deg, #22c55e, #14b8a6) !important;
        color: #ffffff !important;
        box-shadow: 0 18px 34px rgba(20, 184, 166, 0.24) !important;
      }

      .portal-owned-button {
        background: #f1f5f9 !important;
        color: #15803d !important;
      }

      .portal-checkout-grid {
        display: grid !important;
        grid-template-columns: minmax(0, 560px) !important;
        justify-content: center !important;
      }

      .portal-shell,
      .portal-shell.auth-shell {
        background:
          linear-gradient(rgba(15, 23, 42, 0.035) 1px, transparent 1px),
          linear-gradient(90deg, rgba(15, 23, 42, 0.035) 1px, transparent 1px),
          linear-gradient(180deg, #fbfcfe 0%, #f3f6fb 48%, #eef3f8 100%) !important;
        background-size: 26px 26px, 26px 26px, auto !important;
      }

      .portal-ffp-page .ffp-poster {
        border: 1px solid rgba(148, 163, 184, 0.24) !important;
        background:
          linear-gradient(135deg, rgba(255, 255, 255, 0.94), rgba(248, 250, 252, 0.9)),
          linear-gradient(180deg, #ffffff 0%, #f5f8fc 100%) !important;
        box-shadow:
          0 28px 80px rgba(15, 23, 42, 0.12),
          inset 0 1px 0 rgba(255, 255, 255, 0.9) !important;
      }

      .portal-ffp-page .ffp-ring,
      .portal-ffp-page .ffp-spark {
        opacity: 0.28 !important;
      }

      .portal-ffp-page .ffp-badge {
        border-color: rgba(34, 197, 94, 0.18) !important;
        background: rgba(240, 253, 244, 0.92) !important;
        color: #15803d !important;
        box-shadow: none !important;
      }

      .portal-ffp-page .ffp-hero h3 {
        filter: drop-shadow(0 12px 22px rgba(15, 23, 42, 0.08));
      }

      .portal-ffp-page .ffp-hero p {
        border-color: rgba(148, 163, 184, 0.24) !important;
        background: rgba(255, 255, 255, 0.88) !important;
        color: #475569 !important;
        box-shadow: 0 14px 32px rgba(15, 23, 42, 0.08) !important;
      }

      .portal-mode-switch {
        border-color: rgba(148, 163, 184, 0.28) !important;
        background: rgba(255, 255, 255, 0.86) !important;
        box-shadow:
          0 14px 32px rgba(15, 23, 42, 0.1),
          inset 0 1px 0 rgba(255, 255, 255, 0.94) !important;
      }

      .portal-ffp-controls a {
        background: #f1f5f9 !important;
        color: #334155 !important;
        box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.18) !important;
      }

      .portal-ffp-controls a.active {
        background: #0f172a !important;
        color: #ffffff !important;
        box-shadow: 0 10px 24px rgba(15, 23, 42, 0.18) !important;
      }

      .portal-ffp-page .ffp-price-card {
        border-color: rgba(148, 163, 184, 0.22) !important;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.96)) !important;
        box-shadow:
          0 20px 54px rgba(15, 23, 42, 0.12),
          inset 0 1px 0 rgba(255, 255, 255, 0.95) !important;
      }

      .portal-ffp-page .ffp-price-card.selected {
        border-color: color-mix(in srgb, var(--ffp-b) 38%, rgba(148, 163, 184, 0.2)) !important;
        box-shadow:
          0 24px 62px rgba(15, 23, 42, 0.14),
          0 0 0 1px color-mix(in srgb, var(--ffp-b) 14%, transparent),
          inset 0 1px 0 rgba(255, 255, 255, 0.98) !important;
      }

      .portal-ffp-page .ffp-plan-icon {
        box-shadow:
          0 12px 26px color-mix(in srgb, var(--ffp-b) 28%, transparent),
          inset 0 1px 0 rgba(255, 255, 255, 0.38) !important;
      }

      .portal-ffp-page .ffp-plan-head h4 {
        text-shadow: none !important;
      }

      .portal-ffp-page .ffp-item-list span,
      .portal-ffp-page .ffp-feature-link,
      .portal-ffp-page .ffp-price,
      .portal-plugin-progress,
      .portal-plugin-modules span,
      .portal-plugin-outcome span,
      .ffp-social-stats span {
        border-color: rgba(148, 163, 184, 0.2) !important;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(248, 250, 252, 0.86)) !important;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.76) !important;
      }

      .portal-ffp-page .ffp-item-negative {
        border-color: rgba(239, 68, 68, 0.22) !important;
        background: #fff7f7 !important;
      }

      .portal-ffp-page .ffp-item-list i,
      .portal-plugin-modules b,
      .portal-plugin-outcome b,
      .ffp-social-stats i {
        box-shadow: 0 8px 18px color-mix(in srgb, var(--ffp-b, #14b8a6) 18%, transparent) !important;
      }

      .portal-ffp-page .ffp-price {
        background:
          linear-gradient(180deg, #ffffff, #f8fafc) !important;
      }

      .portal-ffp-page .ffp-price-compare s {
        color: #94a3b8 !important;
      }

      .portal-ffp-page .ffp-price-row small {
        background: #eef2f7 !important;
        color: #334155 !important;
      }

      .portal-ffp-page .ffp-buy-button {
        background: #0f172a !important;
        color: #ffffff !important;
        box-shadow:
          0 16px 34px rgba(15, 23, 42, 0.22),
          inset 0 1px 0 rgba(255, 255, 255, 0.14) !important;
      }

      .portal-ffp-page .ffp-buy-button:not(:disabled):hover {
        filter: brightness(1.06);
      }

      .portal-owned-button {
        border-color: rgba(34, 197, 94, 0.24) !important;
        background: #ecfdf5 !important;
        color: #15803d !important;
        box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.1) !important;
      }

      .portal-ffp-purchase-code {
        border-color: rgba(34, 197, 94, 0.22) !important;
        background: #f0fdf4 !important;
        color: #166534 !important;
      }

      .portal-auth {
        border-color: rgba(148, 163, 184, 0.24) !important;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.96)) !important;
        box-shadow: 0 26px 70px rgba(15, 23, 42, 0.14) !important;
      }

      .portal-auth-form input,
      .portal-device-field button {
        border-color: rgba(148, 163, 184, 0.28) !important;
        background: #ffffff !important;
        box-shadow: 0 10px 26px rgba(15, 23, 42, 0.06) !important;
      }

      .portal-auth-submit,
      .portal-auth-confirm-submit {
        background: #0f172a !important;
        box-shadow: 0 18px 36px rgba(15, 23, 42, 0.22) !important;
      }

      .portal-shell.auth-shell {
        padding: clamp(16px, 4vw, 34px) !important;
      }

      .portal-shell.auth-shell .portal-auth {
        width: min(100%, 460px) !important;
        gap: 12px !important;
        border-color: rgba(148, 163, 184, 0.22) !important;
        border-radius: 22px !important;
        background:
          radial-gradient(circle at 12% 0%, rgba(20, 184, 166, 0.14), transparent 16rem),
          radial-gradient(circle at 100% 10%, rgba(249, 115, 22, 0.1), transparent 14rem),
          linear-gradient(180deg, #ffffff 0%, #f8fafc 100%) !important;
        padding: clamp(18px, 4vw, 24px) !important;
        box-shadow:
          0 28px 80px rgba(15, 23, 42, 0.14),
          inset 0 1px 0 rgba(255, 255, 255, 0.92) !important;
      }

      .portal-shell.auth-shell .portal-auth-bg span {
        background: #14b8a6 !important;
        box-shadow: 0 0 18px rgba(20, 184, 166, 0.36) !important;
        opacity: 0.24 !important;
      }

      .portal-shell.auth-shell .portal-auth-bg i {
        background: radial-gradient(circle, rgba(14, 165, 233, 0.12), transparent 62%) !important;
      }

      .portal-auth-copy {
        display: grid;
        gap: 8px;
      }

      .portal-auth-brand {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .portal-auth-brand i {
        width: 54px;
        height: 54px;
        display: grid;
        place-items: center;
        border-radius: 15px;
        background: linear-gradient(135deg, #07111f, #0f766e 68%, #f59e0b);
        color: #ffffff;
        font-size: 18px;
        font-style: normal;
        font-weight: 950;
        box-shadow: 0 16px 32px rgba(15, 118, 110, 0.2);
      }

      .portal-auth-brand span {
        display: block;
        color: #0f766e !important;
        font-size: 11px !important;
        font-weight: 950 !important;
        letter-spacing: 0 !important;
        text-transform: uppercase;
      }

      .portal-auth-brand strong {
        display: block;
        margin-top: 2px;
        color: #0f172a;
        font-size: 18px;
        font-weight: 950;
        line-height: 1;
      }

      .portal-shell.auth-shell .portal-auth h1 {
        margin: 0 !important;
        color: #07111f !important;
        font-size: clamp(26px, 4.8vw, 34px) !important;
        font-style: normal !important;
        font-weight: 950 !important;
        line-height: 1.06 !important;
        text-transform: none !important;
        text-shadow: none !important;
      }

      .portal-shell.auth-shell .portal-auth h1 strong {
        display: block;
        background: none !important;
        -webkit-background-clip: initial !important;
        background-clip: initial !important;
        color: #0f766e !important;
        -webkit-text-fill-color: currentColor !important;
      }

      .portal-shell.auth-shell .portal-auth p {
        margin: 0 !important;
        width: fit-content !important;
        border: 1px solid rgba(148, 163, 184, 0.16) !important;
        border-radius: 10px !important;
        background: rgba(255, 255, 255, 0.52) !important;
        color: #334155 !important;
        padding: 5px 8px !important;
        font-size: 12px !important;
        font-weight: 700 !important;
        line-height: 1.28 !important;
        text-align: left !important;
      }

      .portal-shell.auth-shell .portal-auth-form {
        gap: 12px !important;
      }

      .portal-shell.auth-shell .portal-auth-form label {
        gap: 8px !important;
      }

      .portal-shell.auth-shell .portal-auth-form label span,
      .portal-shell.auth-shell .portal-device-field legend {
        color: #475569 !important;
        font-size: 10px !important;
      }

      .portal-shell.auth-shell .portal-auth-form input {
        min-height: 50px !important;
        border-color: rgba(148, 163, 184, 0.32) !important;
        border-radius: 15px !important;
        background: #ffffff !important;
        color: #0f172a !important;
        font-size: 16px !important;
        font-weight: 850 !important;
      }

      .portal-shell.auth-shell .portal-phone-input {
        min-height: 50px;
        display: flex;
        align-items: center;
        overflow: hidden;
        border: 1px solid rgba(148, 163, 184, 0.32);
        border-radius: 15px;
        background: #ffffff;
        box-shadow: 0 12px 26px rgba(15, 23, 42, 0.06);
      }

      .portal-shell.auth-shell .portal-phone-input b {
        height: 100%;
        min-height: 50px;
        display: grid;
        place-items: center;
        padding: 0 12px 0 15px;
        border-right: 1px solid rgba(148, 163, 184, 0.22);
        color: #0f766e;
        font-size: 14px;
        font-weight: 950;
        letter-spacing: 0;
      }

      .portal-shell.auth-shell .portal-phone-input input {
        min-height: 48px !important;
        flex: 1;
        min-width: 0;
        border: 0 !important;
        border-radius: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
        padding-left: 12px !important;
      }

      .portal-shell.auth-shell .portal-auth-form input:focus {
        border-color: #14b8a6 !important;
        box-shadow: 0 0 0 4px rgba(20, 184, 166, 0.12) !important;
      }

      .portal-shell.auth-shell .portal-phone-input:focus-within {
        border-color: #14b8a6;
        box-shadow:
          0 0 0 4px rgba(20, 184, 166, 0.12),
          0 12px 26px rgba(15, 23, 42, 0.06);
      }

      .portal-shell.auth-shell .portal-phone-input input:focus {
        box-shadow: none !important;
      }

      .portal-shell.auth-shell .portal-device-field {
        gap: 9px !important;
      }

      .portal-shell.auth-shell .portal-device-field > div {
        grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
        gap: 8px !important;
      }

      .portal-shell.auth-shell .portal-device-field button {
        min-height: 48px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 6px !important;
        border-color: rgba(148, 163, 184, 0.24) !important;
        border-radius: 14px !important;
        background: #ffffff !important;
        color: #0f172a !important;
        padding: 7px !important;
        box-shadow: 0 12px 28px rgba(15, 23, 42, 0.06) !important;
      }

      .portal-shell.auth-shell .portal-device-field svg {
        width: 17px !important;
        height: 17px !important;
        flex: 0 0 auto !important;
      }

      .portal-shell.auth-shell .portal-device-field strong {
        min-width: 0;
        font-size: 12px !important;
        line-height: 1 !important;
        overflow-wrap: anywhere;
      }

      .portal-shell.auth-shell .portal-device-field button.active {
        border-color: rgba(20, 184, 166, 0.5) !important;
        background: #ecfdf5 !important;
        box-shadow:
          0 14px 30px rgba(20, 184, 166, 0.12),
          inset 0 0 0 1px rgba(20, 184, 166, 0.12) !important;
      }

      .portal-shell.auth-shell .portal-device-field small {
        color: #64748b !important;
      }

      .portal-shell.auth-shell .portal-auth-submit {
        min-height: 50px !important;
        border-radius: 15px !important;
        background: #0f172a !important;
        color: #ffffff !important;
        font-size: 15px !important;
        box-shadow:
          0 18px 34px rgba(15, 23, 42, 0.22),
          inset 0 1px 0 rgba(255, 255, 255, 0.16) !important;
      }

      .portal-shell.auth-shell .portal-auth-confirm-modal {
        border-color: rgba(148, 163, 184, 0.22) !important;
        border-radius: 24px !important;
        background:
          radial-gradient(circle at 12% 0%, rgba(20, 184, 166, 0.13), transparent 13rem),
          radial-gradient(circle at 100% 0%, rgba(249, 115, 22, 0.08), transparent 12rem),
          linear-gradient(180deg, #ffffff 0%, #f8fafc 100%) !important;
      }

      .portal-shell.auth-shell .portal-auth-confirm-edit {
        background: #ffffff !important;
        color: #0f172a !important;
      }

      .portal-shell.auth-shell .portal-auth-confirm-submit {
        background: #0f172a !important;
        color: #ffffff !important;
        box-shadow:
          0 18px 34px rgba(15, 23, 42, 0.2),
          inset 0 1px 0 rgba(255, 255, 255, 0.16) !important;
      }

      @media (max-width: 860px) {
        .portal-plan-grid {
          grid-template-columns: 1fr;
        }

        .portal-topbar {
          grid-template-columns: 1fr;
          position: static;
        }

        .portal-topbar nav {
          width: 100%;
        }

        .portal-plugin-grid {
          grid-template-columns: 1fr;
        }

        .portal-plugin-card-list .ffp-plan-head {
          padding-right: 14px !important;
        }

        .portal-plugin-card-list .ffp-plan-head h4 {
          max-width: min(100%, 310px) !important;
          font-size: clamp(30px, 7.4vw, 38px) !important;
        }
      }

      @media (max-width: 520px) {
        .portal-shell {
          padding: 8px;
        }

        .portal-device-field > div,
        .plugin-status-grid {
          grid-template-columns: 1fr;
        }

        .portal-auth h1,
        .portal-hero h1 {
          font-size: 42px;
        }
      }

      .portal-shell .portal-ffp-page .ffp-poster {
        background:
          radial-gradient(circle at 8% 10%, rgba(34, 197, 94, 0.08), transparent 18rem),
          radial-gradient(circle at 90% 6%, rgba(14, 165, 233, 0.08), transparent 18rem),
          linear-gradient(180deg, #fbfcfe 0%, #f4f7fb 100%) !important;
      }

      .portal-shell .portal-ffp-page .ffp-price-card,
      .portal-shell .portal-ffp-page .ffp-price-card.selected {
        overflow: hidden !important;
        border: 1px solid rgba(148, 163, 184, 0.2) !important;
        border-radius: 26px !important;
        background:
          linear-gradient(180deg, #ffffff 0%, #f9fbfd 100%) !important;
        box-shadow:
          0 18px 46px rgba(15, 23, 42, 0.1),
          inset 0 1px 0 rgba(255, 255, 255, 0.96) !important;
      }

      .portal-shell .portal-ffp-page .ffp-price-card::before,
      .portal-shell .portal-ffp-page .ffp-price-card::after {
        display: none !important;
      }

      .portal-shell .portal-ffp-page .ffp-card-list {
        gap: 18px !important;
      }

      .portal-shell .portal-ffp-page .ffp-plan-head {
        align-items: center !important;
        padding: 18px 18px 4px !important;
      }

      .portal-shell .portal-ffp-page .ffp-plan-head h4 {
        font-size: clamp(31px, 8.2vw, 48px) !important;
        line-height: 0.92 !important;
        letter-spacing: -0.035em !important;
      }

      .portal-shell .portal-ffp-page .ffp-plan-head span:not(.ffp-plan-icon) {
        color: #64748b !important;
        letter-spacing: 0.22em !important;
      }

      .portal-shell .portal-ffp-page .ffp-plan-head small {
        color: #64748b !important;
      }

      .portal-shell .portal-ffp-page .ffp-item-list {
        gap: 8px !important;
        margin: 14px 18px 0 !important;
      }

      .portal-shell .portal-ffp-page .ffp-item-list span,
      .portal-shell .portal-ffp-page .ffp-feature-link {
        min-height: 34px !important;
        border: 1px solid rgba(148, 163, 184, 0.2) !important;
        border-radius: 13px !important;
        background: #ffffff !important;
        color: #182235 !important;
        padding: 7px 10px !important;
        box-shadow: 0 8px 18px rgba(15, 23, 42, 0.045) !important;
      }

      .portal-shell .portal-ffp-page .ffp-item-list b,
      .portal-shell .portal-ffp-page .ffp-feature-link b {
        color: #182235 !important;
        font-size: 11px !important;
        font-weight: 900 !important;
      }

      .portal-shell .portal-ffp-page .ffp-more-link.locked {
        cursor: pointer !important;
        opacity: 1 !important;
      }

      .portal-shell .portal-ffp-page .ffp-more-link.locked i {
        filter: none !important;
        opacity: 1 !important;
      }

      .portal-shell .portal-ffp-page .ffp-price {
        margin: 14px 18px 0 !important;
        border: 1px solid rgba(148, 163, 184, 0.2) !important;
        border-radius: 18px !important;
        background:
          linear-gradient(180deg, #ffffff 0%, #f8fafc 100%) !important;
        padding: 13px 14px !important;
        box-shadow: 0 12px 26px rgba(15, 23, 42, 0.06) !important;
      }

      .portal-shell .portal-ffp-page .ffp-price::before,
      .portal-shell .portal-ffp-page .ffp-price::after {
        display: none !important;
      }

      .portal-shell .portal-ffp-page .ffp-price-value em {
        background: #f1f5f9 !important;
        color: #64748b !important;
      }

      .portal-shell .portal-ffp-page .ffp-price-value strong {
        color: #0f172a !important;
        text-shadow: 0 10px 18px rgba(15, 23, 42, 0.12) !important;
      }

      .portal-shell .portal-ffp-page .ffp-buy-button {
        width: calc(100% - 36px) !important;
        min-height: 48px !important;
        margin: 14px 18px 0 !important;
        border: 1px solid rgba(15, 23, 42, 0.08) !important;
        border-radius: 15px !important;
        background: linear-gradient(135deg, #111827, #0f172a) !important;
        color: #ffffff !important;
        letter-spacing: 0.07em !important;
        box-shadow:
          0 16px 30px rgba(15, 23, 42, 0.18),
          inset 0 1px 0 rgba(255, 255, 255, 0.12) !important;
      }

      .portal-shell .portal-ffp-page .ffp-social-stats {
        margin: 14px 18px 18px !important;
      }

      .portal-shell .portal-ffp-page .ffp-social-stats span {
        border: 1px solid rgba(148, 163, 184, 0.2) !important;
        border-radius: 14px !important;
        background: #ffffff !important;
        color: #0f172a !important;
        box-shadow: 0 8px 18px rgba(15, 23, 42, 0.045) !important;
      }

      .portal-shell .portal-ffp-page .ffp-social-stats small {
        color: #64748b !important;
      }

      .portal-shell .portal-ffp-page .ffp-hero {
        padding-top: 44px !important;
      }

      .portal-shell .portal-ffp-page .ffp-hero h3 {
        font-size: clamp(48px, 13vw, 82px) !important;
        line-height: 0.82 !important;
        filter: none !important;
      }

      .portal-shell .portal-checkout-page .ffp-hero h3 {
        font-size: clamp(44px, 12vw, 74px) !important;
      }

      .portal-shell .portal-ffp-page .ffp-hero p {
        width: min(100%, 370px) !important;
        margin-top: 12px !important;
        border-radius: 14px !important;
      }

      .portal-shell .portal-ffp-page .ffp-purchase-toast {
        border-color: rgba(148, 163, 184, 0.24) !important;
        background:
          linear-gradient(135deg, rgba(255, 255, 255, 0.97), rgba(248, 250, 252, 0.95)) !important;
        color: #0f172a !important;
        box-shadow:
          0 18px 44px rgba(15, 23, 42, 0.16),
          0 0 0 1px rgba(255, 255, 255, 0.7) inset !important;
      }

      .portal-shell .portal-ffp-page .ffp-purchase-toast i {
        background:
          radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.9) 0 14%, transparent 15%),
          linear-gradient(135deg, #14b8a6, #22c55e) !important;
        box-shadow:
          0 0 0 6px rgba(20, 184, 166, 0.12),
          0 14px 28px rgba(20, 184, 166, 0.24) !important;
      }

      .portal-shell .portal-ffp-page .ffp-purchase-toast i::before {
        border-color: #ffffff !important;
      }

      .portal-shell .portal-ffp-page .ffp-purchase-toast small {
        background: #ecfdf5 !important;
        color: #047857 !important;
      }

      .portal-shell .portal-ffp-page .ffp-purchase-toast strong {
        color: #0f172a !important;
      }

      .portal-shell .portal-ffp-page .ffp-purchase-toast span {
        color: #475569 !important;
      }

      .portal-shell .portal-ffp-page .ffp-daily {
        --ffp-a: #86efac;
        --ffp-b: #22c55e;
        --ffp-c: #16a34a;
      }

      .portal-shell .portal-ffp-page .ffp-weekly {
        --ffp-a: #fde047;
        --ffp-b: #f59e0b;
        --ffp-c: #f97316;
      }

      .portal-shell .portal-ffp-page .ffp-monthly {
        --ffp-a: #ef4444;
        --ffp-b: #dc2626;
        --ffp-c: #7f1d1d;
      }

      .portal-shell .portal-ffp-page .ffp-lifetime {
        --ffp-a: #e879f9;
        --ffp-b: #a855f7;
        --ffp-c: #6d28d9;
      }

      .portal-shell .portal-ffp-page .ffp-weekly .ffp-plan-head h4 {
        background: linear-gradient(90deg, #f59e0b, #facc15, #f97316) !important;
        -webkit-background-clip: text !important;
        background-clip: text !important;
      }

      .portal-shell .portal-ffp-page .ffp-monthly .ffp-plan-head h4 {
        background: linear-gradient(90deg, #ef4444, #dc2626, #7f1d1d) !important;
        -webkit-background-clip: text !important;
        background-clip: text !important;
      }

      .portal-shell .portal-ffp-page .ffp-monthly .ffp-plan-icon::before {
        background: #ffffff !important;
      }

      .portal-shell .portal-ffp-page .ffp-monthly .ffp-item-list i::before {
        border-left-color: #ffffff !important;
        border-bottom-color: #ffffff !important;
      }

      .portal-shell .portal-ffp-page .ffp-monthly .ffp-feature-link em {
        color: #ffffff !important;
      }

      .portal-shell .portal-ffp-page .ffp-lifetime .ffp-plan-head h4 {
        background: linear-gradient(90deg, #d946ef, #a855f7, #6d28d9) !important;
        -webkit-background-clip: text !important;
        background-clip: text !important;
      }

      .portal-shell .portal-checkout-page .ffp-hero {
        padding-top: 62px !important;
      }

      .portal-shell .portal-checkout-page .ffp-hero h3 {
        font-size: clamp(32px, 9vw, 50px) !important;
        line-height: 0.94 !important;
        letter-spacing: 0 !important;
      }

      .portal-shell .portal-checkout-page .ffp-hero p {
        width: min(100%, 420px) !important;
        border-style: dashed !important;
        background: #ffffff !important;
      }

      .portal-shell .portal-checkout-page .ffp-main-grid {
        margin-top: 14px !important;
      }

      .portal-shell .portal-checkout-page .ffp-price-card,
      .portal-shell .portal-checkout-page .ffp-price-card.selected {
        border-radius: 18px !important;
      }

      .portal-shell .portal-checkout-page .ffp-plan-head {
        padding-top: 16px !important;
      }

      .portal-shell .portal-checkout-page .ffp-plan-head h4 {
        font-size: clamp(30px, 7.8vw, 42px) !important;
      }

      .portal-shell .portal-checkout-page .ffp-buy-button {
        background: linear-gradient(135deg, #0f172a, #020617) !important;
      }

      .portal-shell .portal-checkout-page .ffp-poster {
        background:
          radial-gradient(circle at 8% 0%, rgba(168, 85, 247, 0.08), transparent 16rem),
          radial-gradient(circle at 92% 8%, rgba(20, 184, 166, 0.09), transparent 18rem),
          linear-gradient(180deg, #fbfcfe 0%, #f2f6fb 100%) !important;
      }

      .portal-shell .portal-checkout-page .ffp-content {
        padding-top: 70px !important;
      }

      .portal-checkout-shell {
        width: min(100%, 900px);
        display: grid;
        gap: 14px;
        align-items: start;
        margin: 0 auto;
      }

      .portal-checkout-panel {
        display: grid;
        gap: 16px;
        border: 1px solid #d8dde5;
        border-radius: 7px;
        background: #ffffff;
        padding: 16px;
        box-shadow: 0 10px 28px rgba(15, 23, 42, 0.08);
      }

      .portal-checkout-product {
        display: grid;
        grid-template-columns: 96px minmax(0, 1fr);
        gap: 14px;
        align-items: center;
        border-bottom: 1px solid #e5e7eb;
        padding-bottom: 14px;
      }

      .portal-checkout-thumb {
        height: 96px;
        display: grid;
        place-items: center;
        border-radius: 3px;
        background:
          radial-gradient(circle at 24% 18%, rgba(34, 197, 94, 0.55), transparent 30%),
          radial-gradient(circle at 80% 12%, rgba(168, 85, 247, 0.6), transparent 28%),
          linear-gradient(135deg, #020617, #111827 54%, #581c87);
        color: #ffffff;
        overflow: hidden;
      }

      .portal-checkout-thumb b,
      .portal-checkout-thumb em {
        display: block;
        font-weight: 950;
        line-height: 0.9;
        text-align: center;
        text-transform: uppercase;
      }

      .portal-checkout-thumb b {
        font-size: 14px;
        letter-spacing: 0.08em;
      }

      .portal-checkout-thumb em {
        color: #22c55e;
        font-size: 28px;
        font-style: normal;
      }

      .portal-checkout-product small {
        color: #22c55e;
        font-size: 12px;
        font-weight: 950;
        text-transform: uppercase;
      }

      .portal-checkout-product strong {
        display: block;
        margin-top: 5px;
        color: #111827;
        font-size: 20px;
        font-weight: 800;
        line-height: 1.1;
      }

      .portal-checkout-product span:not(.portal-checkout-thumb) {
        display: block;
        margin-top: 8px;
        color: #6b7280;
        font-size: 12px;
        font-weight: 700;
      }

      .portal-checkout-provider {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        border-radius: 4px;
        background: #f9fafb;
        padding: 2px 0;
      }

      .portal-checkout-provider span,
      .portal-checkout-total small {
        color: #6b7280;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .portal-checkout-provider strong {
        color: #15803d;
        font-size: 13px;
        font-weight: 950;
        text-transform: uppercase;
      }

      .portal-checkout-total {
        display: grid;
        gap: 4px;
        border-bottom: 1px solid #e5e7eb;
        padding: 4px 0 16px;
      }

      .portal-checkout-total strong {
        color: #27ae60;
        font-size: 30px;
        font-weight: 850;
        line-height: 1;
      }

      .portal-checkout-total span {
        width: fit-content;
        border-radius: 999px;
        background: #f3f4f6;
        color: #4b5563;
        padding: 4px 8px;
        font-size: 10px;
        font-weight: 800;
        text-transform: uppercase;
      }

      .portal-checkout-methods {
        display: grid;
        gap: 12px;
      }

      .portal-checkout-methods span {
        min-height: 54px;
        display: grid;
        place-items: center;
        border: 1px solid #d8dde5;
        border-radius: 3px;
        background: #ffffff;
        color: #4b5563;
        font-size: 16px;
        font-weight: 750;
      }

      .portal-checkout-order {
        display: grid;
        gap: 14px;
        border-radius: 7px;
        background: #f4f4f4;
        padding: 16px;
      }

      .portal-checkout-order h3 {
        margin: 0;
        color: #111827;
        font-size: 18px;
        font-weight: 850;
      }

      .portal-checkout-order p {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin: 0;
        color: #111827;
        font-size: 14px;
      }

      .portal-checkout-order p:first-of-type {
        border-bottom: 1px dashed #d8dde5;
        padding-bottom: 13px;
      }

      .portal-checkout-order strong {
        color: #111827;
        font-weight: 800;
        white-space: nowrap;
      }

      .portal-checkout-order b {
        font-weight: 850;
      }

      .portal-checkout-order p:last-child strong {
        color: #27ae60;
      }

      .portal-checkout-submit {
        min-height: 56px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        border: 0;
        border-radius: 3px;
        background: #65bd4f;
        color: #ffffff;
        font-size: 16px;
        font-weight: 800;
        box-shadow: none;
      }

      .portal-checkout-submit:disabled {
        cursor: default;
        opacity: 0.7;
      }

      .portal-checkout-submit.owned {
        background: #e5f7e1;
        color: #248a3d;
      }

      .portal-checkout-owned-code {
        margin: -4px 0 0;
        color: #248a3d;
        font-size: 12px;
        font-weight: 800;
        text-align: center;
      }

      .portal-checkout-secure,
      .portal-checkout-digital {
        margin: 0;
        color: #475569;
        font-size: 12px;
        font-weight: 650;
        line-height: 1.45;
        text-align: center;
      }

      .portal-checkout-secure {
        color: #149344;
      }

      .portal-checkout-processed {
        display: grid;
        justify-items: center;
        gap: 9px;
        border-top: 1px solid #e5e7eb;
        margin-top: 4px;
        padding-top: 16px;
        text-align: center;
      }

      .portal-checkout-processed small {
        color: #c0c4cc;
        font-size: 11px;
        font-weight: 850;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }

      .portal-checkout-processed strong {
        color: #008aa7;
        font-size: 22px;
        font-weight: 900;
      }

      .portal-checkout-processed span,
      .portal-checkout-processed em {
        color: #334155;
        font-size: 12px;
        font-style: normal;
        line-height: 1.35;
      }

      @media (min-width: 860px) {
        .portal-checkout-shell {
          grid-template-columns: minmax(0, 530px) minmax(280px, 340px);
        }

        .portal-checkout-grid {
          order: 1;
        }

        .portal-checkout-panel {
          position: sticky;
          top: 86px;
          order: 2;
        }
      }

      .portal-shell .portal-checkout-page .ffp-main-grid {
        margin-top: 16px !important;
      }

      .portal-shell .portal-checkout-page .ffp-card-list {
        width: min(100%, 520px) !important;
      }

      .portal-shell .portal-checkout-page .ffp-price-card,
      .portal-shell .portal-checkout-page .ffp-price-card.selected {
        border-radius: 28px !important;
        background:
          linear-gradient(180deg, #ffffff 0%, #fbfcfe 100%) !important;
        box-shadow:
          0 20px 56px rgba(15, 23, 42, 0.12),
          inset 0 1px 0 rgba(255, 255, 255, 0.98) !important;
      }

      .portal-shell .portal-checkout-page .ffp-plan-head {
        padding: 20px 20px 6px !important;
      }

      .portal-shell .portal-checkout-page .ffp-plan-icon {
        width: 48px !important;
        height: 48px !important;
        border-radius: 16px !important;
      }

      .portal-shell .portal-checkout-page .ffp-item-list {
        margin: 14px 20px 0 !important;
        gap: 7px !important;
      }

      .portal-shell .portal-checkout-page .ffp-item-list span,
      .portal-shell .portal-checkout-page .ffp-feature-link {
        min-height: 32px !important;
        border-radius: 14px !important;
      }

      .portal-shell .portal-checkout-page .ffp-price {
        margin: 16px 20px 0 !important;
        border-radius: 20px !important;
      }

      .portal-shell .portal-checkout-page .ffp-buy-button {
        width: calc(100% - 40px) !important;
        margin: 16px 20px 20px !important;
      }

      .portal-shell .portal-checkout-page .ffp-social-stats {
        display: none !important;
      }

      .portal-shell .portal-checkout-page .ffp-daily {
        --checkout-accent-a: #22c55e;
        --checkout-accent-b: #16a34a;
      }

      .portal-shell .portal-checkout-page .ffp-weekly {
        --checkout-accent-a: #f59e0b;
        --checkout-accent-b: #f97316;
      }

      .portal-shell .portal-checkout-page .ffp-monthly {
        --checkout-accent-a: #ef4444;
        --checkout-accent-b: #991b1b;
      }

      .portal-shell .portal-checkout-page .ffp-lifetime {
        --checkout-accent-a: #d946ef;
        --checkout-accent-b: #7c3aed;
      }

      @media (max-width: 520px) {
        .portal-shell .portal-ffp-page .ffp-price-card,
        .portal-shell .portal-ffp-page .ffp-price-card.selected {
          border-radius: 24px !important;
        }

        .portal-shell .portal-ffp-page .ffp-plan-head {
          padding: 16px 16px 4px !important;
        }

        .portal-shell .portal-ffp-page .ffp-item-list {
          margin-inline: 16px !important;
        }

        .portal-shell .portal-ffp-page .ffp-price,
        .portal-shell .portal-ffp-page .ffp-social-stats {
          margin-inline: 16px !important;
        }

        .portal-shell .portal-ffp-page .ffp-buy-button {
          width: calc(100% - 32px) !important;
          margin-inline: 16px !important;
        }

      }

      .portal-shell .portal-checkout-page .ffp-price-card,
      .portal-shell .portal-checkout-page .ffp-price-card.selected {
        border-color: #d8dde5 !important;
        border-radius: 8px !important;
        background: #ffffff !important;
        box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08) !important;
      }

      .portal-shell .portal-checkout-page .ffp-plan-icon {
        border-radius: 7px !important;
      }

      .portal-shell .portal-checkout-page .ffp-item-list span,
      .portal-shell .portal-checkout-page .ffp-feature-link,
      .portal-shell .portal-checkout-page .ffp-price {
        border-color: #d8dde5 !important;
        border-radius: 5px !important;
        background: #ffffff !important;
        box-shadow: none !important;
      }

      .portal-shell .portal-checkout-page .ffp-price {
        border-radius: 7px !important;
      }

      .portal-shell .portal-checkout-page .ffp-price-row small {
        border-radius: 4px !important;
      }

      .portal-shell .portal-checkout-page .portal-checkout-submit,
      .portal-shell .portal-checkout-page .ffp-buy-button.portal-checkout-submit {
        min-height: 56px !important;
        border: 0 !important;
        border-radius: 3px !important;
        background: #65bd4f !important;
        color: #ffffff !important;
        font-size: 16px !important;
        font-weight: 800 !important;
        letter-spacing: 0 !important;
        text-transform: none !important;
        box-shadow: none !important;
      }

      .portal-shell .portal-checkout-page .portal-checkout-submit.owned,
      .portal-shell .portal-checkout-page .ffp-buy-button.portal-checkout-submit.owned {
        background: #e5f7e1 !important;
        color: #248a3d !important;
      }

      .portal-shell .portal-checkout-page .portal-checkout-secure {
        width: calc(100% - 40px);
        margin: 12px 20px 20px;
        color: #149344;
        font-size: 12px;
        font-weight: 650;
        line-height: 1.4;
        text-align: center;
      }

      .portal-checkout-pix-error {
        width: calc(100% - 40px);
        margin: -4px 20px 14px;
        border: 1px solid rgba(239, 68, 68, 0.24);
        border-radius: 6px;
        background: #fef2f2;
        color: #991b1b;
        padding: 10px;
        font-size: 12px;
        font-weight: 800;
        line-height: 1.35;
        text-align: center;
      }

      .portal-pix-panel {
        width: calc(100% - 40px);
        display: grid;
        gap: 10px;
        margin: 0 20px 20px;
        border: 1px solid rgba(20, 184, 166, 0.24);
        border-radius: 8px;
        background: #f0fdfa;
        padding: 12px;
      }

      .portal-pix-panel > span,
      .portal-pix-panel small {
        color: #0f766e;
        font-size: 11px;
        font-weight: 950;
        text-transform: uppercase;
      }

      .portal-pix-panel > strong {
        color: #0f172a;
        font-size: 24px;
        line-height: 1;
      }

      .portal-pix-panel img {
        width: min(100%, 220px);
        justify-self: center;
        border: 8px solid #ffffff;
        border-radius: 8px;
      }

      .portal-pix-panel label {
        display: grid;
        gap: 6px;
      }

      .portal-pix-panel textarea {
        width: 100%;
        resize: none;
        border: 1px solid rgba(15, 118, 110, 0.22);
        border-radius: 6px;
        background: #ffffff;
        color: #0f172a;
        padding: 10px;
        font-size: 12px;
        line-height: 1.35;
      }

      .portal-pix-panel button {
        min-height: 42px;
        border: 0;
        border-radius: 5px;
        background: #0f766e;
        color: #ffffff;
        font-size: 13px;
        font-weight: 900;
        cursor: pointer;
      }

      .portal-reseller-checkout .ffp-content {
        padding-top: 24px !important;
        padding-bottom: 22px !important;
      }

      .portal-reseller-checkout .portal-checkout-grid {
        display: block !important;
      }

      .portal-reseller-checkout .ffp-card-list {
        width: min(100%, 640px) !important;
        max-width: 640px !important;
        margin: 0 auto !important;
      }

      .portal-reseller-checkout .ffp-price-card,
      .portal-reseller-checkout .ffp-price-card.selected {
        border: 1px solid rgba(34, 197, 94, 0.2) !important;
        border-radius: 38px !important;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(240, 253, 244, 0.9)) !important;
        box-shadow:
          0 30px 84px rgba(22, 163, 74, 0.15),
          inset 0 1px 0 rgba(255, 255, 255, 0.9) !important;
        overflow: visible !important;
        backdrop-filter: blur(18px);
      }

      .portal-reseller-checkout .ffp-price-card::before,
      .portal-reseller-checkout .ffp-price-card::after {
        border-radius: 38px !important;
      }

      .portal-shell .portal-reseller-checkout .ffp-price-card,
      .portal-shell .portal-reseller-checkout .ffp-price-card.selected {
        border-radius: 38px !important;
      }

      .portal-reseller-checkout .ffp-plan-head {
        display: grid !important;
        grid-template-columns: 58px minmax(0, 1fr) !important;
        align-items: center !important;
        gap: 13px !important;
        padding: 18px 18px 10px !important;
      }

      .portal-reseller-checkout .ffp-plan-icon {
        width: 58px !important;
        height: 58px !important;
        border-radius: 24px !important;
        box-shadow: none !important;
      }

      .portal-reseller-checkout .ffp-plan-head span {
        font-size: 10px !important;
        font-weight: 950 !important;
        letter-spacing: 0 !important;
      }

      .portal-reseller-checkout .ffp-plan-head h4 {
        margin-top: 2px !important;
        font-size: clamp(38px, 8vw, 58px) !important;
        line-height: 0.86 !important;
        letter-spacing: 0 !important;
      }

      .portal-reseller-checkout .ffp-plan-head small {
        width: fit-content;
        margin-top: 8px !important;
        border-radius: 999px;
        padding: 6px 10px;
        font-size: 11px !important;
        font-weight: 950 !important;
      }

      .portal-reseller-internal .ffp-poster {
        background:
          radial-gradient(circle at 14% 0%, rgba(34, 197, 94, 0.24), transparent 22rem),
          radial-gradient(circle at 88% 5%, rgba(20, 184, 166, 0.18), transparent 20rem),
          linear-gradient(180deg, #f0fdf4 0%, #ecfdf5 42%, #ffffff 100%) !important;
      }

      .portal-reseller-external .ffp-poster {
        background:
          radial-gradient(circle at 14% 0%, rgba(34, 197, 94, 0.22), transparent 22rem),
          radial-gradient(circle at 88% 5%, rgba(20, 184, 166, 0.18), transparent 20rem),
          linear-gradient(180deg, #f0fdf4 0%, #ecfdf5 42%, #ffffff 100%) !important;
      }

      .portal-reseller-internal .ffp-price-card {
        border-color: rgba(34, 197, 94, 0.2) !important;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(240, 253, 244, 0.9)) !important;
        box-shadow: 0 30px 84px rgba(22, 163, 74, 0.15) !important;
      }

      .portal-reseller-external .ffp-price-card {
        border-color: rgba(34, 197, 94, 0.2) !important;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(240, 253, 244, 0.9)) !important;
        box-shadow: 0 30px 84px rgba(22, 163, 74, 0.15) !important;
      }

      .portal-reseller-internal .ffp-plan-icon {
        background: linear-gradient(135deg, #86efac, #22c55e 52%, #16a34a) !important;
        color: #ffffff !important;
        box-shadow: 0 18px 34px rgba(22, 163, 74, 0.3) !important;
      }

      .portal-reseller-external .ffp-plan-icon {
        background: linear-gradient(135deg, #86efac, #22c55e 52%, #16a34a) !important;
        color: #ffffff !important;
        box-shadow: 0 18px 34px rgba(22, 163, 74, 0.3) !important;
      }

      .portal-reseller-internal .ffp-plan-head h4 {
        color: #15803d !important;
      }

      .portal-reseller-external .ffp-plan-head h4 {
        color: #15803d !important;
      }

      .portal-reseller-internal .ffp-plan-head small {
        background: #dcfce7;
        color: #15803d;
      }

      .portal-reseller-external .ffp-plan-head small {
        background: #dcfce7;
        color: #15803d;
      }

      .portal-reseller-internal .portal-checkout-submit {
        position: sticky !important;
        bottom: 12px !important;
        z-index: 8 !important;
        width: calc(100% - 28px) !important;
        min-height: 62px !important;
        margin: 14px 14px 16px !important;
        border-radius: 24px !important;
        background: linear-gradient(135deg, #22c55e, #16a34a) !important;
        box-shadow: 0 18px 40px rgba(22, 163, 74, 0.32) !important;
        color: #ffffff !important;
        font-size: 18px !important;
        letter-spacing: 0.035em !important;
      }

      .portal-reseller-external .portal-checkout-submit {
        position: sticky !important;
        bottom: 12px !important;
        z-index: 8 !important;
        width: calc(100% - 28px) !important;
        min-height: 62px !important;
        margin: 14px 14px 16px !important;
        border-radius: 24px !important;
        background: linear-gradient(135deg, #22c55e, #16a34a) !important;
        box-shadow: 0 18px 40px rgba(22, 163, 74, 0.32) !important;
        color: #ffffff !important;
        font-size: 18px !important;
        letter-spacing: 0.035em !important;
      }

      .portal-fixed-checkout-bar {
        position: fixed !important;
        right: auto !important;
        bottom: max(12px, env(safe-area-inset-bottom)) !important;
        left: 50% !important;
        z-index: 2147483000 !important;
        width: min(520px, calc(100vw - 28px)) !important;
        margin: 0 !important;
        transform: translateX(-50%) !important;
        pointer-events: auto !important;
        display: grid !important;
        justify-items: center !important;
        gap: 8px !important;
        animation: portalFixedCheckoutIn 180ms ease-out both;
      }

      .portal-fixed-checkout-arrow {
        display: grid !important;
        place-items: center !important;
        width: 44px !important;
        height: 44px !important;
        border: 1px solid rgba(22, 163, 74, 0.24) !important;
        border-radius: 999px !important;
        background: linear-gradient(180deg, #ffffff, #dcfce7) !important;
        box-shadow: 0 14px 30px rgba(22, 163, 74, 0.24) !important;
        cursor: pointer !important;
      }

      .portal-fixed-checkout-arrow span {
        display: block !important;
        width: 12px !important;
        height: 12px !important;
        margin-top: -3px !important;
        border-right: 3px solid #16a34a !important;
        border-bottom: 3px solid #16a34a !important;
        transform: rotate(45deg) !important;
      }

      .portal-fixed-checkout-submit {
        position: static !important;
        width: 100% !important;
        margin: 0 !important;
        transform: none !important;
        font-size: 18px !important;
        letter-spacing: 0.035em !important;
      }

      .portal-fixed-internal {
        min-height: 62px !important;
        border-radius: 24px !important;
        background: linear-gradient(135deg, #22c55e, #16a34a) !important;
        box-shadow: 0 18px 40px rgba(22, 163, 74, 0.32) !important;
        color: #ffffff !important;
      }

      .portal-fixed-external {
        min-height: 62px !important;
        border-radius: 24px !important;
        background: linear-gradient(135deg, #22c55e, #16a34a) !important;
        box-shadow: 0 18px 40px rgba(22, 163, 74, 0.32) !important;
        color: #ffffff !important;
      }

      @keyframes portalFixedCheckoutIn {
        from {
          opacity: 0;
          transform: translateX(-50%) translateY(12px);
        }
        to {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
      }

      .portal-reseller-checkout .ffp-item-list {
        margin: 8px 16px 0 !important;
        gap: 12px !important;
      }

      .portal-reseller-features {
        display: grid;
        gap: 9px;
      }

      .portal-reseller-features section {
        display: grid;
        gap: 6px;
        border: 0;
        border-radius: 0;
        background: transparent;
        padding: 0;
        box-shadow: none;
      }

      .portal-reseller-internal .portal-reseller-features section {
        border-color: transparent;
        background: transparent;
      }

      .portal-reseller-features h5 {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin: 0;
        color: #14532d;
        font-size: 12px;
        font-weight: 950;
        letter-spacing: 0;
      }

      .portal-reseller-features h5::after {
        content: '';
        display: block;
        height: 1px;
        flex: 1;
        border-radius: 999px;
        background: linear-gradient(90deg, rgba(34, 197, 94, 0.34), rgba(20, 184, 166, 0.1));
        padding: 0;
      }

      .portal-reseller-benefits h5::after {
        content: 'INCLUSO';
      }

      .portal-reseller-features section > div {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 4px;
      }

      .portal-reseller-features span {
        min-height: 25px;
        display: grid !important;
        grid-template-columns: 12px minmax(0, 1fr);
        align-items: center;
        gap: 4px;
        margin: 0 !important;
        border: 1px solid rgba(34, 197, 94, 0.18) !important;
        border-radius: 999px !important;
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.92), rgba(240, 253, 244, 0.72)) !important;
        padding: 5px 8px !important;
      }

      .portal-shell .portal-reseller-checkout .ffp-item-list .portal-reseller-features span,
      .portal-shell .portal-reseller-checkout .ffp-item-list .portal-reseller-features .ffp-feature-link {
        border-radius: 999px !important;
      }

      .portal-reseller-internal .portal-reseller-features span {
        border-color: rgba(34, 197, 94, 0.18) !important;
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.92), rgba(240, 253, 244, 0.72)) !important;
      }

      .portal-reseller-features span i {
        width: 12px;
        height: 12px;
        display: grid;
        place-items: center;
        border-radius: 999px;
        background: linear-gradient(135deg, #22c55e, #14b8a6);
        box-shadow: 0 4px 10px rgba(20, 184, 166, 0.24);
        opacity: 1;
      }

      .portal-reseller-features span i::before {
        content: '';
        width: 6px;
        height: 4px;
        border-left: 1.5px solid #ffffff;
        border-bottom: 1.5px solid #ffffff;
        transform: rotate(-45deg) translate(1px, -1px);
      }

      .portal-reseller-features span b {
        font-size: 8px !important;
        line-height: 1.05 !important;
        overflow-wrap: anywhere;
      }

      .portal-reseller-benefits section,
      .portal-reseller-benefits {
        margin-bottom: 0;
      }

      .portal-reseller-benefits {
        border: 0 !important;
        background: transparent !important;
        padding: 0 !important;
        box-shadow: none !important;
      }

      .portal-reseller-benefits > div {
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        gap: 4px !important;
      }

      .portal-reseller-benefits span b {
        font-size: 8.5px !important;
      }

      .portal-reseller-internal .portal-reseller-benefits span {
        border-color: rgba(34, 197, 94, 0.2) !important;
        background: linear-gradient(135deg, rgba(240, 253, 244, 0.95), rgba(255, 255, 255, 0.92)) !important;
      }

      .portal-reseller-external .portal-reseller-benefits span {
        border-color: rgba(34, 197, 94, 0.2) !important;
        background: linear-gradient(135deg, rgba(240, 253, 244, 0.95), rgba(255, 255, 255, 0.92)) !important;
      }

      .portal-reseller-checkout .ffp-price {
        display: grid !important;
        justify-items: stretch !important;
        align-items: stretch !important;
        gap: 8px !important;
        margin: 14px 16px 0 !important;
        border-radius: 42px !important;
        padding: 16px !important;
        overflow: hidden !important;
        box-shadow:
          0 18px 40px rgba(22, 163, 74, 0.13),
          inset 0 1px 0 rgba(255, 255, 255, 0.86) !important;
      }

      .portal-shell .portal-reseller-checkout .ffp-price {
        border-radius: 42px !important;
      }

      .portal-reseller-checkout .ffp-price > * {
        width: 100% !important;
        max-width: none !important;
        justify-self: stretch !important;
      }

      .portal-reseller-internal .ffp-price {
        border-color: rgba(34, 197, 94, 0.2) !important;
        background:
          linear-gradient(135deg, rgba(255, 255, 255, 0.94), rgba(220, 252, 231, 0.74)) !important;
      }

      .portal-reseller-external .ffp-price {
        border-color: rgba(34, 197, 94, 0.2) !important;
        background:
          linear-gradient(135deg, rgba(255, 255, 255, 0.94), rgba(220, 252, 231, 0.74)) !important;
      }

      .portal-reseller-checkout .ffp-price-compare {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        width: 100% !important;
        min-width: 100% !important;
        max-width: none !important;
        justify-self: stretch !important;
        align-self: stretch !important;
        box-sizing: border-box !important;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.72);
        padding: 10px 12px;
      }

      .portal-shell .portal-reseller-checkout .ffp-price .ffp-price-compare {
        width: 100% !important;
        min-width: 100% !important;
        justify-self: stretch !important;
      }

      .portal-reseller-checkout .ffp-price-compare span,
      .portal-reseller-checkout .ffp-price-row small {
        color: #15803d !important;
      }

      .portal-reseller-checkout .ffp-price-value strong,
      .portal-reseller-checkout .ffp-price-value span,
      .portal-reseller-checkout .ffp-price-value b {
        color: #052e16 !important;
      }

      .portal-reseller-checkout .ffp-price-row {
        display: grid !important;
        grid-template-columns: minmax(0, 1fr) auto !important;
        align-items: end !important;
        width: 100% !important;
        column-gap: 12px !important;
      }

      .portal-shell .portal-reseller-checkout .ffp-price-row {
        grid-template-columns: minmax(0, 1fr) auto !important;
      }

      .portal-reseller-checkout .ffp-price-value {
        width: 100% !important;
        min-width: 0 !important;
        justify-content: flex-start !important;
      }

      .portal-reseller-checkout .ffp-price-value strong {
        font-size: clamp(56px, 14vw, 78px) !important;
        line-height: 0.82 !important;
      }

      .portal-reseller-checkout .ffp-price-value b {
        font-size: clamp(22px, 5vw, 30px) !important;
        margin-left: 5px !important;
      }

      .portal-reseller-checkout .ffp-price-row small {
        justify-self: end !important;
        align-self: end !important;
        min-width: 78px !important;
        border-radius: 999px !important;
        background: #dcfce7 !important;
        padding: 8px 10px !important;
        text-align: center !important;
      }

      .portal-reseller-checkout .portal-checkout-secure {
        display: none !important;
      }

      .portal-reseller-checkout .portal-checkout-secure {
        width: calc(100% - 32px) !important;
        margin: 2px 16px 18px !important;
        border-radius: 24px;
        background: rgba(240, 253, 244, 0.8);
        padding: 10px 12px;
        color: #15803d !important;
      }

      .portal-reseller-checkout .portal-checkout-pix-error {
        border-radius: 24px !important;
      }

      .portal-reseller-checkout .portal-pix-panel {
        border-radius: 30px !important;
        padding: 14px !important;
      }

      .portal-reseller-checkout .portal-pix-panel img {
        border-radius: 22px !important;
      }

      .portal-reseller-checkout .portal-pix-panel textarea {
        border-radius: 20px !important;
      }

      .portal-reseller-checkout .portal-pix-panel button {
        border-radius: 999px !important;
      }

      @media (max-width: 520px) {
        .portal-reseller-checkout .ffp-content {
          padding: 12px 8px 16px !important;
        }

        .portal-reseller-checkout .ffp-plan-head {
          grid-template-columns: 52px minmax(0, 1fr) !important;
          padding: 16px 14px 8px !important;
        }

        .portal-reseller-checkout .ffp-plan-icon {
          width: 52px !important;
          height: 52px !important;
        }

        .portal-reseller-features section > div {
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        }
      }

      .portal-mode-switch .portal-plugin-back {
        min-height: 38px !important;
        min-width: 68px !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        border: 0 !important;
        border-radius: 999px !important;
        background: #f1f5f9 !important;
        color: #334155 !important;
        padding: 0 13px !important;
        font-size: 12px !important;
        font-weight: 950 !important;
        text-transform: uppercase !important;
        box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.18) !important;
        cursor: pointer;
      }

      .portal-plugin-ffp .ffp-poster {
        background:
          linear-gradient(135deg, rgba(236, 253, 245, 0.96), rgba(248, 250, 252, 0.94)),
          linear-gradient(180deg, #ffffff 0%, #eff6ff 100%) !important;
      }

      .portal-plugin-ffp .ffp-hero h3 {
        max-width: 620px !important;
        margin: 14px auto 0 !important;
        background: none !important;
        -webkit-background-clip: initial !important;
        background-clip: initial !important;
        color: #07111f !important;
        -webkit-text-fill-color: currentColor !important;
        font-size: 62px !important;
        line-height: 0.9 !important;
        letter-spacing: 0 !important;
        text-shadow:
          0 2px 0 rgba(255, 255, 255, 0.98),
          0 14px 26px rgba(15, 23, 42, 0.24) !important;
      }

      .portal-plugin-ffp .ffp-hero h3 strong {
        display: block !important;
        background: none !important;
        -webkit-background-clip: initial !important;
        background-clip: initial !important;
        color: #04766f !important;
        -webkit-text-fill-color: currentColor !important;
        text-shadow:
          0 2px 0 rgba(255, 255, 255, 0.98),
          0 14px 26px rgba(4, 120, 110, 0.26) !important;
      }

      .portal-plugin-ffp .portal-plugin-grid {
        grid-template-columns: minmax(240px, 0.78fr) minmax(320px, 1fr) !important;
        align-items: center !important;
        gap: 22px !important;
      }

      .portal-plugin-ffp .ffp-showcase {
        border: 1px solid rgba(15, 23, 42, 0.1) !important;
        border-radius: 24px !important;
        background:
          radial-gradient(circle at 50% 20%, rgba(20, 184, 166, 0.18), transparent 34%),
          linear-gradient(180deg, #ffffff, #f8fafc) !important;
        box-shadow: 0 20px 52px rgba(15, 23, 42, 0.1) !important;
      }

      .portal-plugin-ffp .portal-plugin-card-list .ffp-price-card {
        border: 1px solid rgba(15, 23, 42, 0.12) !important;
        border-top: 5px solid #14b8a6 !important;
        border-radius: 22px !important;
        background:
          linear-gradient(180deg, #ffffff 0%, #fbfcfe 100%) !important;
        box-shadow:
          0 24px 64px rgba(15, 23, 42, 0.14),
          inset 0 1px 0 rgba(255, 255, 255, 0.96) !important;
      }

      .portal-plugin-ffp .portal-plugin-progress,
      .portal-plugin-ffp .portal-plugin-modules span,
      .portal-plugin-ffp .portal-plugin-outcome span {
        border-color: rgba(20, 184, 166, 0.22) !important;
        background: #f0fdfa !important;
        color: #134e4a !important;
      }

      .portal-plugin-ffp .portal-plugin-progress span,
      .portal-plugin-ffp .portal-plugin-outcome span,
      .portal-plugin-ffp .portal-plugin-modules strong {
        color: #134e4a !important;
      }

      .portal-plugin-ffp .portal-plugin-progress strong,
      .portal-plugin-ffp .portal-plugin-modules b,
      .portal-plugin-ffp .portal-plugin-outcome b {
        background: linear-gradient(135deg, #14b8a6, #22c55e) !important;
        color: #ffffff !important;
      }

      .portal-plugin-ffp .portal-plugin-modules .missing {
        border-color: rgba(239, 68, 68, 0.28) !important;
        background: #fff7f7 !important;
      }

      .portal-plugin-ffp .portal-plugin-modules .missing b {
        background: linear-gradient(135deg, #ef4444, #f97316) !important;
      }

      .portal-shell .portal-ffp-page:not(.portal-checkout-page):not(.portal-download-page):not(.portal-plugin-ffp) .ffp-hero h3 {
        background: none !important;
        -webkit-background-clip: initial !important;
        background-clip: initial !important;
        color: #07111f !important;
        -webkit-text-fill-color: currentColor !important;
        text-shadow:
          0 2px 0 rgba(255, 255, 255, 0.96),
          0 12px 24px rgba(15, 23, 42, 0.24);
      }

      .portal-shell .portal-ffp-page:not(.portal-checkout-page):not(.portal-download-page):not(.portal-plugin-ffp) .ffp-hero h3 strong {
        display: block;
        background: none !important;
        -webkit-background-clip: initial !important;
        background-clip: initial !important;
        color: #04766f !important;
        -webkit-text-fill-color: currentColor !important;
        text-shadow:
          0 2px 0 rgba(255, 255, 255, 0.98),
          0 12px 24px rgba(4, 120, 110, 0.26);
      }

      .portal-shell .portal-ffp-page .portal-ffp-purchase-code,
      .portal-shell .portal-ffp-page .portal-download-code {
        border-color: rgba(22, 163, 74, 0.34) !important;
        background: #dcfce7 !important;
        color: #14532d !important;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.62) !important;
      }

      .portal-shell .portal-ffp-page .portal-ffp-purchase-code b,
      .portal-shell .portal-ffp-page .portal-download-code b {
        color: #052e16 !important;
      }

      .portal-download-page .ffp-poster {
        background:
          radial-gradient(circle at 12% 4%, rgba(20, 184, 166, 0.12), transparent 18rem),
          radial-gradient(circle at 92% 8%, rgba(249, 115, 22, 0.1), transparent 18rem),
          linear-gradient(180deg, #fbfcfe 0%, #eef6f8 100%) !important;
      }

      .portal-download-content {
        padding-top: 66px !important;
      }

      .portal-download-hero {
        width: min(100%, 760px);
        margin: 0 auto;
        text-align: center;
      }

      .portal-shell .portal-download-page .portal-download-hero h3 {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        column-gap: 16px;
        row-gap: 4px;
        margin: 0;
        background: none !important;
        -webkit-background-clip: initial !important;
        background-clip: initial !important;
        color: #07111f !important;
        font-size: clamp(40px, 10vw, 72px) !important;
        line-height: 1 !important;
        overflow: visible;
        text-shadow:
          0 2px 0 rgba(255, 255, 255, 0.96),
          0 12px 24px rgba(15, 23, 42, 0.24);
      }

      .portal-shell .portal-download-page .portal-download-hero h3 span,
      .portal-shell .portal-download-page .portal-download-hero h3 strong {
        display: inline-block;
        background: none !important;
        -webkit-background-clip: initial !important;
        background-clip: initial !important;
        color: #07111f !important;
        -webkit-text-fill-color: currentColor;
      }

      .portal-shell .portal-download-page .portal-download-hero h3 strong {
        color: #04766f !important;
        text-shadow:
          0 2px 0 rgba(255, 255, 255, 0.98),
          0 12px 24px rgba(4, 120, 110, 0.26);
      }

      .portal-download-grid {
        position: relative;
        z-index: 2;
        width: min(100%, 720px);
        display: grid;
        grid-template-columns: 1fr;
        gap: 14px;
        margin: 16px auto 44px;
      }

      .portal-download-main-card,
      .portal-download-guide {
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.96);
        padding: 16px;
        box-shadow: 0 22px 56px rgba(15, 23, 42, 0.12);
      }

      .portal-download-product {
        display: grid;
        grid-template-columns: 64px minmax(0, 1fr);
        gap: 12px;
        align-items: center;
        padding-bottom: 14px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.18);
      }

      .portal-download-product > span {
        width: 64px;
        height: 64px;
        display: grid;
        place-items: center;
        border-radius: 16px;
        background:
          radial-gradient(circle at 30% 20%, rgba(255, 255, 255, 0.38), transparent 34%),
          linear-gradient(135deg, #111827, #0f766e 58%, #f97316);
        color: #ffffff;
        font-size: 22px;
        font-weight: 950;
        box-shadow: 0 16px 32px rgba(15, 118, 110, 0.22);
      }

      .portal-download-product small,
      .portal-download-guide > span,
      .portal-download-status-grid small {
        color: #0f766e;
        font-size: 11px;
        font-weight: 950;
        text-transform: uppercase;
      }

      .portal-download-product strong {
        display: block;
        margin-top: 4px;
        color: #0f172a;
        font-size: 32px;
        line-height: 0.96;
      }

      .portal-download-product p {
        margin: 7px 0 0;
        color: #475569;
        font-size: 13px;
        font-weight: 780;
        line-height: 1.34;
      }

      .portal-download-status-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.75fr);
        gap: 10px;
        margin-top: 12px;
      }

      .portal-download-status-grid span {
        display: grid;
        gap: 4px;
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 14px;
        background: #f8fafc;
        padding: 12px;
      }

      .portal-download-status-grid b {
        min-width: 0;
        color: #0f172a;
        font-size: 12px;
        line-height: 1.18;
        overflow-wrap: anywhere;
      }

      .portal-download-login-item {
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        column-gap: 10px;
      }

      .portal-download-login-item small,
      .portal-download-login-item b {
        grid-column: 1;
      }

      .portal-download-login-item button {
        grid-column: 2;
        grid-row: 1 / span 2;
        min-height: 38px;
        border: 0;
        border-radius: 12px;
        background: #0f766e;
        color: #ffffff;
        padding: 0 14px;
        font-size: 12px;
        font-weight: 950;
        cursor: pointer;
      }

      .portal-download-login-item button:disabled {
        cursor: not-allowed;
        opacity: 0.54;
      }

      .portal-download-primary {
        min-height: 58px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        margin-top: 14px;
        border-radius: 14px;
        background: linear-gradient(135deg, #16a34a, #14b8a6);
        color: #ffffff;
        font-size: 17px;
        font-weight: 950;
        text-decoration: none;
        text-transform: uppercase;
        box-shadow: 0 18px 36px rgba(20, 184, 166, 0.24);
      }

      .portal-pc-download-files {
        display: grid;
        gap: 10px;
        margin-top: 14px;
      }

      .portal-pc-download-files .portal-download-primary,
      .portal-pc-download-files .portal-download-secondary {
        margin-top: 0;
      }

      .portal-pc-resource-section {
        display: grid;
        gap: 12px;
        margin-top: 16px;
        border: 1px solid rgba(20, 184, 166, 0.18);
        border-radius: 24px;
        background: rgba(240, 253, 250, 0.82);
        padding: 14px;
      }

      .portal-pc-resource-head {
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 10px;
      }

      .portal-pc-resource-head span,
      .portal-pc-resource-card small {
        color: #0f766e;
        font-size: 11px;
        font-weight: 950;
        text-transform: uppercase;
      }

      .portal-pc-resource-head strong {
        color: #0f172a;
        font-size: 16px;
        line-height: 1.1;
        text-align: right;
      }

      .portal-pc-resource-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }

      .portal-pc-resource-card {
        display: grid;
        gap: 8px;
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 20px;
        background: #ffffff;
        padding: 12px;
      }

      .portal-pc-resource-card strong {
        color: #0f172a;
        font-size: 15px;
        line-height: 1.15;
      }

      .portal-pc-resource-card > div {
        display: grid;
        gap: 8px;
      }

      .portal-pc-resource-card a {
        min-height: 42px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        background: linear-gradient(135deg, #22c55e, #16a34a);
        color: #ffffff;
        padding: 8px 12px;
        font-size: 12px;
        font-weight: 950;
        text-align: center;
        text-decoration: none;
        text-transform: uppercase;
        overflow-wrap: anywhere;
      }

      .portal-download-secondary {
        min-height: 46px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        margin-top: 10px;
        border: 1px solid rgba(15, 118, 110, 0.22);
        border-radius: 12px;
        background: #ffffff;
        color: #0f766e;
        font-size: 14px;
        font-weight: 950;
        text-decoration: none;
      }

      .portal-pc-purchase-list {
        display: grid;
        gap: 7px;
        margin-top: 12px;
      }

      .portal-pc-purchase-list > small {
        color: #0f766e;
        font-size: 11px;
        font-weight: 950;
        text-transform: uppercase;
      }

      .portal-pc-purchase-list span {
        display: grid;
        grid-template-columns: minmax(0, 0.7fr) auto;
        gap: 3px 8px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 13px;
        background: #ffffff;
        padding: 9px;
      }

      .portal-pc-purchase-list b,
      .portal-pc-purchase-list em,
      .portal-pc-purchase-list strong,
      .portal-pc-purchase-list i {
        min-width: 0;
        font-size: 11px;
        line-height: 1.2;
        overflow-wrap: anywhere;
      }

      .portal-pc-purchase-list b {
        color: #0f172a;
      }

      .portal-pc-purchase-list em {
        justify-self: end;
        color: #047857;
        font-style: normal;
        font-weight: 950;
      }

      .portal-pc-purchase-list strong,
      .portal-pc-purchase-list i {
        color: #64748b;
        font-style: normal;
        font-weight: 800;
      }

      .portal-download-unavailable {
        margin: 14px 0 0;
        border: 1px solid rgba(249, 115, 22, 0.28);
        border-radius: 14px;
        background: #fff7ed;
        color: #9a3412;
        padding: 12px;
        font-size: 13px;
        font-weight: 880;
        line-height: 1.35;
      }

      .portal-download-guide h4 {
        margin: 5px 0 12px;
        color: #0f172a;
        font-size: 22px;
        line-height: 1.02;
      }

      .portal-download-guide ol {
        display: grid;
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
        counter-reset: downloadGuide;
      }

      .portal-download-guide li {
        counter-increment: downloadGuide;
        display: grid;
        grid-template-columns: 30px minmax(0, 1fr);
        gap: 9px;
        align-items: start;
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 13px;
        background: #ffffff;
        color: #334155;
        padding: 9px;
        font-size: 12px;
        font-weight: 850;
        line-height: 1.3;
      }

      .portal-download-guide li::before {
        content: counter(downloadGuide);
        width: 30px;
        height: 30px;
        display: grid;
        place-items: center;
        border-radius: 10px;
        background: #111827;
        color: #ffffff;
        font-size: 12px;
        font-weight: 950;
      }

      @media (max-width: 860px) {
        .portal-plugin-ffp .portal-plugin-grid,
        .portal-download-grid {
          grid-template-columns: 1fr !important;
        }

        .portal-pc-resource-grid {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 520px) {
        .portal-download-status-grid {
          grid-template-columns: 1fr;
        }

        .portal-download-login-item {
          grid-template-columns: 1fr;
        }

        .portal-download-login-item button {
          grid-column: 1;
          grid-row: auto;
          width: 100%;
          margin-top: 6px;
        }

        .portal-download-product {
          grid-template-columns: 62px minmax(0, 1fr);
        }

        .portal-download-product > span {
          width: 62px;
          height: 62px;
          border-radius: 15px;
          font-size: 18px;
        }
      }

      @media (min-width: 900px) {
        .portal-shell {
          padding: 18px !important;
        }

        .portal-shell .portal-ffp-page .ffp-poster {
          width: min(100%, 1240px) !important;
          min-height: calc(100vh - 36px) !important;
          margin: 0 auto !important;
          border-radius: 28px !important;
        }

        .portal-shell .portal-ffp-page .ffp-content {
          width: min(100%, 1160px) !important;
          margin: 0 auto !important;
          padding: 88px 28px 72px !important;
        }

        .portal-shell .portal-ffp-page:not(.portal-checkout-page):not(.portal-download-page) .ffp-main-grid {
          grid-template-columns: minmax(260px, 0.74fr) minmax(560px, 1fr) !important;
          align-items: center !important;
          gap: 28px !important;
        }

        .portal-shell .portal-ffp-page:not(.portal-checkout-page):not(.portal-plugin-ffp) .ffp-card-list {
          width: 100% !important;
          max-width: 820px !important;
          grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
          align-items: stretch !important;
        }

        .portal-shell .portal-ffp-page .ffp-price-card {
          min-width: 0 !important;
        }

        .portal-shell .portal-ffp-page .ffp-plan-head {
          grid-template-columns: 46px minmax(0, 1fr) !important;
        }

        .portal-shell .portal-ffp-page .ffp-plan-head h4 {
          font-size: clamp(28px, 3vw, 42px) !important;
          overflow-wrap: anywhere !important;
        }

        .portal-shell .portal-ffp-page .ffp-item-list b,
        .portal-shell .portal-ffp-page .ffp-feature-link b {
          font-size: 10px !important;
          line-height: 1.16 !important;
        }

        .portal-shell .portal-ffp-page .ffp-price-value strong {
          font-size: clamp(44px, 4.2vw, 58px) !important;
        }

        .portal-plugin-ffp .portal-plugin-grid {
          width: min(100%, 1020px) !important;
          margin: 0 auto !important;
        }

        .portal-plugin-ffp .portal-plugin-card-list {
          width: min(100%, 560px) !important;
          max-width: 560px !important;
        }

        .portal-download-page .portal-download-content {
          padding-top: 72px !important;
        }

        .portal-download-page .portal-download-hero {
          text-align: center !important;
        }

        .portal-download-page .portal-download-hero .ffp-badge,
        .portal-download-page .portal-download-hero p {
          margin-left: auto !important;
          margin-right: auto !important;
        }

        .portal-download-grid {
          width: min(100%, 760px) !important;
          grid-template-columns: 1fr !important;
          align-items: start !important;
          gap: 14px !important;
        }

        .portal-download-main-card,
        .portal-download-guide {
          border-radius: 22px !important;
        }

        .portal-shell .portal-checkout-page .ffp-content {
          width: min(100%, 680px) !important;
          padding-top: 72px !important;
        }

        .portal-shell .portal-checkout-page .ffp-card-list {
          max-width: 520px !important;
          grid-template-columns: 1fr !important;
        }
      }

      @media (min-width: 900px) and (max-width: 1120px) {
        .portal-shell .portal-ffp-page:not(.portal-checkout-page):not(.portal-plugin-ffp) .ffp-card-list {
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        }

        .portal-shell .portal-ffp-page:not(.portal-checkout-page):not(.portal-download-page) .ffp-main-grid {
          grid-template-columns: minmax(220px, 0.58fr) minmax(0, 1fr) !important;
        }
      }

      @media (min-width: 1280px) {
        .portal-shell .portal-ffp-page .ffp-hero h3 {
          font-size: clamp(58px, 5.4vw, 86px) !important;
        }

        .portal-shell .portal-download-page .portal-download-hero h3 {
          font-size: clamp(52px, 5vw, 76px) !important;
        }
      }
    `}</style>
  )
}
