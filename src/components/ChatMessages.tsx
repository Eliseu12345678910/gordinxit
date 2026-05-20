'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { paymentLinks as defaultPaymentLinks, planOptions } from '@/lib/chat'
import { audioFiles } from '@/lib/audio'
import { getSecureItem, setSecureItem } from '@/lib/secure-storage'
import type { ChatMessage, PlanType, PaymentTarget, AudioKey, ClientActivityType, PaymentProvider, DeviceType } from '@/types/chat'

function formatTime(message: ChatMessage) {
  const date = message.createdAt?.toDate?.()
  if (!date) return ''

  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function formatClickTime(click?: { lastAt?: ChatMessage['createdAt'] }) {
  const date = click?.lastAt?.toDate?.()
  if (!date) return ''
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function getButtonClickInfo(message: ChatMessage, buttonKey: string) {
  const click = message.buttonClicks?.[buttonKey]
  const count = click?.count || 0
  if (!count) return null

  return {
    count,
    time: formatClickTime(click),
  }
}

function ClientClickBadge({
  message,
  buttonKey,
  perspective,
}: {
  message: ChatMessage
  buttonKey: string
  perspective: 'client' | 'admin'
}) {
  if (perspective !== 'admin') return null

  const click = getButtonClickInfo(message, buttonKey)
  if (!click) return null

  return (
    <span className="client-click-badge">
      Cliente clicou {click.count}x{click.time ? ` as ${click.time}` : ''}
    </span>
  )
}

function MessageIcon({ sender }: { sender: 'client' | 'admin' | 'bot' }) {
  return <span className={`message-icon ${sender}`} aria-hidden="true" />
}

function formatAudioTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'

  const minutes = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

const waveformBars = [
  22, 31, 35, 38, 42, 45, 46, 44, 40, 36, 31, 28, 34, 42, 48, 46, 38, 30, 24, 29, 36, 41, 39,
  33, 28, 35, 43, 47, 44, 37, 30, 27, 34, 42, 49, 52, 50, 44, 37, 31, 35, 42, 47, 45, 38,
]
const waveformBarWidth = 3
const waveformBarGap = 3.5
const audioPlayerFixedWidth = 134
type PlaybackRate = 1 | 1.5

const simulatedAudioNext: Record<string, string> = {
  'simulated-audio-start': 'simulated-audio-device',
  'simulated-audio-device': 'simulated-audio-penultimate',
  'simulated-audio-penultimate': 'simulated-audio-latest',
}

const audioVisuals: Record<AudioKey, { fallbackSeconds: number }> = {
  start: { fallbackSeconds: 10 },
  'start-live': { fallbackSeconds: 10 },
  'second-android': { fallbackSeconds: 13 },
  'second-ios': { fallbackSeconds: 13 },
  'second-emulator': { fallbackSeconds: 13 },
  penultimate: { fallbackSeconds: 8 },
  'latest-android': { fallbackSeconds: 9 },
  'latest-ios': { fallbackSeconds: 9 },
  'latest-emulator': { fallbackSeconds: 9 },
}

function getAudioCompleteKey(messageId: string, audioKey?: AudioKey) {
  if (audioKey === 'start-live') return `chat-audio-complete-v2-${messageId}-${audioKey}`
  return `chat-audio-complete-v2-${messageId}`
}

function shouldDispatchHalfEvent(messageId: string) {
  return (
    messageId === 'simulated-audio-start' ||
    messageId === 'simulated-audio-device' ||
    messageId === 'simulated-audio-penultimate'
  )
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function getAudioWidth(seconds: number) {
  return Math.round(clampNumber(232 + seconds * 11, 252, 430))
}

function getWaveformPointCount(seconds: number, availableWidth?: number) {
  const durationCount = Math.round(clampNumber(22 + seconds * 1.8, 24, waveformBars.length))

  if (!availableWidth || availableWidth <= 0) return durationCount

  const availableCount = Math.floor((availableWidth + waveformBarGap) / (waveformBarWidth + waveformBarGap))
  return Math.round(clampNumber(Math.min(durationCount, availableCount), 1, waveformBars.length))
}

function AudioMessagePlayer({
  messageId,
  audioKey,
  label,
  sentTime,
  autoPlayRequested,
  onAudioEnded,
  onAutoPlayHandled,
  onAudioActivity,
}: {
  messageId: string
  audioKey: AudioKey
  label: string
  sentTime: string
  autoPlayRequested?: boolean
  onAudioEnded?: (messageId: string) => void
  onAutoPlayHandled?: (messageId: string) => void
  onAudioActivity?: (activity: {
    type: Extract<ClientActivityType, 'audio_started' | 'audio_half' | 'audio_completed'>
    key: string
    label: string
    meta: Record<string, string | number | boolean | null>
  }) => void
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const halfDispatchedRef = useRef(false)
  const labelRef = useRef(label)
  const onAudioActivityRef = useRef(onAudioActivity)
  const onAudioEndedRef = useRef(onAudioEnded)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [waveformWidth, setWaveformWidth] = useState(0)
  const [playbackRate, setPlaybackRate] = useState<PlaybackRate>(1)

  useEffect(() => {
    labelRef.current = label
  }, [label])

  useEffect(() => {
    onAudioActivityRef.current = onAudioActivity
  }, [onAudioActivity])

  useEffect(() => {
    onAudioEndedRef.current = onAudioEnded
  }, [onAudioEnded])

  useEffect(() => {
    setIsComplete(getSecureItem(getAudioCompleteKey(messageId, audioKey)) === 'true')
  }, [audioKey, messageId])

  useEffect(() => {
    halfDispatchedRef.current = false
    const audio = new Audio(audioFiles[audioKey])
    audio.preload = 'metadata'
    audio.playbackRate = playbackRate
    audioRef.current = audio

    function syncTime() {
      setCurrentTime(audio.currentTime)
      if (
        shouldDispatchHalfEvent(messageId) &&
        !halfDispatchedRef.current &&
        Number.isFinite(audio.duration) &&
        audio.duration > 0 &&
        audio.currentTime / audio.duration >= 0.5
      ) {
        halfDispatchedRef.current = true
        onAudioActivityRef.current?.({
          type: 'audio_half',
          key: `audio_half_${messageId}`,
          label: `Ouviu metade de ${labelRef.current}`,
          meta: {
            messageId,
            audioKey,
            currentTime: Math.round(audio.currentTime),
          },
        })
        window.dispatchEvent(new CustomEvent(`${messageId}-half`))
      }
    }

    function syncDuration() {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
    }

    function handlePlay() {
      window.dispatchEvent(new CustomEvent('chat-audio-play', { detail: messageId }))
      onAudioActivityRef.current?.({
        type: 'audio_started',
        key: `audio_started_${messageId}`,
        label: `Tocou ${labelRef.current}`,
        meta: {
          messageId,
          audioKey,
        },
      })
      setIsPlaying(true)
    }

    function handlePause() {
      setIsPlaying(false)
      if (audio.ended) return
      window.dispatchEvent(new CustomEvent('chat-audio-paused', { detail: messageId }))
    }

    function handleEnded() {
      const endedAt = Number.isFinite(audio.duration) ? audio.duration : 0
      setIsPlaying(false)
      setIsComplete(true)
      setSecureItem(getAudioCompleteKey(messageId, audioKey), 'true')
      setCurrentTime(endedAt)
      if (
        shouldDispatchHalfEvent(messageId) &&
        !halfDispatchedRef.current
      ) {
        halfDispatchedRef.current = true
        onAudioActivityRef.current?.({
          type: 'audio_half',
          key: `audio_half_${messageId}`,
          label: `Ouviu metade de ${labelRef.current}`,
          meta: {
            messageId,
            audioKey,
            currentTime: Math.round(endedAt),
          },
        })
        window.dispatchEvent(new CustomEvent(`${messageId}-half`))
      }
      onAudioActivityRef.current?.({
        type: 'audio_completed',
        key: `audio_completed_${messageId}`,
        label: `Terminou ${labelRef.current}`,
        meta: {
          messageId,
          audioKey,
          duration: Math.round(endedAt),
        },
      })
      onAudioEndedRef.current?.(messageId)
      window.dispatchEvent(new CustomEvent('chat-audio-ended', { detail: messageId }))
    }

    function pauseWhenOtherPlays(event: Event) {
      const nextId = (event as CustomEvent<string>).detail
      if (nextId !== messageId) audio.pause()
    }

    audio.addEventListener('timeupdate', syncTime)
    audio.addEventListener('loadedmetadata', syncDuration)
    audio.addEventListener('durationchange', syncDuration)
    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('ended', handleEnded)
    window.addEventListener('chat-audio-play', pauseWhenOtherPlays)

    return () => {
      audio.removeEventListener('timeupdate', syncTime)
      audio.removeEventListener('loadedmetadata', syncDuration)
      audio.removeEventListener('durationchange', syncDuration)
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('ended', handleEnded)
      window.removeEventListener('chat-audio-play', pauseWhenOtherPlays)
      audio.pause()
      audioRef.current = null
    }
  }, [audioKey, messageId])

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate
  }, [playbackRate])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !autoPlayRequested) return

    audio.currentTime = 0
    setCurrentTime(0)
    audio.load()
    audio.play().catch(() => setIsPlaying(false))
    onAutoPlayHandled?.(messageId)
  }, [autoPlayRequested, messageId, onAutoPlayHandled])

  useEffect(() => {
    const track = trackRef.current
    if (!track) return

    const updateWaveformWidth = () => {
      setWaveformWidth(track.clientWidth)
    }

    updateWaveformWidth()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWaveformWidth)
      return () => window.removeEventListener('resize', updateWaveformWidth)
    }

    const observer = new ResizeObserver((entries) => {
      setWaveformWidth(entries[0]?.contentRect.width || track.clientWidth)
    })

    observer.observe(track)
    return () => observer.disconnect()
  }, [])

  function toggleAudio() {
    const audio = audioRef.current
    if (!audio) return

    if (!audio.paused && !audio.ended) {
      audio.pause()
      return
    }

    const hasKnownDuration = Number.isFinite(audio.duration) && audio.duration > 0
    if (audio.ended || (hasKnownDuration && audio.currentTime >= audio.duration - 0.05)) {
      audio.currentTime = 0
      setCurrentTime(0)
    }

    if (audio.readyState === 0) audio.load()
    setCurrentTime(audio.currentTime)
    audio.play().catch(() => setIsPlaying(false))
  }

  function seekTo(value: string) {
    const audio = audioRef.current
    if (!audio) return

    const nextTime = Number(value)
    audio.currentTime = nextTime
    setCurrentTime(nextTime)
    if (
      shouldDispatchHalfEvent(messageId) &&
      !halfDispatchedRef.current &&
      Number.isFinite(audio.duration) &&
      audio.duration > 0 &&
      nextTime / audio.duration >= 0.5
    ) {
      halfDispatchedRef.current = true
      onAudioActivityRef.current?.({
        type: 'audio_half',
        key: `audio_half_${messageId}`,
        label: `Ouviu metade de ${labelRef.current}`,
        meta: {
          messageId,
          audioKey,
          currentTime: Math.round(nextTime),
        },
      })
      window.dispatchEvent(new CustomEvent(`${messageId}-half`))
    }
  }

  function togglePlaybackRate() {
    setPlaybackRate((current) => (current === 1 ? 1.5 : 1))
  }

  const progress = duration ? clampNumber((currentTime / duration) * 100, 0, 100) : 0
  const displayedProgress = currentTime > 0 ? progress : 0
  const visual = audioVisuals[audioKey]
  const visualSeconds = duration || visual.fallbackSeconds
  const audioDisplaySeconds = currentTime > 0 || isPlaying ? currentTime : visualSeconds
  const audioPixelWidth = getAudioWidth(visualSeconds)
  const audioWidth = `${audioPixelWidth}px`
  const estimatedWaveformWidth = Math.max(audioPixelWidth - audioPlayerFixedWidth, 0)
  const availableWaveformWidth = waveformWidth || estimatedWaveformWidth
  const visibleWaveformBars = waveformBars.slice(0, getWaveformPointCount(visualSeconds, availableWaveformWidth))
  const statusClass = isComplete ? 'complete' : 'needs-attention'

  return (
    <div
      className={`whatsapp-audio-player ${isPlaying ? 'playing' : 'paused'} ${statusClass}`}
      style={{ '--audio-width': audioWidth } as CSSProperties}
    >
      <button
        type="button"
        className="audio-play-button"
        onClick={toggleAudio}
        aria-label={isPlaying ? 'Pausar audio' : 'Tocar audio'}
      >
        <span className={`audio-control-icon ${isPlaying ? 'pause' : 'play'}`} />
      </button>
      <div ref={trackRef} className="audio-track-area">
        <span className="sr-only">{label}</span>
        <div className="audio-waveform" aria-hidden="true">
          {visibleWaveformBars.map((height, index) => (
            <span
              key={`${audioKey}-${index}`}
              className={
                displayedProgress > 0 &&
                index <= (visibleWaveformBars.length - 1) * (displayedProgress / 100)
                  ? 'played'
                  : ''
              }
              style={{ height: `${height}%` }}
            />
          ))}
        </div>
        <input
          className="audio-seekbar"
          type="range"
          min="0"
          max={duration || 0}
          step="0.01"
          value={duration ? currentTime : 0}
          onChange={(event) => seekTo(event.target.value)}
          style={{ '--audio-progress': `${displayedProgress}%` } as CSSProperties}
          aria-label="Avancar ou voltar audio"
        />
        <div className="audio-time-row" aria-hidden="true">
          <span>{formatAudioTime(audioDisplaySeconds)}</span>
        </div>
      </div>
      <div className="audio-meta">
        {!isComplete && <span className="audio-attention" aria-label="Audio ainda nao ouvido ate o fim" />}
        <button
          type="button"
          className="audio-speed-button"
          onClick={togglePlaybackRate}
          aria-label={`Velocidade do audio ${playbackRate.toFixed(1)}x`}
        >
          {playbackRate.toFixed(1)}x
        </button>
        <time>{sentTime}</time>
      </div>
    </div>
  )
}

const showcaseSections = [
  {
    title: 'Protecao',
    items: [
      'Ant-ban',
      'Ant-blacklist',
      'Protecao de conta',
    ],
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
    items: [
      'Max Distance',
      'Visible Check',
      'Filled Color',
      'Show Fov',
      'Fov Color',
    ],
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

const commonPlanFeatures = [
  'Aimbot inteligente',
  'Auxilio de movimentacao',
  'ESP name e distancia',
  'Ant-ban e ant-blacklist',
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

const gamePlanVisuals: Record<
  PlanType,
  { displayName: string; tag: string; icon: string; theme: string }
> = {
  weekly: {
    displayName: 'Semanal',
    tag: 'Entrada rapida',
    icon: '7D',
    theme: 'ffp-weekly',
  },
  monthly: {
    displayName: 'Mensal',
    tag: 'Mais escolhido',
    icon: 'VIP',
    theme: 'ffp-monthly',
  },
  lifetime: {
    displayName: 'Permanente',
    tag: 'Melhor valor',
    icon: 'MAX',
    theme: 'ffp-lifetime',
  },
}

const gameTrustItems = ['Ant-ban', 'Ant-blacklist', 'Suporte', 'Atualizacoes']

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

  if (selectedDevice === 'ios' && paidPlan !== 'lifetime') {
    const shouldWarnWeekly = plan === 'weekly'
    const shouldWarnMonthlyAfterPurchase = plan === 'monthly' && paidPlan === 'monthly'
    const hasPaidPlan = paidPlan === 'weekly' || paidPlan === 'monthly'

    if (shouldWarnWeekly || shouldWarnMonthlyAfterPurchase) {
      items.splice(4, 0, {
        label: 'Este plano nao funciona para iOS',
        detail: hasPaidPlan
          ? 'Para esta conta iOS, o plano Permanente e o unico que libera o uso completo. Adquira o Permanente e fale no chat para receber o reembolso do plano anterior.'
          : plan === 'weekly'
            ? 'Para iOS, escolha Mensal ou Permanente antes de pagar.'
            : 'Para iOS, use o plano Permanente para liberar tudo sem erro.',
        tone: 'negative',
      })
    }
  }

  return items
}

const planDealMap: Record<
  PlanType,
  { duration: string; discount: string; note: string; realPrice: string }
> = {
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

const planSocialStats: Record<PlanType, { boughtToday: string; activeUsers: string }> = {
  weekly: {
    boughtToday: '38',
    activeUsers: '214',
  },
  monthly: {
    boughtToday: '96',
    activeUsers: '587',
  },
  lifetime: {
    boughtToday: '22',
    activeUsers: '143',
  },
}

const recentPurchaseProofs = [
  { name: 'Lucas', plan: 'Mensal' },
  { name: 'Matheus', plan: 'Semanal' },
  { name: 'Rafael', plan: 'Mensal' },
  { name: 'Gustavo', plan: 'Permanente' },
  { name: 'Pedro', plan: 'Mensal' },
  { name: 'Joao', plan: 'Semanal' },
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

const pluginDiagnosticBenefits = [
  'Todas as funções do xit liberadas',
  'Execução completa sem erro de sincronização',
  'Conta pronta para jogar após a confirmação',
  'Plano convertido de Semanal -> Permanente',
  'Uso vitalício com atualizações gratuitas',
]

export function ChatMessages({
  messages,
  perspective,
  children,
  devicePrompt,
  selectedPlan,
  savingPlan,
  onPlanSelect,
  onPaymentClick,
  onButtonClick,
  onEditMessage,
  onDeleteMessage,
  onAudioActivity,
  pluginIncluded,
  paymentLinks,
  pluginPaymentLink,
  paymentProvider,
  selectedDevice,
  paidPlan,
}: {
  messages: ChatMessage[]
  perspective: 'client' | 'admin'
  children?: ReactNode
  devicePrompt?: ReactNode
  selectedPlan?: string
  savingPlan?: boolean
  paymentLinks?: Record<PlanType, string>
  pluginPaymentLink?: string
  paymentProvider?: PaymentProvider
  selectedDevice?: DeviceType | ''
  paidPlan?: PlanType | ''
  onPlanSelect?: (plan: PlanType) => void
  onPaymentClick?: (payment: { plan?: PaymentTarget; link: string; label: string; provider?: PaymentProvider }) => void
  onButtonClick?: (click: { messageId: string; buttonKey: string; buttonLabel: string }) => void
  onEditMessage?: (messageId: string, text: string) => Promise<void> | void
  onDeleteMessage?: (messageId: string) => Promise<void> | void
  onAudioActivity?: (activity: {
    type: Extract<ClientActivityType, 'audio_started' | 'audio_half' | 'audio_completed'>
    key: string
    label: string
    meta: Record<string, string | number | boolean | null>
  }) => void
  pluginIncluded?: boolean
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [showAllSource, setShowAllSource] = useState<'plans' | 'showcase' | null>(null)
  const [openPlansMessageId, setOpenPlansMessageId] = useState<string | null>(null)
  const [openPluginMessageId, setOpenPluginMessageId] = useState<string | null>(null)
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null)
  const [editingText, setEditingText] = useState('')
  const [messageActionBusyId, setMessageActionBusyId] = useState<string | null>(null)
  const [messageActionError, setMessageActionError] = useState('')
  const [autoPlayMessageId, setAutoPlayMessageId] = useState<string | null>(null)
  const [recentPurchaseIndex, setRecentPurchaseIndex] = useState(0)
  const messageSignature = useMemo(
    () => messages.map((message) => `${message.id}:${message.createdAt?.seconds || ''}`).join('|'),
    [messages],
  )

  const handleAudioEnded = useCallback((messageId: string) => {
    const nextId = simulatedAudioNext[messageId]
    if (nextId) setAutoPlayMessageId(nextId)
  }, [])

  const handleAutoPlayHandled = useCallback((messageId: string) => {
    setAutoPlayMessageId((current) => (current === messageId ? null : current))
  }, [])

  const allFeatures = showcaseSections.flatMap((section) =>
    section.items.map((item) => ({ section: section.title, item })),
  )
  const topFeatures = allFeatures.slice(0, 10)
  const recentPurchase = recentPurchaseProofs[recentPurchaseIndex % recentPurchaseProofs.length]
  const activePaymentLinks = paymentLinks || defaultPaymentLinks
  const activePluginPaymentLink = pluginPaymentLink || ''

  const renderPluginPurchaseModal = useCallback(
    (message: ChatMessage, pluginLink: string) => {
      if (openPluginMessageId !== message.id) return null

      return (
        <div className="plugin-fullscreen" role="dialog" aria-modal="true" aria-label="Plugin ServiceSync Core">
          <section className="plugin-sheet">
            <header className="plugin-sheet-head">
              <div>
                <span>Ativacao final</span>
                <h3>ServiceSync Core</h3>
                <small>6 de 7 modulos validados</small>
              </div>
              <button type="button" onClick={() => setOpenPluginMessageId(null)} aria-label="Fechar plugin">
                X
              </button>
            </header>

            <div className="plugin-hero-copy">
              <div className="plugin-progress-head">
                <span>Semanal -&gt; Permanente</span>
                <strong>quase pronto</strong>
              </div>
              <div className="plugin-progress-bar" aria-hidden="true">
                <i />
              </div>
              <h4>Sua conta esta a 1 modulo de liberar tudo.</h4>
              <p>
                O ServiceSync Core finaliza a sincronizacao tecnica da conta. Depois da confirmacao,
                todas as funcoes do xit ficam liberadas, o acesso vira permanente e voce ja consegue jogar.
              </p>
            </div>

            <div className="plugin-activation-strip" aria-label="Resultado da ativacao">
              <span>
                <b>✓</b>
                Todas as funcoes
              </span>
              <span>
                <b>✓</b>
                Pronto para jogar
              </span>
              <span>
                <b>✓</b>
                Uso vitalicio
              </span>
            </div>

            <div className="plugin-pending-card" aria-label="Modulo pendente">
              <b aria-hidden="true">×</b>
              <div>
                <span>Modulo pendente</span>
                <strong>ServiceSync Core</strong>
                <p>Responsavel por fechar a ativacao, liberar todas as funcoes e evitar erro de sincronizacao ao abrir o xit.</p>
              </div>
            </div>

            <div className="plugin-module-section" aria-label="Plugins verificados">
              <span>Ja validado no painel</span>
              <div className="plugin-module-grid">
                {pluginModules
                  .filter((plugin) => plugin !== 'ServiceSync Core')
                  .map((plugin, index) => (
                    <span key={plugin} className="ready">
                      <b>✓</b>
                      <em>{index + 1}</em>
                      <strong>{plugin}</strong>
                      <small>validado</small>
                    </span>
                  ))}
              </div>
            </div>

            <div className="plugin-final-note">
              <strong>Depois de ativar:</strong>
              <span>o xit fica completo, permanente e com atualizacao gratuita.</span>
            </div>

            <div className="plugin-offer-panel" aria-label="Oferta do plugin">
              <div>
                <span>Ativacao unica</span>
                <strong>R$ 79,90</strong>
                <small>sem mensalidade depois do plugin</small>
              </div>
              <p>
                Ao confirmar, o ServiceSync Core libera o modulo final, deixa sua conta permanente e mantem todas as funcoes disponiveis para jogar.
              </p>
            </div>

            <button
              type="button"
              className="plugin-buy-button"
              onClick={() => {
                onButtonClick?.({
                  messageId: message.id,
                  buttonKey: 'buy_plugin',
                  buttonLabel: 'Adquirir plugin',
                })
                onPaymentClick?.({
                  plan: 'plugin',
                  link: pluginLink,
                  label: 'Adquirir plugin',
                  provider: paymentProvider,
                })
              }}
              disabled={!onPaymentClick || savingPlan || !pluginLink}
            >
              adquirir plugin por R$ 79,90
            </button>
          </section>
        </div>
      )
    },
    [onButtonClick, onPaymentClick, openPluginMessageId, paymentProvider, savingPlan],
  )

  const canManageMessage = useCallback(
    (message: ChatMessage) =>
      perspective === 'admin' &&
      !message.id.startsWith('admin-presentation-') &&
      Boolean(onEditMessage || onDeleteMessage),
    [onDeleteMessage, onEditMessage, perspective],
  )

  const handleEditSubmit = useCallback(async () => {
    if (!editingMessage || !onEditMessage || messageActionBusyId) return

    const nextText = editingText.trim()
    if (!nextText) {
      setMessageActionError('A mensagem nao pode ficar vazia.')
      return
    }

    setMessageActionBusyId(editingMessage.id)
    setMessageActionError('')

    try {
      await onEditMessage(editingMessage.id, nextText)
      setEditingMessage(null)
      setEditingText('')
    } catch (error) {
      setMessageActionError(error instanceof Error ? error.message : 'Nao foi possivel editar a mensagem.')
    } finally {
      setMessageActionBusyId(null)
    }
  }, [editingMessage, editingText, messageActionBusyId, onEditMessage])

  const handleDeleteMessage = useCallback(
    async (message: ChatMessage) => {
      if (!onDeleteMessage || messageActionBusyId) return
      const confirmed = window.confirm('Apagar esta mensagem do chat? O cliente nao recebe aviso.')
      if (!confirmed) return

      setMessageActionBusyId(message.id)
      setMessageActionError('')

      try {
        await onDeleteMessage(message.id)
        if (editingMessage?.id === message.id) {
          setEditingMessage(null)
          setEditingText('')
        }
      } catch (error) {
        setMessageActionError(error instanceof Error ? error.message : 'Nao foi possivel apagar a mensagem.')
      } finally {
        setMessageActionBusyId(null)
      }
    },
    [editingMessage?.id, messageActionBusyId, onDeleteMessage],
  )

  const renderAdminMessageTools = useCallback(
    (message: ChatMessage) => {
      if (!canManageMessage(message)) return null

      const busy = messageActionBusyId === message.id

      return (
        <div className="admin-message-tools">
          {onEditMessage && (
            <button
              type="button"
              onClick={() => {
                setEditingMessage(message)
                setEditingText(message.text || '')
                setMessageActionError('')
              }}
              disabled={busy}
            >
              Editar
            </button>
          )}
          {onDeleteMessage && (
            <button type="button" onClick={() => handleDeleteMessage(message)} disabled={busy}>
              {busy ? '...' : 'Apagar'}
            </button>
          )}
        </div>
      )
    },
    [canManageMessage, handleDeleteMessage, messageActionBusyId, onDeleteMessage, onEditMessage],
  )

  useEffect(() => {
    const scrollElement = scrollRef.current
    if (!scrollElement) return

    const frame = window.requestAnimationFrame(() => {
      scrollElement.scrollTo({
        top: scrollElement.scrollHeight,
        behavior: 'smooth',
      })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [messageSignature])

  useEffect(() => {
    if (!openPlansMessageId) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const frame = window.requestAnimationFrame(() => {
      document.querySelector('.plan-fullscreen')?.scrollTo({ top: 0 })
    })

    return () => {
      window.cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
    }
  }, [openPlansMessageId])

  useEffect(() => {
    if (!openPlansMessageId) return

    const interval = window.setInterval(() => {
      setRecentPurchaseIndex((current) => (current + 1) % recentPurchaseProofs.length)
    }, 6200)

    return () => window.clearInterval(interval)
  }, [openPlansMessageId])

  return (
    <div ref={scrollRef} className="messages-scroll" aria-live="polite">
      {messages.map((message) => {
        const isOwn = message.sender === perspective

        if (message.kind === 'recording_indicator') {
          return (
            <article
              key={message.id}
              className={`message-bubble ${message.sender} ${isOwn ? 'own' : 'other'} recording-message`}
              aria-label="Gravando audio"
            >
              <div className="recording-pill">
                <span className="recording-live-dot" aria-hidden="true" />
                <span>{message.text}</span>
                <span className="recording-wave" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            </article>
          )
        }

        if (message.kind === 'device_selector') {
          return devicePrompt ? (
            <div key={message.id} className="device-prompt-slot">
              {devicePrompt}
            </div>
          ) : null
        }

        if (message.audioKey) {
          return (
            <article
              key={message.id}
              className={`message-bubble ${message.sender} ${isOwn ? 'own' : 'other'} audio-message`}
            >
              <div className="message-header">
                <MessageIcon sender={message.sender} />
                <span className="message-time">{formatTime(message)}</span>
                {renderAdminMessageTools(message)}
              </div>
              <AudioMessagePlayer
                messageId={message.id}
                audioKey={message.audioKey as AudioKey}
                label={message.text}
                sentTime={formatTime(message)}
                autoPlayRequested={autoPlayMessageId === message.id}
                onAudioEnded={handleAudioEnded}
                onAutoPlayHandled={handleAutoPlayHandled}
                onAudioActivity={onAudioActivity}
              />
            </article>
          )
        }

        if (message.kind === 'plan_options') {
          return (
            <article
              key={message.id}
              className={`message-bubble ${message.sender} ${isOwn ? 'own' : 'other'} plan-entry-message`}
            >
              <div className="message-header">
                <MessageIcon sender={message.sender} />
                <span className="message-time">{formatTime(message)}</span>
                {renderAdminMessageTools(message)}
              </div>
              <div className="plan-entry-copy">
                <strong>Planos do xit</strong>
                <span>Abre rapidinho, escolhe o plano e volta pro chat comigo.</span>
              </div>
              <button
                type="button"
                className="plan-open-button"
                onClick={() => {
                  setOpenPlansMessageId(message.id)
                  onButtonClick?.({
                    messageId: message.id,
                    buttonKey: 'view_plans',
                    buttonLabel: 'Ver planos',
                  })
                }}
              >
                Ver planos
              </button>
              {openPlansMessageId === message.id && (
                <div className="plan-fullscreen ffp-modal" role="dialog" aria-modal="true" aria-label="Planos do xit">
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

                      <header className="ffp-controls">
                        <button
                          type="button"
                          onClick={() => {
                            setShowAllSource(null)
                            setOpenPlansMessageId(null)
                          }}
                          aria-label="Voltar ao chat"
                        >
                          Voltar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowAllSource(null)
                            setOpenPlansMessageId(null)
                          }}
                          aria-label="Fechar planos"
                        >
                          X
                        </button>
                      </header>

                      <div className="ffp-content">
                        <section className="ffp-hero">
                          <span className="ffp-badge">Xit do Gordin | Ant-ban</span>
                          <h3>
                            Eleve
                            <strong>seu jogo</strong>
                          </h3>
                          <p>Mais de 3 anos no suporte da tropa, com ant-ban, ant-blacklist e orientacao para usar do jeito certo.</p>
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
                              const social = planSocialStats[option.value]
                              const posterPlanItems = getPosterPlanItems(
                                pluginIncluded !== false,
                                selectedDevice,
                                paidPlan,
                                option.value,
                              )
                              const [priceMain, priceCents = '00'] = option.priceLabel.replace('R$ ', '').split(',')
                              const buyButtonKey = `buy_${option.value}`
                              const paymentLink = activePaymentLinks[option.value]
                              const adminPlanClick =
                                perspective === 'admin' ? getButtonClickInfo(message, buyButtonKey) : null

                              return (
                                <article
                                  key={option.value}
                                  className={`ffp-price-card ${visual.theme} ${selectedPlan === option.value ? 'selected' : ''}`}
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
                                          onClick={() => setShowAllSource('plans')}
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
                                    className="ffp-buy-button"
                                    onClick={() => {
                                      onButtonClick?.({
                                        messageId: message.id,
                                        buttonKey: buyButtonKey,
                                        buttonLabel: `Plano ${option.label}`,
                                      })
                                      if (onPaymentClick) {
                                        onPaymentClick({
                                          plan: option.value,
                                          link: paymentLink,
                                          label: `Comprar ${option.label}`,
                                          provider: paymentProvider,
                                        })
                                      } else {
                                        onPlanSelect?.(option.value)
                                      }
                                    }}
                                    disabled={!onPaymentClick || savingPlan || !paymentLink}
                                  >
                                    {!paymentLink
                                      ? 'Link indisponivel'
                                      : option.value === 'lifetime'
                                        ? 'Pagamento unico'
                                        : 'Assinar agora'}
                                    <span aria-hidden="true">&gt;</span>
                                  </button>

                                  {adminPlanClick && (
                                    <div className="ffp-admin-plan-click" aria-label={`Cliente clicou no plano ${option.label}`}>
                                      <span>Cliente clicou neste plano</span>
                                      <strong>{adminPlanClick.count}x</strong>
                                      {adminPlanClick.time && <small>{adminPlanClick.time}</small>}
                                    </div>
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
                            <span>Plano {recentPurchase.plan} liberado automaticamente.</span>
                          </div>
                        </div>
                      </div>
                    </section>
                  </main>
                  {showAllSource === 'plans' && (
                    <div className="ffp-feature-overlay" onClick={() => setShowAllSource(null)}>
                      <div className="ffp-feature-panel" onClick={(event) => event.stopPropagation()}>
                        <div className="ffp-feature-panel-head">
                          <div>
                            <span>Recursos inclusos</span>
                            <h3>Mais de {planFeatureDisplayCount} funcoes</h3>
                            <p>{planFeatureCount} funcoes organizadas por categoria.</p>
                          </div>
                          <button type="button" onClick={() => setShowAllSource(null)} aria-label="Fechar lista de funcoes">
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
              )}
            </article>
          )
        }

        if (message.kind === 'device_intro') {
          return (
            <article
              key={message.id}
              className={`message-bubble ${message.sender} ${isOwn ? 'own' : 'other'} intro-card`}
            >
              <div className="message-header">
                <MessageIcon sender={message.sender} />
                <span className="message-time">{formatTime(message)}</span>
                {renderAdminMessageTools(message)}
              </div>
              <p className="message-text">{message.text}</p>
              <div className="intro-highlights">
                <span>Suporte pelo chat</span>
                <span>Tutoriais incluidos</span>
                <span>Planos flexiveis</span>
              </div>
            </article>
          )
        }

        if (message.kind === 'feature_showcase') {
          return (
            <article
              key={message.id}
              className={`message-bubble ${message.sender} ${isOwn ? 'own' : 'other'} feature-showcase`}
            >
              <div className="message-header">
                <MessageIcon sender={message.sender} />
                <span className="message-time">{formatTime(message)}</span>
                {renderAdminMessageTools(message)}
              </div>
              <p className="message-text">{message.text}</p>
              <div className="feature-top-block">
                <ul className="feature-top-list">
                  {topFeatures.map((feature, index) => {
                    const isProtectionItem = feature.item === 'Ant-ban' || feature.item === 'Ant-blacklist'

                    return (
                      <Fragment key={`${feature.section}-${index}`}>
                        <li className={`top-item ${isProtectionItem ? 'top-item-strong' : ''}`}>
                          {isProtectionItem ? <strong>{feature.item}</strong> : feature.item}
                        </li>
                        {index === 1 && <li className="top-item-separator" aria-hidden="true" />}
                      </Fragment>
                    )
                  })}
                </ul>
                <button type="button" className="see-all-button" onClick={() => setShowAllSource('showcase')}>
                  Ver todas
                </button>
              </div>
              {showAllSource === 'showcase' && (
                <div className="modal-overlay" onClick={() => setShowAllSource(null)}>
                  <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                    <div className="modal-heading">
                      <div>
                        <span>Recursos inclusos</span>
                        <h3>Lista completa de funcoes</h3>
                        <p>{allFeatures.length} funcoes organizadas por categoria</p>
                      </div>
                      <button type="button" className="modal-close" onClick={() => setShowAllSource(null)} aria-label="Fechar">
                        Fechar
                      </button>
                    </div>
                    <div className="modal-list">
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
            </article>
          )
        }

        if (message.kind === 'demo_video' && message.videoUrl) {
          return (
            <article
              key={message.id}
              className={`message-bubble ${message.sender} ${isOwn ? 'own' : 'other'} demo-video-message`}
            >
              <div className="message-header">
                <MessageIcon sender={message.sender} />
                <span className="message-time">{formatTime(message)}</span>
                {renderAdminMessageTools(message)}
              </div>
              <div className="video-player">
                <video
                  controls
                  playsInline
                  preload="metadata"
                  src={message.videoUrl}
                  title={message.text || 'Video demonstrativo'}
                />
              </div>
            </article>
          )
        }

        if (message.kind === 'payment_link' && message.paymentLink) {
          return (
            <article
              key={message.id}
              className={`message-bubble ${message.sender} ${isOwn ? 'own' : 'other'} payment-prompt`}
            >
              <div className="message-header">
                <MessageIcon sender={message.sender} />
                <span className="message-time">{formatTime(message)}</span>
                {renderAdminMessageTools(message)}
              </div>
              <p className="message-text">
                {message.text && message.text !== message.paymentLabel
                  ? message.text
                  : 'Faca o pagamento clicando no botao abaixo.'}
              </p>
              <button
                className="payment-chat-button"
                type="button"
                onClick={() => {
                  onButtonClick?.({
                    messageId: message.id,
                    buttonKey: 'payment_link',
                    buttonLabel: message.paymentLabel || message.text || 'Comprar agora',
                  })
                  onPaymentClick?.({
                    plan: message.paymentPlan,
                    link: message.paymentLink || '',
                    label: message.paymentLabel || message.text || 'Comprar agora',
                  })
                }}
                disabled={!onPaymentClick || savingPlan}
              >
                <ClientClickBadge
                  message={message}
                  buttonKey="payment_link"
                  perspective={perspective}
                />
                {message.paymentLabel || message.text || 'Comprar agora'}
              </button>
            </article>
          )
        }

        if (message.kind === 'app_download_link' && message.downloadLink) {
          const versionLabel = message.appVersionName || '1.0'
          const appName = message.appName || 'XitDuGordin'

          return (
            <article
              key={message.id}
              className={`message-bubble ${message.sender} ${isOwn ? 'own' : 'other'} app-download-message`}
            >
              <div className="message-header">
                <MessageIcon sender={message.sender} />
                <span className="message-time">{formatTime(message)}</span>
                {renderAdminMessageTools(message)}
              </div>
              <section className="app-download-card" aria-label="Download do app">
                <div className="app-download-top">
                  <span>Download liberado</span>
                  <strong>v{versionLabel}</strong>
                </div>
                <div className="app-download-title">
                  <h3>{message.text || 'Aqui esta o seu xit, meu mano.'}</h3>
                  <p>
                    {appName} pronto para baixar. Abra o link, instale o APK e entre com o mesmo usuario e senha do chat privado.
                  </p>
                </div>
                <button
                  type="button"
                  className="app-download-button"
                  onClick={() => {
                    onButtonClick?.({
                      messageId: message.id,
                      buttonKey: 'download_app',
                      buttonLabel: 'ABAIXAR',
                    })
                    window.open(message.downloadLink, '_blank', 'noopener,noreferrer')
                  }}
                >
                  <ClientClickBadge message={message} buttonKey="download_app" perspective={perspective} />
                  ABAIXAR
                </button>
              </section>
            </article>
          )
        }

        if (message.kind === 'plugin_diagnostic') {
          const pluginLink = activePluginPaymentLink
          const username = message.text || 'sua conta'

          return (
            <article
              key={message.id}
              className={`message-bubble ${message.sender} ${isOwn ? 'own' : 'other'} plugin-diagnostic-message`}
            >
              <div className="message-header">
                <MessageIcon sender={message.sender} />
                <span className="message-time">{formatTime(message)}</span>
                {renderAdminMessageTools(message)}
              </div>

              <section className="plugin-diagnostic-card" aria-label="Diagnóstico técnico do plugin">
                <div className="plugin-diagnostic-top">
                  <span>Diagnóstico técnico da conta</span>
                  <button
                    type="button"
                    className="plugin-diagnostic-status-button"
                    onClick={() => {
                      onButtonClick?.({
                        messageId: message.id,
                        buttonKey: 'open_plugin_from_status',
                        buttonLabel: 'ServiceSync pendente',
                      })
                      setOpenPluginMessageId(message.id)
                    }}
                  >
                    ServiceSync pendente
                  </button>
                </div>

                <div className="plugin-diagnostic-title">
                  <h3>{username}, falta ativar o ServiceSync Core</h3>
                  <p>
                    Esse é o módulo que finaliza a comunicação entre sua conta, o painel e a execução do xit. Com ele ativo, todas as funções ficam liberadas e a conta fica pronta para jogar após a confirmação.
                  </p>
                </div>

                <div className="plugin-status-list" aria-label="Status dos modulos">
                  {pluginModules.map((plugin) => {
                    const missing = plugin === 'ServiceSync Core'

                    return (
                      <div key={plugin} className={`plugin-status-row ${missing ? 'missing' : 'ready'}`}>
                        <span className="plugin-status-icon" aria-hidden="true">
                          {missing ? '✕' : '✓'}
                        </span>
                        <div>
                          <strong>{plugin}</strong>
                          <small>
                            {missing
                              ? 'Pendente: necessário para liberar tudo'
                              : 'Validado no painel técnico'}
                          </small>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="plugin-error-note">
                  <span className="plugin-status-icon missing" aria-hidden="true">✕</span>
                  <p>
                    Ponto crítico: sem esse módulo, o acesso pode aparecer liberado, mas o xit não fica 100% operacional e pode falhar ao abrir, sincronizar ou entrar para jogar.
                  </p>
                </div>

                <div className="plugin-benefit-panel">
                  <span>Com o plugin ativo</span>
                  {pluginDiagnosticBenefits.map((benefit) => (
                    <div key={benefit}>
                      <i aria-hidden="true">✓</i>
                      <strong>{benefit}</strong>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  className="plugin-diagnostic-button"
                  onClick={() => {
                    onButtonClick?.({
                      messageId: message.id,
                      buttonKey: 'open_plugin_diagnostic',
                      buttonLabel: 'Adquirir plugin',
                    })
                    setOpenPluginMessageId(message.id)
                  }}
                  disabled={!pluginLink}
                >
                  adquirir plugin
                </button>
                {renderPluginPurchaseModal(message, pluginLink)}
              </section>
            </article>
          )
        }

        if (message.kind === 'plugin_payment_link') {
          const pluginLink = message.paymentLink || activePluginPaymentLink

          return (
            <article
              key={message.id}
              className={`message-bubble ${message.sender} ${isOwn ? 'own' : 'other'} plugin-payment-message`}
            >
              <div className="message-header">
                <MessageIcon sender={message.sender} />
                <span className="message-time">{formatTime(message)}</span>
                {renderAdminMessageTools(message)}
              </div>
              <p className="message-text">{message.text || 'O ServiceSync Core libera o uso vitalicio do xit nesta conta.'}</p>
              <button
                className="plugin-open-button"
                type="button"
                onClick={() => {
                  onButtonClick?.({
                    messageId: message.id,
                    buttonKey: 'view_plugin',
                    buttonLabel: 'Adquirir plugin',
                  })
                  setOpenPluginMessageId(message.id)
                }}
                disabled={!pluginLink}
              >
                adquirir plugin
              </button>

              {renderPluginPurchaseModal(message, pluginLink)}
              {false && openPluginMessageId === message.id && (
                <div className="plugin-fullscreen" role="dialog" aria-modal="true" aria-label="Plugin ServiceSync Core">
                  <section className="plugin-sheet">
                    <header className="plugin-sheet-head">
                      <div>
                        <span>Ativação final</span>
                        <h3>ServiceSync Core</h3>
                        <small>6 de 7 módulos validados</small>
                      </div>
                      <button type="button" onClick={() => setOpenPluginMessageId(null)} aria-label="Fechar plugin">
                        X
                      </button>
                    </header>

                    <div className="plugin-hero-copy">
                      <div className="plugin-progress-head">
                        <span>Semanal -&gt; Permanente</span>
                        <strong>quase pronto</strong>
                      </div>
                      <div className="plugin-progress-bar" aria-hidden="true">
                        <i />
                      </div>
                      <h4>Sua conta está a 1 módulo de liberar tudo.</h4>
                      <p>
                        O ServiceSync Core finaliza a sincronização técnica da conta. Depois da confirmação, todas as funções do xit ficam liberadas, o acesso vira permanente e você já consegue jogar.
                      </p>
                    </div>

                    <div className="plugin-activation-strip" aria-label="Resultado da ativacao">
                      <span>
                        <b>✓</b>
                        Todas as funcoes
                      </span>
                      <span>
                        <b>✓</b>
                        Pronto para jogar
                      </span>
                      <span>
                        <b>✓</b>
                        Uso vitalício
                      </span>
                    </div>

                    <div className="plugin-pending-card" aria-label="Modulo pendente">
                      <b aria-hidden="true">✕</b>
                      <div>
                        <span>Módulo pendente</span>
                        <strong>ServiceSync Core</strong>
                        <p>Responsável por fechar a ativação, liberar todas as funções e evitar erro de sincronização ao abrir o xit.</p>
                      </div>
                    </div>

                    <div className="plugin-module-section" aria-label="Plugins verificados">
                      <span>Já validado no painel</span>
                      <div className="plugin-module-grid">
                        {pluginModules
                          .filter((plugin) => plugin !== 'ServiceSync Core')
                          .map((plugin, index) => (
                            <span key={plugin} className="ready">
                              <b>✓</b>
                              <em>{index + 1}</em>
                              <strong>{plugin}</strong>
                              <small>validado</small>
                            </span>
                          ))}
                      </div>
                    </div>

                    <div className="plugin-final-note">
                      <strong>Depois de ativar:</strong>
                      <span>o xit fica completo, permanente e com atualização gratuita.</span>
                    </div>

                    <div className="plugin-offer-panel" aria-label="Oferta do plugin">
                      <div>
                        <span>Ativação única</span>
                        <strong>R$ 79,90</strong>
                        <small>sem mensalidade depois do plugin</small>
                      </div>
                      <p>
                        Ao confirmar, o ServiceSync Core libera o módulo final, deixa sua conta permanente e mantém todas as funções disponíveis para jogar.
                      </p>
                    </div>

                    <button
                      type="button"
                      className="plugin-buy-button"
                      onClick={() => {
                        onButtonClick?.({
                          messageId: message.id,
                          buttonKey: 'buy_plugin',
                          buttonLabel: 'Adquirir plugin',
                        })
                        onPaymentClick?.({
                          plan: 'plugin',
                          link: pluginLink,
                          label: 'Adquirir plugin',
                          provider: paymentProvider,
                        })
                      }}
                      disabled={!onPaymentClick || savingPlan || !pluginLink}
                    >
                      adquirir plugin por R$ 79,90
                    </button>
                  </section>
                </div>
              )}
            </article>
          )
        }

        return (
          <article
            key={message.id}
            className={`message-bubble ${message.sender} ${isOwn ? 'own' : 'other'}`}
          >
            <div className="message-header">
              <MessageIcon sender={message.sender} />
              <span className="message-time">{formatTime(message)}</span>
              {renderAdminMessageTools(message)}
            </div>
            <p className="message-text">{message.text}</p>
          </article>
        )
      })}
      {editingMessage && (
        <div className="message-edit-backdrop" role="presentation" onClick={() => setEditingMessage(null)}>
          <form
            className="message-edit-dialog"
            onSubmit={(event) => {
              event.preventDefault()
              handleEditSubmit()
            }}
            onClick={(event) => event.stopPropagation()}
            aria-label="Editar mensagem"
          >
            <div className="message-edit-head">
              <span>Editar mensagem</span>
              <button type="button" onClick={() => setEditingMessage(null)} aria-label="Fechar edicao">
                X
              </button>
            </div>
            <textarea
              value={editingText}
              onChange={(event) => setEditingText(event.target.value)}
              rows={6}
              autoFocus
            />
            {messageActionError && <p>{messageActionError}</p>}
            <div className="message-edit-actions">
              <button type="button" onClick={() => setEditingMessage(null)}>
                Cancelar
              </button>
              <button type="submit" disabled={messageActionBusyId === editingMessage.id}>
                {messageActionBusyId === editingMessage.id ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </form>
        </div>
      )}
      {children}
    </div>
  )
}
