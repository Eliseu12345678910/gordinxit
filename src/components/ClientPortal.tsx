'use client'

import { FormEvent, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { signOut } from 'firebase/auth'
import { isAccountAccessBlocked } from '@/lib/account-block'
import { auth } from '@/lib/firebase'
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
import {
  defaultAppUpdateSettings,
  loadAppUpdateSettings,
  type AppUpdateSettings,
} from '@/lib/app-update'
import type { Chat, DeviceType, PaymentProvider, PaymentTarget, PlanType } from '@/types/chat'

type PortalTab = 'plans' | 'plugins'
type AuthMode = 'login' | 'signup'
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
    'Conclua a instalacao e abra o XitDuGordin.',
    'Entre com o mesmo usuario e senha que voce usa aqui no chat privado.',
    'Depois do login, confira se o plano aparece ativo e toque nas funcoes que quiser usar.',
    'Se aparecer ServiceSync pendente, me chama aqui no chat antes de tentar mexer nas funcoes.',
  ],
  ios: [
    'Clique em ABAIXAR e abra o link no Safari.',
    'Siga o aviso da pagina de instalacao para liberar o perfil quando for solicitado.',
    'Conclua a instalacao e abra o XitDuGordin.',
    'Entre com o mesmo usuario e senha que voce usa aqui no chat privado.',
    'Depois do login, confira se o plano aparece ativo e toque nas funcoes que quiser usar.',
    'Se o iOS pedir confirmacao extra, volte aqui e fale com o suporte antes de refazer o processo.',
  ],
  emulator: [
    'Clique em ABAIXAR e espere o APK terminar de baixar no PC.',
    'Abra o emulador e arraste o APK para a janela, ou instale pelo gerenciador de APK.',
    'Aguarde a instalacao terminar e abra o XitDuGordin dentro do emulador.',
    'Entre com o mesmo usuario e senha que voce usa aqui no chat privado.',
    'Depois do login, confira se o plano aparece ativo e toque nas funcoes que quiser usar.',
    'Se aparecer ServiceSync pendente, me chama aqui no chat antes de tentar mexer nas funcoes.',
  ],
}

const planVisuals: Record<PlanType, { name: string; tag: string; tone: string; normalPrice: string }> = {
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
    normalPrice: 'R$ 197,90',
  },
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

function getPosterPlanItems(
  pluginIncluded: boolean,
  selectedDevice: DeviceType | '' | undefined,
  paidPlan: PlanType | '' | undefined,
  plan: PlanType,
): PosterPlanItem[] {
  const pluginLooksIncluded = selectedDevice === 'ios' ? true : pluginIncluded
  const items: PosterPlanItem[] = [
    { label: `Mais de ${planFeatureDisplayCount} funcoes`, action: 'features' },
    { label: 'Ant-ban e ant-blacklist' },
    { label: 'Atualizacoes semanais gratuitas' },
    { label: 'Suporte prioritario' },
    {
      label: pluginLooksIncluded ? 'Plugin Service Sync incluso' : 'Plugin Service Sync nao incluso',
      detail: pluginLooksIncluded
        ? ''
        : 'O xit so funciona com plugin. Verifique com o vendedor detalhes desse plugin; nao fazemos reembolso relacionado a plugin.',
      tone: pluginLooksIncluded ? 'positive' : 'negative',
    },
    { label: 'Tutorial de instalacao e uso' },
    { label: 'Recebimento automatico apos mandar comprovante' },
    { label: 'Mais controle para jogar apostado' },
  ]

  if (selectedDevice === 'ios') {
    const shouldWarnWeeklyAfterPurchase = paidPlan === 'weekly' && plan === 'weekly'
    const shouldWarnMonthlyAfterPurchase =
      paidPlan === 'monthly' && (plan === 'weekly' || plan === 'monthly')

    if (shouldWarnWeeklyAfterPurchase || shouldWarnMonthlyAfterPurchase) {
      items.splice(4, 0, {
        label: 'Este plano nao funciona para iOS',
        detail:
          paidPlan === 'weekly'
            ? 'Aviso importante: o plano Semanal nao e compativel com iOS. Antes de comprar outro plano, confira que para iOS e necessario o Mensal ou Permanente. Como o Semanal ja foi identificado nesta conta, qualquer ajuste ou reembolso do Semanal so sera tratado apos adquirir um plano compativel.'
            : 'Aviso importante: o plano Mensal nao libera o uso completo nesta conta iOS. Antes de comprar outro plano, confira que para iOS o plano compativel e o Permanente. Como o Mensal ja foi identificado nesta conta, qualquer ajuste ou reembolso do Mensal so sera tratado apos adquirir o Permanente.',
        tone: 'negative',
      })
    }
  }

  return items
}

const planDealMap: Record<PlanType, { duration: string; discount: string; note: string; realPrice: string }> = {
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
    realPrice: 'R$ 197,90',
  },
}

type SocialStats = { boughtToday: number; activeUsers: number }

const initialPlanSocialStats: Record<PlanType, SocialStats> = {
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
  const digits = value.replace(/\D/g, '').slice(0, 15)
  return digits.length === 13 && digits.startsWith('55') ? digits.slice(2) : digits
}

function formatPhone(value: string) {
  const digits = normalizePhone(value)
  if (digits.length <= 2) return digits
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`
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

function getSelectedDevice(chat: Chat | null, selectedDevice: DeviceType | '') {
  return selectedDevice || chat?.leadProfile?.device || ''
}

function getDownloadButtonLabel(device: DeviceType | '') {
  if (device === 'android' || device === 'emulator') {
    return `ABAIXAR XIT ${deviceDownloadLabelMap[device]}`
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
    text: `${label} confirmado. Use o codigo abaixo se precisar identificar essa compra no atendimento ou no admin.`,
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
  const [mode, setMode] = useState<AuthMode>('signup')
  const [phone, setPhone] = useState(formatPhone(defaultPhone))
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [device, setDevice] = useState<DeviceType>('android')
  const [formError, setFormError] = useState('')
  const [confirmDeviceOpen, setConfirmDeviceOpen] = useState(false)
  const selectedDeviceOption = deviceOptions.find((option) => option.value === device) || deviceOptions[0]

  useEffect(() => {
    if (error) setFormError(error)
  }, [error])

  function validateAuthForm() {
    const phoneError = validatePhone(phone)
    const passwordError = validatePassword(password)
    const confirmError = mode === 'signup' && password !== confirmPassword ? 'As senhas nao conferem.' : ''
    const nextError = phoneError || passwordError || confirmError

    setFormError(nextError)
    return !nextError
  }

  async function submitAccess() {
    setConfirmDeviceOpen(false)

    const result = await onSubmit(normalizePhone(phone), password.trim(), device, mode)
    if (result?.switchTo) {
      setMode(result.switchTo)
      setConfirmPassword('')
    }
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
          <span className="ffp-badge">Xit do Gordin | Area do cliente</span>
          <h1>{mode === 'signup' ? 'CRIAR' : 'ENTRAR'}</h1>
          <p>Seu acesso fica ligado ao WhatsApp, senha e dispositivo escolhido.</p>
        </div>

        <div className="portal-auth-tabs" role="tablist" aria-label="Tipo de acesso">
          <button
            type="button"
            className={mode === 'signup' ? 'active' : ''}
            onClick={() => {
              setMode('signup')
              setConfirmDeviceOpen(false)
            }}
          >
            CRIAR
          </button>
          <button
            type="button"
            className={mode === 'login' ? 'active' : ''}
            onClick={() => {
              setMode('login')
              setConfirmDeviceOpen(false)
            }}
          >
            ENTRAR
          </button>
        </div>

        <form className="portal-auth-form" onSubmit={handleSubmit}>
          <label>
            <span>Numero de WhatsApp</span>
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
          </label>

          <label>
            <span>Senha</span>
            <input
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                setFormError('')
                setConfirmDeviceOpen(false)
              }}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              placeholder="Digite sua senha"
            />
          </label>

          {mode === 'signup' && (
            <label>
              <span>Confirmar senha</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value)
                  setConfirmDeviceOpen(false)
                }}
                autoComplete="new-password"
                placeholder="Repita sua senha"
              />
            </label>
          )}

          <fieldset className="portal-device-field">
            <legend>Escolha seu dispositivo</legend>
            <div>
              {deviceOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={device === option.value ? 'active' : ''}
                  onClick={() => {
                    setDevice(option.value)
                    setConfirmDeviceOpen(false)
                  }}
                >
                  <DeviceGlyph device={option.value} />
                  <strong>{option.label}</strong>
                  <small>{option.detail}</small>
                </button>
              ))}
            </div>
          </fieldset>

          {formError && <strong className="portal-form-error">{formError}</strong>}

          <button className="portal-auth-submit" type="submit" disabled={loading}>
            {loading ? 'AGUARDE...' : mode === 'signup' ? 'CRIAR' : 'ENTRAR'}
          </button>
        </form>

        {confirmDeviceOpen && (
          <section className="portal-device-confirm" aria-live="polite">
            <span>Confirmar dispositivo</span>
            <h2>{selectedDeviceOption.label}</h2>
            <p>
              Voce vai usar no {selectedDeviceOption.detail}? Escolha certo para liberar os planos e instrucoes corretas.
            </p>
            <div>
              <button type="button" onClick={() => setConfirmDeviceOpen(false)}>
                Trocar
              </button>
              <button type="button" onClick={submitAccess} disabled={loading}>
                Confirmar {selectedDeviceOption.label}
              </button>
            </div>
          </section>
        )}
      </section>
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

function AccountMenu({
  chat,
  phone,
  device,
  onLogout,
}: {
  chat: Chat | null
  phone: string
  device: DeviceType | ''
  onLogout: () => void
}) {
  const [open, setOpen] = useState(false)
  const activePlan = getActivePlan(chat)
  const purchaseCode = getPurchaseCode(chat)
  const pluginActive = isPluginActive(chat)

  return (
    <div className="portal-account-menu">
      <button
        className="portal-dots-button"
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label="Abrir informacoes da conta"
        aria-expanded={open}
      >
        <span />
        <span />
        <span />
      </button>

      {open && (
        <div className="portal-account-popover" role="dialog" aria-label="Informacoes da conta">
          <div className="portal-account-head">
            <span>Conta conectada</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Fechar">
              X
            </button>
          </div>

          <div className="portal-account-card">
            <small>Numero de WhatsApp</small>
            <strong>{formatPhone(phone)}</strong>
          </div>

          <div className="portal-account-grid">
            <div>
              <small>Dispositivo</small>
              <strong>{device ? deviceLabelMap[device] : 'Nao escolhido'}</strong>
            </div>
            <div>
              <small>Plano</small>
              <strong>{activePlan ? planOptions.find((plan) => plan.value === activePlan)?.label : 'Sem plano ativo'}</strong>
            </div>
            <div>
              <small>Plugin</small>
              <strong>{pluginActive ? 'Ativo' : 'Pendente'}</strong>
            </div>
            <div>
              <small>Compra</small>
              <strong>{purchaseCode || 'Sem codigo'}</strong>
            </div>
          </div>

          <button className="portal-account-logout" type="button" onClick={onLogout}>
            Sair da conta
          </button>
        </div>
      )}
    </div>
  )
}

function PortalHeader({
  tab,
  canOpenPlugin,
  phone,
  device,
  onLogout,
}: {
  tab: PortalTab
  canOpenPlugin: boolean
  phone: string
  device: DeviceType | ''
  onLogout: () => void
}) {
  return (
    <header className="portal-topbar">
      <div>
        <span>Logado como</span>
        <strong>{formatPhone(phone)}</strong>
        {device && <small>{deviceLabelMap[device]}</small>}
      </div>
      <nav aria-label="Area do cliente">
        <a className={tab === 'plans' ? 'active' : ''} href="/planos">
          Planos
        </a>
        {canOpenPlugin && (
          <a className={tab === 'plugins' ? 'active' : ''} href="/plugins">
            Plugin
          </a>
        )}
      </nav>
      <button type="button" onClick={onLogout}>
        Sair
      </button>
    </header>
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
          const [main, cents = '00'] = plan.priceLabel.replace('R$ ', '').split(',')

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
  phone,
  selectedDevice,
  selectedPlan,
  saving,
  paymentLinks,
  onLogout,
  onBuy,
  onDownload,
}: {
  chat: Chat | null
  canOpenPlugin: boolean
  phone: string
  selectedDevice: DeviceType | ''
  selectedPlan: PlanType | ''
  saving: boolean
  paymentLinks: Record<PlanType, string>
  paymentProvider: PaymentProvider
  onLogout: () => void
  onBuy: (target: PaymentTarget, link: string, label: string) => void
  onDownload: () => void
}) {
  const activePlan = getActivePlan(chat)
  const purchaseCode = getPurchaseCode(chat)
  const device = getSelectedDevice(chat, selectedDevice)
  const [showAllFeatures, setShowAllFeatures] = useState(false)
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

          <header className={`ffp-controls portal-ffp-controls ${canOpenPlugin ? '' : 'no-switch'}`}>
            {canOpenPlugin && (
              <nav className="portal-mode-switch" aria-label="Area do cliente">
                <a className="active" href="/planos">Planos</a>
                <a href="/plugins">Plugin</a>
              </nav>
            )}
            <AccountMenu chat={chat} phone={phone} device={device} onLogout={onLogout} />
          </header>

          <div className="ffp-content">
            <section className="ffp-hero">
              <span className="ffp-badge">Xit do Gordin | Ant-ban</span>
              <h3>
                Eleve
                <strong>seu jogo</strong>
              </h3>
              <p>Mais de 3 anos xitando geral.</p>
            </section>

            <div className="ffp-main-grid">
              <div className="ffp-showcase" aria-hidden="true">
                <div className="ffp-cyber">
                  <span className="ffp-cyber-body" />
                  <span className="ffp-cyber-head" />
                  <span className="ffp-cyber-mask" />
                  <span className="ffp-cyber-eye eye-a" />
                  <span className="ffp-cyber-eye eye-b" />
                  <span className="ffp-cyber-chest">XIT <b>GORDIN</b></span>
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
                  const isSelected = selectedPlan === option.value || chat?.selectedPlan?.plan === option.value
                  const posterPlanItems = getPosterPlanItems(
                    chat?.plugin?.included !== false,
                    device,
                    activePlan,
                    option.value,
                  )
                  const [priceMain, priceCents = '00'] = option.priceLabel.replace('R$ ', '').split(',')
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
                        {posterPlanItems.map((item) =>
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
  phone,
  device,
  saving,
  pluginLink,
  onLogout,
  onBuy,
}: {
  chat: Chat | null
  phone: string
  device: DeviceType | ''
  saving: boolean
  pluginLink: string
  onLogout: () => void
  onBuy: (target: PaymentTarget, link: string, label: string) => void
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
              <a href="/planos">Planos</a>
              <a className="active" href="/plugins">Plugin</a>
            </nav>
            <AccountMenu chat={chat} phone={phone} device={device} onLogout={onLogout} />
          </header>

          <div className="ffp-content">
            <section className="ffp-hero">
              <span className="ffp-badge">Service Sync Core, depois disso nao precisa pagar por mais nada</span>
              <h3>
                Libere
                <strong>o modulo</strong>
              </h3>
              <p>O ServiceSync Core fecha a sincronizacao tecnica da conta, libera todas as funcoes e deixa o xit pronto para jogar.</p>
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
                      <small>Ativacao unica</small>
                    </div>
                  </div>

                  <div className="portal-plugin-progress">
                    <div>
                      <span>Semanal → Permanente</span>
                      <strong>{active ? 'liberado' : 'quase pronto'}</strong>
                    </div>
                    <i aria-hidden="true" />
                  </div>

                  <div className="ffp-item-list">
                    {[
                      'Todas as funcoes do xit liberadas',
                      'Execucao completa sem erro de sincronizacao',
                      'Conta pronta para jogar apos a confirmacao',
                      'Plano convertido de Semanal → Permanente',
                      'Uso vitalicio com atualizacoes gratuitas',
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
                      <span>Ativacao unica</span>
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

                  <div className="ffp-social-stats portal-plugin-social-stats" aria-label="Prova social do plugin">
                    <span className="ffp-stat bought">
                      <i aria-hidden="true" />
                      <b>+{livePluginStats.boughtToday}</b>
                      <small>plugins hoje</small>
                    </span>
                    <span className="ffp-stat active">
                      <i aria-hidden="true" />
                      <b>+{livePluginStats.activeUsers}</b>
                      <small>plugins ativos</small>
                    </span>
                  </div>

                  <div className="portal-plugin-outcome" aria-label="Resultado apos ativar">
                    <span>
                      <b>OK</b>
                      Todas as funcoes
                    </span>
                    <span>
                      <b>OK</b>
                      Pronto para jogar
                    </span>
                    <span>
                      <b>OK</b>
                      Uso vitalicio
                    </span>
                  </div>

                  <div className="portal-plugin-modules" aria-label="Modulos verificados">
                    {pluginModules.map((module) => {
                      const missing = module === 'ServiceSync Core' && !active

                      return (
                        <span key={module} className={missing ? 'missing' : 'ready'}>
                          <b>{missing ? '!' : 'OK'}</b>
                          <strong>{module}</strong>
                        </span>
                      )
                    })}
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
                <span>{recentPluginPurchase.phone} - Service Sync Core liberado.</span>
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
        <p>Baixe a versao liberada para sua conta e entre com o mesmo usuario e senha do portal.</p>

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
            Link de download ainda nao cadastrado. Chame o suporte no chat privado.
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
    <main className="portal-shell auth-shell">
      <section className="portal-auth not-found">
        <span>404</span>
        <h1>Pagina nao encontrada</h1>
      </section>
      <PortalStyles />
    </main>
  )
}

export function ClientPortal({ initialTab = 'plans' }: { initialTab?: PortalTab }) {
  const [chatId, setChatId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [phone, setPhone] = useState('')
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
  const [pluginPaymentLink, setPluginPaymentLink] = useState(getPluginPaymentLink('perfect-pay'))
  const [approvalNotice, setApprovalNotice] = useState<PaymentNotice | null>(null)
  const [appUpdateSettings, setAppUpdateSettings] = useState<AppUpdateSettings>(defaultAppUpdateSettings)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const activePlan = getActivePlan(chatMeta)
  const currentPhone = phone || getStoredUsername()
  const currentDevice = getSelectedDevice(chatMeta, selectedDevice)
  const canOpenPlugin = Boolean(activePlan && (currentDevice === 'android' || currentDevice === 'emulator'))
  const visibleTab = initialTab === 'plugins' && canOpenPlugin ? 'plugins' : 'plans'

  useEffect(() => {
    let active = true

    async function loadPaymentSettings() {
      try {
        const response = await fetch('/api/payment/settings', { cache: 'no-store' })
        const payload = (await response.json()) as {
          paymentProvider?: PaymentProvider
          links?: Record<PlanType, string>
          pluginLink?: string
        }

        if (!active || !response.ok) return
        const provider =
          payload.paymentProvider === 'kiwify' || payload.paymentProvider === 'perfect-pay'
            ? payload.paymentProvider
            : 'perfect-pay'
        setPaymentProvider(provider)
        setPaymentLinks(payload.links || getPaymentLinks(provider))
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

        const storedChatId = getStoredChatId() || ''
        setChatId(storedChatId)
        setAccountId(getStoredAccountId())
        setPhone(getStoredUsername())
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
        mode,
        clientId: getClientId(),
        requestedChatId: getStoredChatId() || makeId('site'),
      })

      storeChatId(access.chatId)
      storeAccountId(access.accountId)
      storeUsername(access.accessUsername)
      setChatId(access.chatId)
      setAccountId(access.accountId)
      setPhone(access.accessUsername)

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

  async function handleOpenDownload() {
    if (!canDownloadXit(currentDevice)) return

    setDownloadOpen(true)

    try {
      setAppUpdateSettings(await loadAppUpdateSettings())
    } catch (settingsError) {
      console.error('Nao foi possivel carregar o download do app:', settingsError)
    }

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
  }

  async function handleLogout() {
    clearClientSession()
    storeAccountBlocked(false)
    setChatId('')
    setAccountId('')
    setPhone('')
    setSelectedDevice('')
    setSelectedPlan('')
    setChatMeta(null)
    setApprovalNotice(null)

    try {
      await signOut(auth)
    } catch (logoutError) {
      console.error('Nao foi possivel sair:', logoutError)
    }
  }

  function closeApprovalNotice() {
    if (approvalNotice) {
      setSecureItem(`${approvalKeyPrefix}-${approvalNotice.code}-${approvalNotice.target}`, '1')
    }
    setApprovalNotice(null)
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

      {visibleTab === 'plugins' ? (
        <PluginPage
          chat={chatMeta}
          phone={currentPhone}
          device={currentDevice}
          saving={saving}
          pluginLink={pluginPaymentLink}
          onLogout={handleLogout}
          onBuy={handleBuy}
        />
      ) : (
        <PlansPage
          chat={chatMeta}
          canOpenPlugin={canOpenPlugin}
          phone={currentPhone}
          selectedDevice={selectedDevice}
          selectedPlan={selectedPlan}
          saving={saving}
          paymentLinks={paymentLinks}
          paymentProvider={paymentProvider}
          onLogout={handleLogout}
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
      .portal-device-confirm span,
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

      .portal-device-confirm {
        position: relative;
        z-index: 2;
        display: grid;
        gap: 10px;
        border: 1px solid rgba(34, 211, 238, 0.28);
        border-radius: 16px;
        background:
          linear-gradient(135deg, rgba(34, 197, 94, 0.13), rgba(14, 165, 233, 0.16)),
          rgba(2, 6, 23, 0.58);
        padding: 14px;
        box-shadow: 0 18px 42px rgba(0, 0, 0, 0.22);
      }

      .portal-device-confirm h2 {
        margin: 0;
        color: #ffffff;
        font-size: 34px;
        line-height: 0.98;
        text-transform: uppercase;
      }

      .portal-device-confirm p {
        margin: 0;
        color: rgba(255, 255, 255, 0.78);
        font-size: 13px;
        font-weight: 850;
        line-height: 1.35;
      }

      .portal-device-confirm div {
        display: grid;
        grid-template-columns: minmax(0, 0.7fr) minmax(0, 1.3fr);
        gap: 8px;
      }

      .portal-device-confirm button {
        min-height: 44px;
        border-radius: 8px;
        font-weight: 950;
        text-transform: uppercase;
      }

      .portal-device-confirm button:first-child {
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.08);
        color: #ffffff;
      }

      .portal-device-confirm button:last-child {
        background: linear-gradient(135deg, #22c55e, #0ea5e9);
        color: #021018;
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

      .portal-ffp-controls.no-switch {
        justify-content: flex-end !important;
      }

      .portal-ffp-controls.no-switch .portal-account-menu {
        position: static !important;
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

      .portal-account-menu {
        position: absolute !important;
        right: 0 !important;
        top: 0 !important;
        z-index: 120 !important;
      }

      .portal-dots-button {
        min-height: 38px !important;
        width: 38px !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 3px !important;
        border: 0 !important;
        border-radius: 999px !important;
        background: transparent !important;
        color: #ffffff !important;
        padding: 0 6px !important;
        box-shadow: none !important;
        backdrop-filter: none !important;
      }

      .portal-dots-button span {
        width: 5px;
        height: 5px;
        border-radius: 999px;
        background: currentColor;
        box-shadow: 0 0 12px rgba(255, 255, 255, 0.35);
      }

      .portal-account-popover {
        position: absolute;
        top: calc(100% + 10px);
        right: 0;
        width: min(330px, calc(100vw - 24px));
        display: grid;
        gap: 10px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 18px;
        background:
          radial-gradient(circle at 18% 0%, rgba(14, 165, 233, 0.18), transparent 46%),
          linear-gradient(180deg, rgba(18, 22, 40, 0.98), rgba(5, 7, 16, 0.98));
        color: #ffffff;
        padding: 12px;
        box-shadow:
          0 24px 70px rgba(0, 0, 0, 0.42),
          inset 0 0 0 1px rgba(255, 255, 255, 0.035);
        text-align: left;
      }

      .portal-account-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .portal-account-head span,
      .portal-account-card small,
      .portal-account-grid small {
        color: #22d3ee;
        font-size: 9px;
        font-weight: 950;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .portal-account-head button {
        width: 30px;
        height: 30px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        color: #ffffff;
        font-size: 11px;
        font-weight: 950;
      }

      .portal-account-card,
      .portal-account-grid div {
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.055);
        padding: 10px;
      }

      .portal-account-card strong {
        display: block;
        margin-top: 3px;
        color: #ffffff;
        font-size: 22px;
        line-height: 1;
      }

      .portal-account-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      .portal-account-grid strong {
        display: block;
        margin-top: 4px;
        min-width: 0;
        overflow-wrap: anywhere;
        color: rgba(255, 255, 255, 0.9);
        font-size: 12px;
        line-height: 1.15;
      }

      .portal-account-logout {
        min-height: 42px;
        border-radius: 12px;
        background: linear-gradient(135deg, #ef4444, #f97316);
        color: #ffffff;
        font-size: 12px;
        font-weight: 950;
        text-transform: uppercase;
        box-shadow: 0 14px 30px rgba(249, 115, 22, 0.22);
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
        padding-top: 4px;
      }

      .portal-plugin-card-list .ffp-top-badge {
        position: relative !important;
        top: auto !important;
        right: auto !important;
        width: max-content;
        margin: 12px 14px 0 auto;
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
        padding-top: 7px !important;
        padding-right: 14px !important;
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

        .portal-device-confirm div {
          grid-template-columns: 1fr;
        }

        .portal-auth h1,
        .portal-hero h1 {
          font-size: 42px;
        }
      }
    `}</style>
  )
}
