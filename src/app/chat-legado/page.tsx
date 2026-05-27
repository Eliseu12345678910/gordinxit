'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import { signOut } from 'firebase/auth'
import { Timestamp } from 'firebase/firestore'
import { ChatMessages } from '@/components/ChatMessages'
import { MessageComposer } from '@/components/MessageComposer'
import { isAccountAccessBlocked } from '@/lib/account-block'
import { signInAdmin } from '@/lib/admin-session'
import { auth } from '@/lib/firebase'
import { videoFiles } from '@/lib/video'
import {
  addMessage,
  addPaymentTrackingToLink,
  ChatAccessError,
  checkClientSessionAccess,
  clearClientSession,
  deviceOptions,
  ensureAnonymousSession,
  getPluginPaymentLink,
  getStoredAccountBlocked,
  getStoredAccountId,
  getClientId,
  getStoredChatId,
  getStoredDevice,
  getStoredPlan,
  getStoredUsername,
  getPaymentLinks,
  listenChat,
  listenMessages,
  makeId,
  planOptions,
  registerClientButtonClick,
  registerClientActivity,
  requestChatAccess,
  registerPaymentClick,
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
import type { AudioKey, Chat, ChatMessage, DeviceType, IntroAudioKey, PaymentProvider, PaymentTarget, PlanType } from '@/types/chat'

const deviceAudioMap: Record<DeviceType, AudioKey> = {
  android: 'second-android',
  ios: 'second-ios',
  emulator: 'second-emulator',
}

const latestDeviceAudioMap: Record<DeviceType, AudioKey> = {
  android: 'latest-android',
  ios: 'latest-ios',
  emulator: 'latest-emulator',
}

const fullPresentationStep = 11
const devicePromptStep = 3
const introReadyKeyPrefix = 'chat-atendimento-intro-ready-v1'
const introAudioKeyPrefix = 'chat-atendimento-intro-audio-v1'

const deviceAudioLabelMap: Record<DeviceType, string> = {
  android: 'Android',
  ios: 'iOS',
  emulator: 'Emulador',
}

function isIntroAudioKey(value: unknown): value is IntroAudioKey {
  return value === 'start-live' || value === 'start'
}

function makeIntroAudioMessage(audioKey: IntroAudioKey = 'start'): ChatMessage {
  return {
    id: 'simulated-audio-start',
    text: 'Audio 1 de 4 - inicio do Gordin du Xit',
    sender: 'admin',
    kind: 'text',
    audioKey,
  }
}

function makeDeviceSelectorMessage(): ChatMessage {
  return {
    id: 'simulated-device-selector',
    text: 'Escolha seu dispositivo',
    sender: 'admin',
    kind: 'device_selector',
  }
}

function makeSimulatedAudioMessages(device: DeviceType, introAudioKey: IntroAudioKey): ChatMessage[] {
  const deviceLabel = deviceAudioLabelMap[device]

  return [
    makeIntroAudioMessage(introAudioKey),
    {
      id: 'simulated-audio-device',
      text: `Audio 2 de 4 - instrucoes para ${deviceLabel}`,
      sender: 'admin',
      kind: 'text',
      audioKey: deviceAudioMap[device],
    },
    {
      id: 'simulated-audio-penultimate',
      text: 'Audio 3 de 4 - explicacao principal',
      sender: 'admin',
      kind: 'text',
      audioKey: 'penultimate',
    },
    {
      id: 'simulated-audio-latest',
      text: `Audio 4 de 4 - finalizacao para ${deviceLabel}`,
      sender: 'admin',
      kind: 'text',
      audioKey: latestDeviceAudioMap[device],
    },
  ]
}

function makeLocalFeatureMessage(): ChatMessage {
  return {
    id: 'simulated-feature-showcase',
    text: 'Funcoes do xit',
    sender: 'admin',
    kind: 'feature_showcase',
  }
}

function makeDemoVideoMessage(device: DeviceType): ChatMessage {
  return {
    id: 'simulated-demo-video',
    text: 'Video demonstrativo',
    sender: 'admin',
    kind: 'demo_video',
    videoUrl: videoFiles[device],
  }
}

function makeRecordingMessage(id: string): ChatMessage {
  return {
    id,
    text: 'gravando audio...',
    sender: 'admin',
    kind: 'recording_indicator',
  }
}

function getStoredIntroReady(chatId: string) {
  if (typeof window === 'undefined' || !chatId) return false
  return getSecureItem(`${introReadyKeyPrefix}-${chatId}`) === 'true'
}

function storeIntroReady(chatId: string) {
  if (typeof window === 'undefined' || !chatId) return
  setSecureItem(`${introReadyKeyPrefix}-${chatId}`, 'true')
}

function getStoredIntroAudioKey(chatId: string): IntroAudioKey {
  if (typeof window === 'undefined' || !chatId) return 'start'
  const stored = getSecureItem(`${introAudioKeyPrefix}-${chatId}`)
  return isIntroAudioKey(stored) ? stored : 'start'
}

function storeIntroAudioKey(chatId: string, audioKey: IntroAudioKey) {
  if (typeof window === 'undefined' || !chatId) return
  setSecureItem(`${introAudioKeyPrefix}-${chatId}`, audioKey)
}

function getIntroAudioKey(chat: Chat | null, fallback: IntroAudioKey): IntroAudioKey {
  return isIntroAudioKey(chat?.introAudioKey) ? chat.introAudioKey : fallback
}

function addTimestampOffset(timestamp: Chat['createdAt'] | undefined, offsetMs: number) {
  const millis = timestamp?.toMillis?.()
  if (typeof millis !== 'number' || !Number.isFinite(millis)) return undefined
  return Timestamp.fromMillis(millis + offsetMs)
}

function getPresentationTimestamp(chat: Chat | null, messageId: string) {
  const chatCreatedAt = chat?.createdAt
  const deviceSelectedAt = chat?.leadProfile?.deviceSelectedAt || chat?.createdAt
  const sourceTimestamp = messageId === 'simulated-audio-start' || messageId === 'simulated-device-selector'
    ? chatCreatedAt
    : deviceSelectedAt

  const offsets: Record<string, number> = {
    'simulated-recording-start': 0,
    'simulated-audio-start': 1800,
    'simulated-device-selector': 15000,
    'simulated-recording-device': 0,
    'simulated-audio-device': 2200,
    'simulated-feature-showcase': 17200,
    'simulated-demo-video': 19700,
    'simulated-recording-penultimate': 21500,
    'simulated-audio-penultimate': 27500,
    'simulated-recording-latest': 30000,
    'simulated-audio-latest': 32200,
  }

  return addTimestampOffset(sourceTimestamp, offsets[messageId] || 0)
}

function withFirebasePresentationTimes(messages: ChatMessage[], chat: Chat | null) {
  return messages.map((message) => ({
    ...message,
    createdAt: message.createdAt || getPresentationTimestamp(chat, message.id),
  }))
}

function shouldHideAutomationMessage(message: ChatMessage) {
  return (
    message.kind === 'device_intro' ||
    message.kind === 'feature_showcase' ||
    message.text.startsWith('Principais ferramentas Xit') ||
    message.text.startsWith('Perfeito —') ||
    message.text.startsWith('Escolhe: Semanal')
  )
}

function arrangeMessagesWithSimulatedAudio(
  messages: ChatMessage[],
  device: DeviceType | undefined,
  visibleSequenceItems: number,
  chat: Chat | null,
  fallbackIntroAudioKey: IntroAudioKey,
) {
  const introAudio = makeIntroAudioMessage(getIntroAudioKey(chat, fallbackIntroAudioKey))
  const sequence: ChatMessage[] = [
    makeRecordingMessage('simulated-recording-start'),
    introAudio,
    makeDeviceSelectorMessage(),
  ]
  const simulatedAudioMessages = device ? makeSimulatedAudioMessages(device, introAudio.audioKey as IntroAudioKey) : [introAudio]

  if (device) {
    const [, secondAudio, thirdAudio, fourthAudio] = simulatedAudioMessages

    sequence.push(
      makeRecordingMessage('simulated-recording-device'),
      secondAudio,
      makeLocalFeatureMessage(),
      makeDemoVideoMessage(device),
      makeRecordingMessage('simulated-recording-penultimate'),
      thirdAudio,
      makeRecordingMessage('simulated-recording-latest'),
      fourthAudio,
    )
  }

  const visibleSequence = withFirebasePresentationTimes(
    sequence.slice(0, visibleSequenceItems).filter((message) => {
      if (message.id === 'simulated-recording-start') return visibleSequenceItems < 2
      if (message.id === 'simulated-recording-device') return visibleSequenceItems < 5
      if (message.id === 'simulated-recording-penultimate') return visibleSequenceItems < 9
      if (message.id === 'simulated-recording-latest') return visibleSequenceItems < 11
      return true
    }),
    chat,
  )
  const realMessages = messages.filter(
    (message) =>
      !shouldHideAutomationMessage(message) &&
      !simulatedAudioMessages.some((audioMessage) => audioMessage.id === message.id),
  )

  return [...visibleSequence, ...realMessages]
}

function isAdminEmailInput(username: string, mode: AuthMode) {
  return mode === 'login' && username.trim().includes('@')
}

function validateUsername(username: string, mode: AuthMode) {
  const clean = username.trim()
  if (!clean) return 'Digite seu usuário.'
  if (isAdminEmailInput(clean, mode)) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return 'Digite um e-mail valido.'
    return ''
  }
  if (clean.length < 2) return 'Use pelo menos 2 caracteres.'
  if (clean.length > 24) return 'Use no máximo 24 caracteres.'
  if (!/^[a-zA-Z0-9_.-]+$/.test(clean)) {
    return 'Use letras, números, ponto, traço ou underline.'
  }
  return ''
}

function validatePassword(password: string, allowLongPassword = false) {
  if (!password) return 'Digite sua senha.'
  if (password.length < 4) return 'A senha precisa ter pelo menos 4 caracteres.'
  if (allowLongPassword && password.length > 128) return 'A senha pode ter no maximo 128 caracteres.'
  if (!allowLongPassword && password.length > 32) return 'A senha pode ter no máximo 32 caracteres.'
  return ''
}

type AuthMode = 'login' | 'signup'
type AuthSubmitResult = { message: string; switchTo?: AuthMode } | void

function AuthScreen({
  defaultUsername,
  loading,
  error,
  onSubmit,
}: {
  defaultUsername: string
  loading: boolean
  error: string
  onSubmit: (username: string, password: string, isSignup: boolean) => Promise<AuthSubmitResult>
}) {
  const [mode, setMode] = useState<AuthMode>('signup')
  const [username, setUsername] = useState(defaultUsername)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [usernameError, setUsernameError] = useState('')
  const [passwordError, setPasswordError] = useState('')

  useEffect(() => {
    if (error) setPasswordError(error)
  }, [error])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const adminLogin = isAdminEmailInput(username, mode)
    const nextUsernameError = validateUsername(username, mode)
    const nextPasswordError = validatePassword(password, adminLogin)
    const nextConfirmError = mode === 'signup' && password !== confirmPassword ? 'As senhas não conferem.' : ''

    setUsernameError(nextUsernameError)
    setPasswordError(nextPasswordError || nextConfirmError)

    if (nextUsernameError || nextPasswordError || nextConfirmError) return

    const result = await onSubmit(username, password, mode === 'signup')
    if (result?.switchTo) {
      setMode(result.switchTo)
      setConfirmPassword('')
    }
    if (result?.message) setPasswordError(result.message)
  }

  return (
    <main className="client-page login-page">
      <section className="auth-panel" aria-label="Login ou registro">
        <div className="auth-hero">
          <h1 className="hero-title">Gordin du Xit</h1>
          <p className="hero-subtitle">Crie uma conta ou entre para continuar no atendimento.</p>
        </div>

        <div className="auth-tabs">
          <button
            type="button"
            className={`tab-button ${mode === 'signup' ? 'active' : ''}`}
            onClick={() => {
              setMode('signup')
              setPasswordError('')
              setConfirmPassword('')
            }}
            aria-selected={mode === 'signup'}
          >
            <span>Criar conta</span>
          </button>
          <button
            type="button"
            className={`tab-button ${mode === 'login' ? 'active' : ''}`}
            onClick={() => {
              setMode('login')
              setPasswordError('')
            }}
            aria-selected={mode === 'login'}
          >
            <span>Entrar</span>
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <label className="form-group">
            <span className="form-label">{mode === 'login' ? 'Usuario ou e-mail' : 'Usuario'}</span>
            <input
              value={username}
              onChange={(event) => {
                setUsername(event.target.value)
                setUsernameError('')
              }}
              placeholder={mode === 'login' ? 'seu_usuario ou email@dominio.com' : 'seu_usuario'}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={Boolean(usernameError)}
              aria-describedby={usernameError ? 'username-error' : undefined}
              className="form-input"
            />
            {usernameError && (
              <strong className="form-error" id="username-error">
                {usernameError}
              </strong>
            )}
          </label>

          <label className="form-group">
            <span className="form-label">Senha</span>
            <div className="password-wrapper">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                  setPasswordError('')
                }}
                placeholder="Digite sua senha"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                aria-invalid={Boolean(passwordError)}
                aria-describedby={passwordError ? 'password-error' : 'password-hint'}
                className="form-input"
              />
              <button
                className={`password-toggle ${showPassword ? 'is-visible' : ''}`}
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                <span className="sr-only">{showPassword ? 'Ocultar senha' : 'Mostrar senha'}</span>
              </button>
            </div>
            {passwordError ? (
              <strong className="form-error" id="password-error">
                {passwordError}
              </strong>
            ) : (
              <span className="form-hint" id="password-hint">
                Minimo 4 caracteres.
              </span>
            )}
          </label>

          {mode === 'signup' && (
            <label className="form-group">
              <span className="form-label">Confirmar senha</span>
              <div className="password-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Repita a senha"
                  autoComplete="new-password"
                  className="form-input"
                />
              </div>
            </label>
          )}

          <button
            className="auth-submit"
            type="submit"
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? (
              <>
                <span className="spinner" />
                {mode === 'signup' ? 'Criando conta...' : 'Entrando...'}
              </>
            ) : mode === 'signup' ? (
              'Criar conta'
            ) : (
              'Entrar'
            )}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            {mode === 'signup' ? (
              <>
                Já tem conta?{' '}
                <button type="button" onClick={() => setMode('login')} className="link-button">
                  Entrar
                </button>
              </>
            ) : (
              <>
                Não tem conta?{' '}
                <button type="button" onClick={() => setMode('signup')} className="link-button">
                  Criar agora
                </button>
              </>
            )}
          </p>
        </div>
      </section>
    </main>
  )
}

function DeviceIcon({ icon }: { icon: 'android' | 'ios' | 'desktop' }) {
  if (icon === 'android') {
    return (
      <svg className="device-svg" viewBox="0 0 48 48" aria-hidden="true">
        <path d="M14 18h20v16a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V18Z" />
        <path d="M18 14 14 8M30 14l4-6M14 18h20" />
        <circle cx="20" cy="25" r="1.8" />
        <circle cx="28" cy="25" r="1.8" />
        <path d="M10 20v12M38 20v12" />
      </svg>
    )
  }

  if (icon === 'ios') {
    return (
      <svg className="device-svg filled" viewBox="0 0 48 48" aria-hidden="true">
        <path d="M30.5 7.5c-2.9 1.1-5 3.9-4.7 7 2.8.2 5.7-2 6.4-5 .2-.8.1-1.5-.1-2" />
        <path d="M34.5 25.6c-.1-4.2 3.4-6.2 3.6-6.3-2-2.9-5-3.3-6-3.4-2.6-.3-5 1.5-6.3 1.5-1.4 0-3.5-1.5-5.7-1.4-2.9 0-5.6 1.7-7.1 4.3-3 5.2-.8 13 2.2 17.2 1.4 2.1 3.1 4.4 5.4 4.3 2.1-.1 2.9-1.4 5.5-1.4s3.3 1.4 5.6 1.3c2.3 0 3.8-2.1 5.2-4.2 1.6-2.4 2.3-4.7 2.3-4.8-.1 0-4.6-1.8-4.7-7.1Z" />
      </svg>
    )
  }

  return (
    <svg className="device-svg" viewBox="0 0 48 48" aria-hidden="true">
      <rect x="8" y="10" width="32" height="22" rx="3" />
      <path d="M20 38h8M24 32v6" />
    </svg>
  )
}

function DevicePrompt({
  selectedDevice,
  savingDevice,
  locked,
  onSelect,
}: {
  selectedDevice: string
  savingDevice: boolean
  locked?: boolean
  onSelect: (device: DeviceType) => void
}) {
  return (
    <article className="message-bubble admin other device-prompt">
      <p>Para eu enviar o xit correto me fale seu celular</p>
      <div className="device-grid" aria-label="Escolha seu dispositivo">
        {deviceOptions.map((option) => (
          <button
            key={option.value}
            className={`device-option ${selectedDevice === option.value ? 'selected' : ''}`}
            type="button"
            onClick={() => onSelect(option.value)}
            disabled={savingDevice || locked}
          >
            <DeviceIcon icon={option.icon} />
            <strong>{option.label}</strong>
            <small>{option.detail}</small>
          </button>
        ))}
      </div>
      {savingDevice && <span className="field-help">Salvando escolha...</span>}
    </article>
  )
}

function NotFoundAccess() {
  return (
    <main className="client-page">
      <section className="chat-panel" aria-label="Pagina nao encontrada">
        <div className="client-404-panel" role="alert">
          <strong>404</strong>
          <h1>Pagina nao encontrada</h1>
        </div>
      </section>
    </main>
  )
}

export default function ClientChatPage() {
  const [chatId, setChatId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [selectedDevice, setSelectedDevice] = useState('')
  const [presentationDevice, setPresentationDevice] = useState('')
  const [selectedPlan, setSelectedPlan] = useState('')
  const [chatMeta, setChatMeta] = useState<Chat | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [introAudioKey, setIntroAudioKey] = useState<IntroAudioKey>('start')
  const [loading, setLoading] = useState(true)
  const [accessLoading, setAccessLoading] = useState(false)
  const [savingDevice, setSavingDevice] = useState(false)
  const [savingPlan, setSavingPlan] = useState(false)
  const [openingPayment, setOpeningPayment] = useState(false)
  const [composerToast, setComposerToast] = useState('')
  const [error, setError] = useState('')
  const [blockedAccess, setBlockedAccess] = useState(() => getStoredAccountBlocked())
  const [visibleSequenceItems, setVisibleSequenceItems] = useState(0)
  const [paymentProvider, setPaymentProvider] = useState<PaymentProvider>('perfect-pay')
  const [activePaymentLinks, setActivePaymentLinks] = useState<Record<PlanType, string>>(
    getPaymentLinks('perfect-pay'),
  )
  const [activePluginPaymentLink, setActivePluginPaymentLink] = useState(
    getPluginPaymentLink('perfect-pay'),
  )

  const selectedDeviceOption = deviceOptions.find((option) => option.value === selectedDevice)
  const presentationDeviceOption = deviceOptions.find((option) => option.value === presentationDevice)
  const paidPlan =
    chatMeta?.payment?.status === 'paid' && chatMeta.payment.plan && chatMeta.payment.plan !== 'plugin'
      ? chatMeta.payment.plan
      : chatMeta?.subscription?.status === 'active' && chatMeta.subscription.plan
        ? chatMeta.subscription.plan
        : ''
  const visibleMessages = arrangeMessagesWithSimulatedAudio(
    messages,
    presentationDeviceOption?.value,
    visibleSequenceItems,
    chatMeta,
    introAudioKey,
  )
  const isComposerLocked = Boolean(selectedDevice && visibleSequenceItems < fullPresentationStep)
  const isAccountBlocked = blockedAccess || isAccountAccessBlocked(chatMeta)

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
        setActivePaymentLinks(payload.links || getPaymentLinks(provider))
        setActivePluginPaymentLink(payload.pluginLink || getPluginPaymentLink(provider))
      } catch {
        if (active) {
          setPaymentProvider('perfect-pay')
          setActivePaymentLinks(getPaymentLinks('perfect-pay'))
          setActivePluginPaymentLink(getPluginPaymentLink('perfect-pay'))
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
        setBlockedAccess(false)

        const storedChatId = getStoredChatId() || ''
        const storedDevice = storedChatId ? getStoredDevice(storedChatId) : ''
        setChatId(storedChatId)
        setAccountId(getStoredAccountId() || getStoredUsername().trim().toLowerCase())
        setSelectedDevice(storedDevice)
        setPresentationDevice(storedDevice)
        setSelectedPlan(storedChatId ? getStoredPlan(storedChatId) : '')
        setIntroAudioKey(storedChatId ? getStoredIntroAudioKey(storedChatId) : 'start')
        if (storedDevice) {
          setVisibleSequenceItems(fullPresentationStep)
        } else if (storedChatId && getStoredIntroReady(storedChatId)) {
          setVisibleSequenceItems(devicePromptStep)
        }
        setLoading(false)
      } catch (bootError) {
        const firebaseError = bootError as { code?: string }
        const errorCode = firebaseError.code ? ` (${firebaseError.code})` : ''
        console.error('Erro ao iniciar chat:', bootError)
        setError(
          `Nao foi possivel iniciar o chat${errorCode}. Ative login anonimo no Firebase Auth e confira as regras do Firestore.`,
        )
        setLoading(false)
      }
    }

    boot()
  }, [])

  useEffect(() => {
    if (!chatId || !chatMeta || isAccountAccessBlocked(chatMeta)) {
      setMessages([])
      return undefined
    }

    return listenMessages(chatId, setMessages)
  }, [chatId, chatMeta])

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
        setMessages([])
        return
      }
      storeAccountBlocked(false)
      setBlockedAccess(false)
      if (chat?.introAudioKey) {
        setIntroAudioKey(chat.introAudioKey)
        storeIntroAudioKey(chatId, chat.introAudioKey)
      }
    })
  }, [chatId])

  useEffect(() => {
    if (!composerToast) return undefined

    const timer = window.setTimeout(() => setComposerToast(''), 4500)
    return () => window.clearTimeout(timer)
  }, [composerToast])

  useEffect(() => {
    if (!chatId) return undefined

    const timers: number[] = []
    let pauseTimer: number | null = null

    function scheduleStep(step: number, delay: number) {
      timers.push(window.setTimeout(() => setVisibleSequenceItems((current) => Math.max(current, step)), delay))
    }

    function clearPauseTimer() {
      if (pauseTimer !== null) {
        window.clearTimeout(pauseTimer)
        pauseTimer = null
      }
    }

    function revealDevicePrompt() {
      setVisibleSequenceItems((current) => Math.max(current, 3))
      storeIntroReady(chatId)
      clearPauseTimer()
      window.removeEventListener('chat-audio-ended', revealDevicePromptAfterAudio)
    }

    function revealDevicePromptAfterAudio(event: Event) {
      const previousId = (event as CustomEvent<string>).detail
      if (previousId === 'simulated-audio-start') revealDevicePrompt()
    }

    let followupAfterFeaturesScheduled = false

    function scheduleFollowupAfterFeatures() {
      if (followupAfterFeaturesScheduled) return
      followupAfterFeaturesScheduled = true
      scheduleStep(7, 2500)
      scheduleStep(8, 4300)
      scheduleStep(9, 10300)
    }

    function revealFeatureMessage() {
      setVisibleSequenceItems((current) => Math.max(current, 6))
      window.removeEventListener('simulated-audio-device-half', revealFeatureMessage)
      scheduleFollowupAfterFeatures()
    }

    function revealFourthAudio() {
      setVisibleSequenceItems((current) => Math.max(current, 10))
      window.removeEventListener('simulated-audio-penultimate-half', revealFourthAudio)
      scheduleStep(11, 2200)
    }

    function revealNextAfterPause(event: Event) {
      clearPauseTimer()
      const audioId = (event as CustomEvent<string>).detail
      pauseTimer = window.setTimeout(() => {
        if (!presentationDevice && audioId === 'simulated-audio-start') {
          revealDevicePrompt()
          return
        }

      }, 15000)
    }

    function cancelRevealOnAudioResumed() {
      clearPauseTimer()
    }

    setVisibleSequenceItems((current) => Math.max(current, presentationDevice ? devicePromptStep : 1))

    if (presentationDevice) {
      scheduleStep(4, 2200)
      scheduleStep(5, 4400)
      scheduleStep(6, 19400)
      timers.push(window.setTimeout(scheduleFollowupAfterFeatures, 19400))
      window.addEventListener('simulated-audio-device-half', revealFeatureMessage)
      window.addEventListener('simulated-audio-penultimate-half', revealFourthAudio)
    } else {
      scheduleStep(2, 1800)
      timers.push(window.setTimeout(revealDevicePrompt, 15000))
      window.addEventListener('chat-audio-ended', revealDevicePromptAfterAudio)
    }

    window.addEventListener('chat-audio-paused', revealNextAfterPause)
    window.addEventListener('chat-audio-play', cancelRevealOnAudioResumed)

    return () => {
      window.removeEventListener('chat-audio-ended', revealDevicePromptAfterAudio)
      window.removeEventListener('simulated-audio-device-half', revealFeatureMessage)
      window.removeEventListener('simulated-audio-penultimate-half', revealFourthAudio)
      window.removeEventListener('chat-audio-paused', revealNextAfterPause)
      window.removeEventListener('chat-audio-play', cancelRevealOnAudioResumed)
      timers.forEach((timer) => window.clearTimeout(timer))
      clearPauseTimer()
    }
  }, [chatId, presentationDevice])

  async function handleLogin(
    usernameValue: string,
    passwordValue: string,
    isSignup: boolean,
  ): Promise<AuthSubmitResult> {
    const username = usernameValue.trim()
    const password = passwordValue.trim()

    setError('')
    setAccessLoading(true)

    try {
      if (!isSignup && username.includes('@')) {
        await signInAdmin(username, password)
        storeAccountBlocked(false)
        window.location.assign('/admin')
        return undefined
      }

      const access = await requestChatAccess({
        username,
        password,
        mode: isSignup ? 'signup' : 'login',
        clientId: getClientId(),
        requestedChatId: getStoredChatId() || makeId('chat'),
      })

      setBlockedAccess(false)
      storeChatId(access.chatId)
      storeAccountId(access.accountId)
      storeUsername(access.accessUsername)
      storeIntroAudioKey(access.chatId, access.introAudioKey)
      setChatId(access.chatId)
      setAccountId(access.accountId)
      setIntroAudioKey(access.introAudioKey)
      const recoveredDevice = access.profile.device || getStoredDevice(access.chatId)
      const recoveredPlan = access.profile.plan || getStoredPlan(access.chatId)

      if (recoveredDevice) storeDevice(access.chatId, recoveredDevice)
      if (recoveredPlan) storePlan(access.chatId, recoveredPlan)

      setSelectedDevice(recoveredDevice)
      setPresentationDevice(recoveredDevice)
      setSelectedPlan(recoveredPlan)
      setVisibleSequenceItems(
        recoveredDevice
          ? fullPresentationStep
          : getStoredIntroReady(access.chatId)
            ? devicePromptStep
            : 1,
      )
    } catch (accessError) {
      const message = accessError instanceof Error ? accessError.message : 'Acesso inválido.'
      if (accessError instanceof ChatAccessError && accessError.code === 'account_exists') {
        return { message, switchTo: 'login' }
      }
      if (accessError instanceof ChatAccessError && accessError.code === 'account_not_found') {
        return { message, switchTo: 'signup' }
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

  async function sendClientMessage(message: string) {
    if (!chatId) return
    await addMessage(chatId, 'client', message)
    if (accountId) {
      await registerClientActivity({
        chatId,
        accountId,
        type: 'message_sent',
        key: 'message_sent',
        label: 'Enviou mensagem no chat',
        meta: {
          length: message.trim().length,
        },
      }).catch((activityError) => {
        console.error('Nao foi possivel registrar mensagem do cliente:', activityError)
      })
    }
  }

  function handleLockedComposerAttempt() {
    setComposerToast('Veja rapidinho as instrucoes finais para eu te orientar melhor antes de responder.')
  }

  const handleAudioActivity = useCallback(
    async (activity: {
      type: 'audio_started' | 'audio_half' | 'audio_completed'
      key: string
      label: string
      meta: Record<string, string | number | boolean | null>
    }) => {
      if (!chatId || !accountId) return

      try {
        await registerClientActivity({
          chatId,
          accountId,
          ...activity,
        })
      } catch (activityError) {
        console.error('Nao foi possivel registrar audio:', activityError)
      }
    },
    [accountId, chatId],
  )

  async function handleDeviceSelect(device: DeviceType) {
    if (!chatId || !accountId || savingDevice) return
    if (selectedDevice) {
      return
    }

    setSavingDevice(true)
    setError('')

    try {
      await saveDeviceSelection({
        chatId,
        accountId,
        device,
      })
      storeDevice(chatId, device)
      storeIntroReady(chatId)
      setSelectedDevice(device)
      setPresentationDevice(device)
      setVisibleSequenceItems(devicePromptStep)
    } catch (deviceError) {
      setError(
        deviceError instanceof Error ? deviceError.message : 'Nao foi possivel salvar sua escolha.',
      )
    } finally {
      setSavingDevice(false)
    }
  }

  async function handlePlanSelect(plan: PlanType) {
    if (!chatId || !accountId || savingPlan) return

    setSavingPlan(true)
    setError('')

    try {
      await savePlanSelection({
        chatId,
        accountId,
        plan,
      })
      storePlan(chatId, plan)
      setSelectedPlan(plan)
      const selectedOption = planOptions.find((option) => option.value === plan)
      if (selectedOption) {
        await addMessage(chatId, 'client', `Escolhi o plano ${selectedOption.label}.`)
      }
    } catch (planError) {
      setError(planError instanceof Error ? planError.message : 'Nao foi possivel salvar o plano.')
    } finally {
      setSavingPlan(false)
    }
  }

  async function handlePaymentClick({
    plan,
    link,
    label,
    provider,
  }: {
    plan?: PaymentTarget
    link: string
    label: string
    provider?: PaymentProvider
  }) {
    if (!chatId || !accountId || openingPayment) return

    setOpeningPayment(true)
    setError('')

    let paymentWindow: Window | null = null

    try {
      const previousPlan = selectedPlan
      const providerForClick = provider || paymentProvider
      const trackedPaymentLink = addPaymentTrackingToLink(link, chatId, plan, providerForClick)

      paymentWindow = window.open('', '_blank')
      if (paymentWindow) {
        try {
          paymentWindow.opener = null
          paymentWindow.document.title = 'Abrindo pagamento'
          paymentWindow.document.body.innerHTML =
            '<main style="min-height:100vh;display:grid;place-items:center;background:#09090b;color:#fff;font-family:Arial,sans-serif;text-align:center"><div><div style="width:44px;height:44px;border:4px solid rgba(255,255,255,.2);border-top-color:#22c55e;border-radius:999px;margin:0 auto 16px;animation:spin .8s linear infinite"></div><strong>Aguarde...</strong><p style="color:#cbd5e1;margin:8px 0 0">Levando voce ate a pagina de pagamento.</p><style>@keyframes spin{to{transform:rotate(360deg)}}</style></div></main>'
        } catch {
          // Some browsers restrict writing into the temporary payment tab.
        }
      }

      await registerPaymentClick({
        chatId,
        accountId,
        plan,
        paymentLink: trackedPaymentLink,
        paymentLabel: label,
        paymentProvider: providerForClick,
      })

      if (plan && plan !== 'plugin') {
        storePlan(chatId, plan)
        setSelectedPlan(plan)
      }

      if (paymentWindow && !paymentWindow.closed) {
        paymentWindow.location.replace(trackedPaymentLink)
      } else {
        window.location.assign(trackedPaymentLink)
      }

      if (plan && plan !== 'plugin' && previousPlan !== plan) {
        const selectedOption = planOptions.find((option) => option.value === plan)
        if (selectedOption) {
          addMessage(chatId, 'client', `Escolhi o plano ${selectedOption.label}.`).catch((messageError) => {
            console.error('Nao foi possivel registrar escolha do plano:', messageError)
          })
        }
      }
    } catch (paymentError) {
      if (paymentWindow && !paymentWindow.closed) {
        paymentWindow.close()
      }
      setError(
        paymentError instanceof Error
          ? paymentError.message
          : 'Nao foi possivel abrir o pagamento.',
      )
    } finally {
      setOpeningPayment(false)
    }
  }

  async function handleButtonClick({
    messageId,
    buttonKey,
    buttonLabel,
  }: {
    messageId: string
    buttonKey: string
    buttonLabel: string
  }) {
    if (!chatId || !accountId) return

    try {
      await registerClientButtonClick({
        chatId,
        accountId,
        messageId,
        buttonKey,
        buttonLabel,
      })
    } catch (clickError) {
      console.error('Nao foi possivel registrar clique:', clickError)
    }
  }

  async function handleLogout() {
    setError('')
    setOpeningPayment(false)
    setComposerToast('')
    clearClientSession()
    storeAccountBlocked(false)
    setBlockedAccess(false)
    setChatId('')
    setAccountId('')
    setChatMeta(null)
    setMessages([])
    setSelectedDevice('')
    setPresentationDevice('')
    setSelectedPlan('')
    setIntroAudioKey('start')
    setVisibleSequenceItems(1)

    try {
      await signOut(auth)
    } catch (logoutError) {
      console.error('Nao foi possivel sair da conta:', logoutError)
    }
  }

  if (isAccountBlocked) {
    return <NotFoundAccess />
  }

  if (loading) {
    return <main className="client-page" aria-hidden="true" />
  }

  if (!chatId) {
    return (
      <AuthScreen
        defaultUsername={getStoredUsername()}
        loading={accessLoading}
        error={error}
        onSubmit={handleLogin}
      />
    )
  }

  return (
    <main className="client-page">
      <section className="chat-panel" aria-label="Gordin du Xit">
        <header className="chat-header">
          <div className="client-header-profile">
            <img
              className="client-header-avatar"
              src="/gordin-avatar.png"
              alt="Gordin du Xit"
              width={48}
              height={48}
            />
            <div className="client-header-title">
              <span>DA TROPA DO GORDIN</span>
              <h1>Gordin du Xit</h1>
            </div>
          </div>
          <div className="client-header-actions">
            {selectedDeviceOption && (
              <span className="device-chip">
                <DeviceIcon icon={selectedDeviceOption.icon} />
                {selectedDeviceOption.label}
              </span>
            )}
            <strong className="online-pill"><span aria-hidden="true" />Online</strong>
            <button type="button" className="client-logout-button" onClick={handleLogout}>
              Sair
            </button>
          </div>
        </header>

        {composerToast && (
          <div className="composer-toast" role="status" aria-live="polite">
            {composerToast}
          </div>
        )}

        {openingPayment && (
          <div className="payment-loading-overlay" role="status" aria-live="assertive">
            <div className="payment-loading-card">
              <span className="payment-loading-spinner" aria-hidden="true" />
              <strong>Aguarde, te levando ate a pagina de pagamento</strong>
            </div>
          </div>
        )}

        {error ? (
          <div className="state-message">{error}</div>
        ) : (
          <>
            <ChatMessages
              messages={visibleMessages}
              perspective="client"
              selectedPlan={selectedPlan}
              savingPlan={savingPlan || openingPayment}
              paymentLinks={activePaymentLinks}
              pluginPaymentLink={activePluginPaymentLink}
              paymentProvider={paymentProvider}
              selectedDevice={(selectedDevice || chatMeta?.leadProfile?.device || '') as DeviceType | ''}
              paidPlan={paidPlan}
              onPlanSelect={handlePlanSelect}
              onPaymentClick={handlePaymentClick}
              onButtonClick={handleButtonClick}
              onAudioActivity={handleAudioActivity}
              pluginIncluded={chatMeta?.plugin?.included !== false}
              devicePrompt={
                <DevicePrompt
                  selectedDevice={selectedDevice}
                  savingDevice={savingDevice}
                  locked={Boolean(selectedDevice)}
                  onSelect={handleDeviceSelect}
                />
              }
            >
            </ChatMessages>
            {selectedDevice && (
              <div className="composer-blocker">
                <MessageComposer
                  canSend={!isComposerLocked}
                  placeholder="Digite sua mensagem"
                  onSend={sendClientMessage}
                  onBlockedSend={handleLockedComposerAttempt}
                />
              </div>
            )}
          </>
        )}
      </section>
    </main>
  )
}
