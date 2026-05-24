'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { Timestamp } from 'firebase/firestore'
import { AccessNotFound } from '@/components/AccessNotFound'
import { AdminChatList } from '@/components/AdminChatList'
import { ChatMessages } from '@/components/ChatMessages'
import { MessageComposer } from '@/components/MessageComposer'
import { SavedReplies, type QuickReplyAction } from '@/components/SavedReplies'
import {
  defaultAppUpdateSettings,
  loadAppUpdateSettings,
  saveAppUpdateSettings,
  type AppUpdateSettings,
} from '@/lib/app-update'
import { verifyAdminSession } from '@/lib/admin-session'
import { auth } from '@/lib/firebase'
import { videoFiles } from '@/lib/video'
import { getSecureItem, listStorageKeys, setSecureItem } from '@/lib/secure-storage'
import {
  addMessage,
  checkClientSessionAccess,
  deleteChatMessage,
  editChatMessage,
  getPluginPaymentLink,
  getPaymentLinks,
  getStoredAccountBlocked,
  listenChats,
  listenClientActivity,
  listenMessages,
  loadAdminSettings,
  paymentProviderLabels,
  planOptions,
  updateChatFunnel,
  updateLiveIntroSetting,
  updatePaymentProviderSetting,
} from '@/lib/chat'
import type { AudioKey, Chat, ChatMessage, ClientActivity, DeviceType, FunnelStatus, PaymentProvider, PlanType } from '@/types/chat'

const ADMIN_READ_PREFIX = 'chat-atendimento-admin-read-v1'

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

const deviceLabelMap: Record<DeviceType, string> = {
  android: 'Android',
  ios: 'iOS',
  emulator: 'Emulador',
}

function presentationTime(timestamp: Chat['createdAt'] | undefined, offsetMs: number) {
  const baseMillis = timestamp?.toMillis?.()
  if (typeof baseMillis !== 'number' || !Number.isFinite(baseMillis)) return undefined

  return Timestamp.fromMillis(baseMillis + offsetMs)
}

function makeAdminPresentationMessages(chat: Chat): ChatMessage[] {
  const device = chat.leadProfile?.device
  const chatCreatedAt = chat.createdAt
  const deviceSelectedAt = chat.leadProfile?.deviceSelectedAt || chatCreatedAt
  const introAudioKey: AudioKey = chat.introAudioKey === 'start-live' ? 'start-live' : 'start'
  const baseMessages: ChatMessage[] = [
    {
      id: 'admin-presentation-audio-start',
      text: 'Audio 1 de 4 - inicio do chat privado',
      sender: 'admin',
      kind: 'text',
      audioKey: introAudioKey,
      createdAt: presentationTime(chatCreatedAt, 1800),
    },
  ]

  if (!device) return baseMessages

  const deviceLabel = deviceLabelMap[device]

  return [
    ...baseMessages,
    {
      id: 'admin-presentation-audio-device',
      text: `Audio 2 de 4 - instrucoes para ${deviceLabel}`,
      sender: 'admin',
      kind: 'text',
      audioKey: deviceAudioMap[device],
      createdAt: presentationTime(deviceSelectedAt, 2200),
    },
    {
      id: 'admin-presentation-feature-showcase',
      text: 'Funcoes do xit',
      sender: 'admin',
      kind: 'feature_showcase',
      createdAt: presentationTime(deviceSelectedAt, 17200),
    },
    {
      id: 'admin-presentation-demo-video',
      text: 'Video demonstrativo',
      sender: 'admin',
      kind: 'demo_video',
      videoUrl: videoFiles[device],
      createdAt: presentationTime(deviceSelectedAt, 19700),
    },
    {
      id: 'admin-presentation-audio-penultimate',
      text: 'Audio 3 de 4 - explicacao principal',
      sender: 'admin',
      kind: 'text',
      audioKey: 'penultimate',
      createdAt: presentationTime(deviceSelectedAt, 27500),
    },
    {
      id: 'admin-presentation-audio-latest',
      text: `Audio 4 de 4 - finalizacao para ${deviceLabel}`,
      sender: 'admin',
      kind: 'text',
      audioKey: latestDeviceAudioMap[device],
      createdAt: presentationTime(deviceSelectedAt, 32200),
    },
  ]
}

const funnelActions: Array<{ value: FunnelStatus; label: string; help: string }> = [
  {
    value: 'waiting_receipt',
    label: 'Aguardando comprovante',
    help: 'Use depois de enviar o link e pedir o comprovante.',
  },
  {
    value: 'paid',
    label: 'Pago',
    help: 'Use quando conferir o pagamento/comprovante.',
  },
]

function formatActivityTime(activity: ClientActivity) {
  const date = activity.createdAt?.toDate?.()
  if (!date) return 'agora'

  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function getLastMessageMillis(chat: Chat) {
  return chat.lastMessageAt?.toMillis?.() || chat.updatedAt?.toMillis?.() || chat.createdAt?.toMillis?.() || 0
}

function getPaymentInstruction(plan: PlanType) {
  const label = planOptions.find((option) => option.value === plan)?.label || 'plano'
  return `Faca o pagamento do plano ${label} clicando no botao abaixo.`
}

function getPluginExplanation(chat: Chat) {
  const username = chat.accessUsername || chat.usernameKey || 'mano'

  return `${username}, conferi o painel técnico da sua conta e o diagnóstico ficou assim:\n\nStatus dos módulos:\n\n[v] License Bridge\n[v] Device Binder\n[v] Profile Cache\n[v] Overlay Runtime\n[v] Policy Sync Agent\n[v] Frame Stabilizer\n[x] ServiceSync Core\n\nO único módulo que ainda falta é o ServiceSync Core. Ele é o plugin que fecha a comunicação entre a sua conta, o painel e o xit.\n\nSem esse plugin, o acesso pode até aparecer como liberado, mas o xit não roda completo e pode dar erro na hora de abrir, sincronizar ou entrar para jogar.\n\nCom o ServiceSync Core ativo:\n\n[v] o xit funciona completo\n[v] reduz erro de ativação e sincronização\n[v] você consegue jogar assim que o plugin for confirmado\n[v] sua conta muda de Semanal -> Permanente\n[v] você fica com uso vitalício e atualizações gratuitas para sempre\n\nA gente deixou avisado antes da compra que, quando o plugin não está incluso, ele é necessário para o xit funcionar corretamente.\n\nSe quiser, eu te mando o botão do plugin agora e já deixo sua conta pronta para jogar.`
}

function getAppInstallGuide(chat: Chat) {
  const username = chat.accessUsername || chat.usernameKey || 'mano'

  return `${username}, segue o passo a passo simples para instalar e usar:\n\n1. Clique em ABAIXAR e espere o APK terminar de baixar.\n2. Abra o arquivo baixado no celular.\n3. Se aparecer aviso do Android, toque em Configurações e permita instalar app desta fonte.\n4. Conclua a instalação e abra o XitDuGordin.\n5. Entre com o mesmo usuário e senha que você usa aqui no chat privado.\n6. Depois do login, confira se o plano aparece ativo e toque nas funções que quiser usar.\n\nSe aparecer ServiceSync pendente, me chama aqui no chat antes de tentar mexer nas funções.`
}

type AppUpdateDraft = {
  enabled: boolean
  required: boolean
  latestVersionCode: string
  latestVersionName: string
  apkUrl: string
  message: string
  changelog: string
}

function makeAppUpdateDraft(settings: AppUpdateSettings = defaultAppUpdateSettings): AppUpdateDraft {
  return {
    enabled: settings.enabled,
    required: settings.required,
    latestVersionCode: String(settings.latestVersionCode || defaultAppUpdateSettings.latestVersionCode),
    latestVersionName: settings.latestVersionName || defaultAppUpdateSettings.latestVersionName,
    apkUrl: settings.apkUrl || '',
    message: settings.message || defaultAppUpdateSettings.message,
    changelog: settings.changelog || '',
  }
}

function ActivityPanel({
  chat,
  activities,
}: {
  chat: Chat
  activities: ClientActivity[]
}) {
  const summaryItems = useMemo(
    () =>
      Object.entries(chat.activitySummary || {})
        .map(([key, item]) => ({ key, ...item }))
        .sort((first, second) => (second.count || 0) - (first.count || 0))
        .slice(0, 8),
    [chat.activitySummary],
  )
  const latest = activities[0]

  return (
    <section className="activity-panel" aria-label="Acoes do cliente">
      <div className="activity-live">
        <span>Ultima acao</span>
        {latest ? (
          <article key={latest.id} className="activity-live-card">
            <strong>{latest.label}</strong>
            <small>{formatActivityTime(latest)}</small>
          </article>
        ) : (
          <article className="activity-live-card muted">
            <strong>Nenhuma acao registrada ainda</strong>
            <small>Audio, cliques e mensagens vao aparecer aqui.</small>
          </article>
        )}
      </div>
      {summaryItems.length > 0 && (
        <div className="activity-summary" aria-label="Contagem de acoes">
          {summaryItems.map((item) => (
            <span key={item.key}>
              <strong>{item.count}x</strong>
              {item.label}
            </span>
          ))}
        </div>
      )}
    </section>
  )
}

function LeadSummary({
  chat,
  status,
  menuOpen,
  onToggleMenu,
  onOpenActivities,
  onOpenChatActions,
}: {
  chat: Chat
  status: string
  menuOpen: boolean
  onToggleMenu: () => void
  onOpenActivities: () => void
  onOpenChatActions: () => void
}) {
  const accountBlocked = chat.accessBlocked === true || chat.accountBlock?.active === true
  const statusLabel = {
    new: 'Novo',
    device_selected: 'Dispositivo escolhido',
    plans_sent: 'Planos enviados',
    plan_selected: 'Plano escolhido',
    payment_link_sent: 'Link enviado',
    waiting_receipt: 'Aguardando comprovante',
    paid: 'Pago',
    activated: 'Ativado',
    deactivated: 'Desativado',
  }[chat.funnelStatus || 'new']

  return (
    <aside className="lead-panel" aria-label="Resumo do chat privado">
      <div className="lead-topline">
        <div className="lead-grid">
          <div>
            <span>Usuario</span>
            <strong>{chat.accessUsername || 'Sem usuario'}</strong>
          </div>
          <div>
            <span>Dispositivo</span>
            <strong>{chat.leadProfile?.deviceLabel || 'Nao escolhido'}</strong>
          </div>
          <div>
            <span>Plano</span>
            <strong>
              {chat.selectedPlan?.label
                ? `${chat.selectedPlan.label} - ${chat.selectedPlan.priceLabel}`
                : 'Nao escolhido'}
            </strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{statusLabel}</strong>
          </div>
          <div>
            <span>Plugin</span>
            <strong>
              {chat.plugin?.included === false
                ? 'Nao incluso'
                : chat.plugin?.status === 'active'
                  ? 'Ativo'
                  : 'Incluso'}
            </strong>
          </div>
          <div>
            <span>Acesso</span>
            <strong className={accountBlocked ? 'danger-text' : undefined}>
              {accountBlocked ? 'Bloqueado' : 'Liberado'}
            </strong>
          </div>
        </div>
        <button
          className="lead-menu-button"
          type="button"
          onClick={onToggleMenu}
          aria-expanded={menuOpen}
          aria-label="Abrir opcoes do chat privado"
        >
          <span />
          <span />
          <span />
        </button>
        {menuOpen && (
          <div className="lead-menu-popover" role="menu" aria-label="Opcoes do chat privado">
            <button type="button" onClick={onOpenActivities} role="menuitem">
              Acoes do usuario
            </button>
            <button type="button" onClick={onOpenChatActions} role="menuitem">
              Acoes do chat privado
            </button>
          </div>
        )}
      </div>

      {status && <p className="admin-status compact">{status}</p>}
    </aside>
  )
}

function ChatActionsModal({
  busy,
  onClose,
  onStatus,
  onActivate,
  onActivatePlugin,
  onPluginIncluded,
  onPluginNotIncluded,
  onDeactivate,
  onBlockAccount,
  onUnblockAccount,
  accountBlocked,
}: {
  busy: boolean
  onClose: () => void
  onStatus: (status: FunnelStatus) => void
  onActivate: (plan: PlanType) => void
  onActivatePlugin: () => void
  onPluginIncluded: () => void
  onPluginNotIncluded: () => void
  onDeactivate: () => void
  onBlockAccount: () => void
  onUnblockAccount: () => void
  accountBlocked: boolean
}) {
  return (
    <div className="popup-backdrop" role="presentation" onClick={onClose}>
      <div
        className="admin-action-drawer popup-card"
        role="dialog"
        aria-modal="true"
        aria-label="Acoes do chat privado"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-header popup-card-head">
          <div>
            <span>Chat privado</span>
            <h3>Acoes do chat</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar acoes">
            Fechar
          </button>
        </div>

        <section className="action-section action-step">
          <span className="step-number">1</span>
          <div>
            <h3>Marcar andamento</h3>
            <p>Atualize status sem ocupar a tela da conversa.</p>
          </div>
          <div className="status-actions">
            {funnelActions.map((action) => (
              <button
                key={action.value}
                type="button"
                onClick={() => onStatus(action.value)}
                disabled={busy}
              >
                <strong>{action.label}</strong>
                <span>{action.help}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="action-section action-step">
          <span className="step-number">2</span>
          <div>
            <h3>Ativar assinatura</h3>
            <p>Use depois de conferir o pagamento.</p>
          </div>
          <div className="activation-row">
            {planOptions.map((plan) => (
              <button
                key={plan.value}
                type="button"
                onClick={() => onActivate(plan.value)}
                disabled={busy}
              >
                Ativar {plan.label}
              </button>
            ))}
            <button className="deactivate-button" type="button" onClick={onDeactivate} disabled={busy}>
              Retirar plano
            </button>
          </div>
        </section>

        <section className="action-section action-step">
          <span className="step-number">3</span>
          <div>
            <h3>Plugin</h3>
            <p>Controle o que aparece nos planos desse cliente antes da compra.</p>
          </div>
          <div className="activation-row">
            <button type="button" onClick={onPluginIncluded} disabled={busy}>
              Mostrar incluso
            </button>
            <button type="button" onClick={onPluginNotIncluded} disabled={busy}>
              Mostrar nao incluso
            </button>
            <button type="button" onClick={onActivatePlugin} disabled={busy}>
              Ativar plugin / incluso
            </button>
          </div>
        </section>

        <section className="action-section action-step account-block-section">
          <span className="step-number">4</span>
          <div>
            <h3>Bloqueio total</h3>
            <p>Quando ativo, o cliente ve apenas 404 e nao acessa chat, login nem app ate voce liberar.</p>
          </div>
          <div className="activation-row">
            {accountBlocked ? (
              <button type="button" onClick={onUnblockAccount} disabled={busy}>
                Liberar conta
              </button>
            ) : (
              <button className="deactivate-button" type="button" onClick={onBlockAccount} disabled={busy}>
                Bloquear conta
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function ActivityModal({
  chat,
  activities,
  onClose,
}: {
  chat: Chat
  activities: ClientActivity[]
  onClose: () => void
}) {
  return (
    <div className="popup-backdrop" role="presentation" onClick={onClose}>
      <div
        className="popup-card activity-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="Acoes do usuario"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="popup-card-head">
          <div>
            <span>Cliente</span>
            <h3>Acoes do usuario</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            Fechar
          </button>
        </header>
        <ActivityPanel chat={chat} activities={activities} />
      </div>
    </div>
  )
}

export default function AdminPage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  const [blockedAccess, setBlockedAccess] = useState(() => getStoredAccountBlocked())
  const [status, setStatus] = useState('')
  const [chats, setChats] = useState<Chat[]>([])
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [activities, setActivities] = useState<ClientActivity[]>([])
  const [draft, setDraft] = useState('')
  const [paymentLink, setPaymentLink] = useState('')
  const [paymentMessage, setPaymentMessage] = useState('')
  const [actionStatus, setActionStatus] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [leadMenuOpen, setLeadMenuOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [confirmPlan, setConfirmPlan] = useState<PlanType | null>(null)
  const [readMarkers, setReadMarkers] = useState<Record<string, number>>({})
  const [liveIntroEnabled, setLiveIntroEnabled] = useState(false)
  const [liveIntroBusy, setLiveIntroBusy] = useState(false)
  const [paymentProvider, setPaymentProvider] = useState<PaymentProvider>('perfect-pay')
  const [paymentProviderBusy, setPaymentProviderBusy] = useState(false)
  const [activePaymentLinks, setActivePaymentLinks] = useState<Record<PlanType, string>>(
    getPaymentLinks('perfect-pay'),
  )
  const [activePluginPaymentLink, setActivePluginPaymentLink] = useState(
    getPluginPaymentLink('perfect-pay'),
  )
  const [appUpdateOpen, setAppUpdateOpen] = useState(false)
  const [appUpdateDraft, setAppUpdateDraft] = useState<AppUpdateDraft>(makeAppUpdateDraft())
  const [appUpdateBusy, setAppUpdateBusy] = useState(false)
  const [appUpdateStatus, setAppUpdateStatus] = useState('')
  const visibleMessages = useMemo(
    () => (selectedChat ? [...makeAdminPresentationMessages(selectedChat), ...messages] : messages),
    [messages, selectedChat],
  )
  const selectedChatPaidPlan =
    selectedChat?.payment?.status === 'paid' && selectedChat.payment.plan && selectedChat.payment.plan !== 'plugin'
      ? selectedChat.payment.plan
      : selectedChat?.subscription?.status === 'active' && selectedChat.subscription.plan
        ? selectedChat.subscription.plan
        : ''
  const unreadChatIds = useMemo(() => {
    const unread = new Set<string>()

    chats.forEach((chat) => {
      const lastMessageMillis = getLastMessageMillis(chat)
      const lastReadMillis = readMarkers[chat.id] || 0

      if (
        chat.lastSender === 'client' &&
        chat.id !== selectedChat?.id &&
        lastMessageMillis > lastReadMillis
      ) {
        unread.add(chat.id)
      }
    })

    return unread
  }, [chats, readMarkers, selectedChat?.id])

  useEffect(() => {
    const storedReadMarkers: Record<string, number> = {}
    listStorageKeys().forEach((key) => {
      if (!key.startsWith(`${ADMIN_READ_PREFIX}-`)) return
      const chatId = key.slice(`${ADMIN_READ_PREFIX}-`.length)
      const value = Number(getSecureItem(key))
      if (chatId && Number.isFinite(value)) storedReadMarkers[chatId] = value
    })
    setReadMarkers(storedReadMarkers)
  }, [])

  useEffect(() => {
    let active = true

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      async function validateSession() {
        setAuthReady(false)
        setIsLoggedIn(false)

        if (!user) {
          if (!active) return
          setAuthReady(true)
          return
        }

        if (user.isAnonymous) {
          try {
            const sessionAccess = await checkClientSessionAccess()
            if (!active) return
            setBlockedAccess(sessionAccess.blocked)
          } catch {
            if (!active) return
          } finally {
            if (active) setAuthReady(true)
          }
          return
        }

        const allowed = await verifyAdminSession(user).catch(() => false)
        if (!active) return

        if (!allowed) {
          await signOut(auth).catch(() => undefined)
          if (!active) return
          setAuthReady(true)
          return
        }

        setBlockedAccess(false)
        setIsLoggedIn(true)
        setStatus('Conectado ao painel.')
        setAuthReady(true)
      }

      validateSession()
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!isLoggedIn) return undefined
    return listenChats(setChats)
  }, [isLoggedIn])

  useEffect(() => {
    if (!isLoggedIn) return undefined
    let active = true

    loadAdminSettings()
      .then((settings) => {
        if (!active) return
        setLiveIntroEnabled(settings.liveIntroEnabled === true)
        setPaymentProvider(
          settings.paymentProvider === 'kiwify' || settings.paymentProvider === 'perfect-pay'
            ? settings.paymentProvider
            : 'perfect-pay',
        )
      })
      .catch(() => {
        if (active) setStatus('Nao foi possivel carregar a funcao EM LIVE.')
      })

    return () => {
      active = false
    }
  }, [isLoggedIn])

  useEffect(() => {
    if (!isLoggedIn) return undefined
    let active = true

    loadAppUpdateSettings()
      .then((settings) => {
        if (!active) return
        setAppUpdateDraft(makeAppUpdateDraft(settings))
        setAppUpdateStatus(
          settings.enabled
            ? `Versao ${settings.latestVersionName || settings.latestVersionCode} pronta.`
            : 'Atualizacao do app desligada.',
        )
      })
      .catch((error) => {
        if (active) {
          setAppUpdateStatus(
            error instanceof Error ? error.message : 'Nao foi possivel carregar a atualizacao do app.',
          )
        }
      })

    return () => {
      active = false
    }
  }, [isLoggedIn])

  useEffect(() => {
    if (!isLoggedIn) return undefined
    let active = true

    async function loadPaymentLinks() {
      try {
        const response = await fetch('/api/payment/settings', { cache: 'no-store' })
        const payload = (await response.json()) as {
          paymentProvider?: PaymentProvider
          links?: Record<PlanType, string>
          pluginLink?: string
        }

        if (!active || !response.ok) return
        if (payload.paymentProvider === 'kiwify' || payload.paymentProvider === 'perfect-pay') {
          setPaymentProvider(payload.paymentProvider)
        }
        setActivePaymentLinks(payload.links || getPaymentLinks(paymentProvider))
        setActivePluginPaymentLink(payload.pluginLink || getPluginPaymentLink(paymentProvider))
      } catch {
        if (active) {
          setActivePaymentLinks(getPaymentLinks(paymentProvider))
          setActivePluginPaymentLink(getPluginPaymentLink(paymentProvider))
        }
      }
    }

    loadPaymentLinks()

    return () => {
      active = false
    }
  }, [isLoggedIn, paymentProvider])

  useEffect(() => {
    if (!selectedChat) return
    const updated = chats.find((chat) => chat.id === selectedChat.id)
    if (updated) setSelectedChat(updated)
  }, [chats, selectedChat])

  useEffect(() => {
    if (!selectedChat) return undefined
    return listenMessages(selectedChat.id, setMessages)
  }, [selectedChat])

  useEffect(() => {
    if (!selectedChat) return
    markChatRead(selectedChat)
  }, [selectedChat])

  useEffect(() => {
    if (!selectedChat) {
      setActivities([])
      return undefined
    }

    return listenClientActivity(selectedChat.id, setActivities)
  }, [selectedChat])

  async function handleSend(message: string) {
    if (!selectedChat) return
    await addMessage(selectedChat.id, 'admin', message)
  }

  async function handleEditMessage(messageId: string, text: string) {
    if (!selectedChat) return
    await editChatMessage(selectedChat.id, messageId, text)
  }

  async function handleDeleteMessage(messageId: string) {
    if (!selectedChat) return
    await deleteChatMessage(selectedChat.id, messageId)
  }

  function markChatRead(chat: Chat) {
    const lastMessageMillis = getLastMessageMillis(chat)
    if (!lastMessageMillis) return

    setSecureItem(`${ADMIN_READ_PREFIX}-${chat.id}`, String(lastMessageMillis))
    setReadMarkers((current) => {
      if (current[chat.id] === lastMessageMillis) return current
      return {
        ...current,
        [chat.id]: lastMessageMillis,
      }
    })
  }

  async function handleLogout() {
    await signOut(auth)
    setIsLoggedIn(false)
    setSelectedChat(null)
    setMessages([])
    setActivities([])
    setActionsOpen(false)
    setLeadMenuOpen(false)
    setActivityOpen(false)
    setStatus('')
  }

  async function handleLiveIntroToggle() {
    if (liveIntroBusy) return
    const nextValue = !liveIntroEnabled
    setLiveIntroBusy(true)
    setStatus(nextValue ? 'Ativando EM LIVE...' : 'Desativando EM LIVE...')

    try {
      const settings = await updateLiveIntroSetting(nextValue)
      setLiveIntroEnabled(settings.liveIntroEnabled === true)
      setStatus(
        settings.liveIntroEnabled
          ? 'EM LIVE ativo para novos clientes.'
          : 'EM LIVE desativado. Novos clientes recebem o start normal.',
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Nao foi possivel alterar EM LIVE.')
    } finally {
      setLiveIntroBusy(false)
    }
  }

  async function handlePaymentProviderChange(nextProvider: PaymentProvider) {
    if (paymentProviderBusy || nextProvider === paymentProvider) return

    setPaymentProviderBusy(true)
    setStatus(`Mudando checkout para ${paymentProviderLabels[nextProvider]}...`)

    try {
      const settings = await updatePaymentProviderSetting(nextProvider)
      setPaymentProvider(
        settings.paymentProvider === 'kiwify' || settings.paymentProvider === 'perfect-pay'
          ? settings.paymentProvider
          : nextProvider,
      )
      setStatus(`Checkout ativo: ${paymentProviderLabels[nextProvider]}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Nao foi possivel mudar o checkout.')
    } finally {
      setPaymentProviderBusy(false)
    }
  }

  function updateAppUpdateDraft<K extends keyof AppUpdateDraft>(key: K, value: AppUpdateDraft[K]) {
    setAppUpdateDraft((current) => ({
      ...current,
      [key]: value,
    }))
  }

  async function handleAppUpdateSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (appUpdateBusy) return

    const latestVersionCode = Number.parseInt(appUpdateDraft.latestVersionCode, 10)

    if (!Number.isFinite(latestVersionCode) || latestVersionCode < 1) {
      setAppUpdateStatus('Use um version code maior que zero.')
      return
    }

    if (appUpdateDraft.enabled && !appUpdateDraft.apkUrl.trim()) {
      setAppUpdateStatus('Informe o link da nova versao antes de publicar.')
      return
    }

    setAppUpdateBusy(true)
    setAppUpdateStatus('Salvando atualizacao...')

    try {
      const settings = await saveAppUpdateSettings({
        enabled: appUpdateDraft.enabled,
        required: appUpdateDraft.required,
        latestVersionCode,
        latestVersionName: appUpdateDraft.latestVersionName.trim() || String(latestVersionCode),
        apkUrl: appUpdateDraft.apkUrl.trim(),
        message: appUpdateDraft.message.trim() || defaultAppUpdateSettings.message,
        changelog: appUpdateDraft.changelog.trim(),
      })
      setAppUpdateDraft(makeAppUpdateDraft(settings))
      setAppUpdateStatus(
        settings.enabled
          ? `Versao ${settings.latestVersionName || settings.latestVersionCode} salva.`
          : 'Atualizacao do app salva como desligada.',
      )
    } catch (error) {
      setAppUpdateStatus(error instanceof Error ? error.message : 'Nao foi possivel salvar a atualizacao.')
    } finally {
      setAppUpdateBusy(false)
    }
  }

  async function runAdminAction(
    action:
      | FunnelStatus
      | 'send_payment_link'
      | 'send_plugin_payment_link'
      | 'send_plugin_diagnostic'
      | 'send_app_download_link'
      | 'send_plans'
      | 'deactivate_plan'
      | 'activate_plugin'
      | 'set_plugin_included'
      | 'set_plugin_not_included'
      | 'block_account'
      | 'unblock_account',
    options: { paymentLink?: string; paymentMessage?: string; plan?: PlanType } = {},
  ) {
    if (!selectedChat || actionBusy) return

    setActionBusy(true)
    setActionStatus('Atualizando...')

    try {
      await updateChatFunnel({
        chatId: selectedChat.id,
        action,
        paymentProvider,
        ...options,
      })
      setActionStatus('Atualizado.')
      if (action === 'send_payment_link' || action === 'send_plugin_payment_link') {
        setPaymentLink('')
        setPaymentMessage('')
      }
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Nao foi possivel atualizar.')
    } finally {
      setActionBusy(false)
    }
  }

  const quickReplyActions: QuickReplyAction[] = selectedChat
    ? [
        {
          id: 'plans-app',
          label: 'Planos app',
          onSend: () => runAdminAction('send_plans'),
        },
        {
          id: 'plugin-explanation',
          label: 'exp plugin',
          onSend: () => runAdminAction('send_plugin_diagnostic'),
        },
        {
          id: 'payment-plugin',
          label: 'bt pag plugin',
          onSend: () =>
            runAdminAction('send_plugin_payment_link', {
              paymentLink: activePluginPaymentLink,
            }),
        },
        {
          id: 'app-download',
          label: 'bt baixar xit',
          onSend: () => runAdminAction('send_app_download_link'),
        },
        {
          id: 'app-install-guide',
          label: 'como instalar',
          message: getAppInstallGuide(selectedChat),
          onSend: (message?: string) => handleSend(message || getAppInstallGuide(selectedChat)),
        },
        ...planOptions.map((plan) => ({
          id: `payment-${plan.value}`,
          label:
            plan.value === 'weekly'
              ? 'bt pag. semanal'
              : plan.value === 'monthly'
                ? 'bt pag. mensal'
                : 'bt pag. permanente',
          message: getPaymentInstruction(plan.value),
          onSend: (message?: string) =>
            runAdminAction('send_payment_link', {
              paymentLink: activePaymentLinks[plan.value],
              paymentMessage: message || getPaymentInstruction(plan.value),
              plan: plan.value,
            }),
        })),
      ]
    : []

  if (blockedAccess) return <AccessNotFound />
  if (!authReady) return <main className="client-page" aria-hidden="true" />
  if (!isLoggedIn) return <AccessNotFound />

  return (
    <main className="admin-page">
      <aside className="admin-sidebar">
        <header className="admin-title">
          <span>Painel admin</span>
          <h1>Conversas</h1>
        </header>

        <p className="admin-status">{status}</p>

        <button
          className={`admin-live-toggle ${liveIntroEnabled ? 'active' : ''}`}
          type="button"
          onClick={handleLiveIntroToggle}
          disabled={liveIntroBusy}
          aria-pressed={liveIntroEnabled}
        >
          <span className="admin-live-dot" aria-hidden="true" />
          <span>
            <strong>EM LIVE</strong>
            <small>
              {liveIntroEnabled
                ? 'Novos clientes recebem start-live'
                : 'Novos clientes recebem start normal'}
            </small>
          </span>
          <b>{liveIntroEnabled ? 'Ativo' : 'Off'}</b>
        </button>

        <section className="admin-payment-provider" aria-label="Checkout ativo">
          <div>
            <span>Receber pagamentos</span>
            <strong>{paymentProviderLabels[paymentProvider]}</strong>
          </div>
          <div className="payment-provider-toggle" role="group" aria-label="Escolher checkout">
            {(['perfect-pay', 'kiwify'] as PaymentProvider[]).map((provider) => (
              <button
                key={provider}
                type="button"
                className={paymentProvider === provider ? 'active' : ''}
                onClick={() => handlePaymentProviderChange(provider)}
                disabled={paymentProviderBusy}
              >
                {paymentProviderLabels[provider]}
              </button>
            ))}
          </div>
          <small>Muda os links de pagamento para todos os chats.</small>
        </section>

        <section className={`admin-app-update ${appUpdateOpen ? 'open' : ''}`} aria-label="Atualizacao do app">
          <button
            className="admin-app-update-toggle"
            type="button"
            onClick={() => setAppUpdateOpen((open) => !open)}
          >
            <span>
              <small>Atualizacao do app</small>
              <strong>
                {appUpdateDraft.enabled
                  ? `v${appUpdateDraft.latestVersionName || appUpdateDraft.latestVersionCode}`
                  : 'Desligada'}
              </strong>
            </span>
            <b>{appUpdateOpen ? 'Fechar' : 'Editar'}</b>
          </button>

          {appUpdateOpen && (
            <form className="admin-app-update-form" onSubmit={handleAppUpdateSave}>
              <div className="app-update-grid">
                <label>
                  <span>Version code</span>
                  <input
                    type="number"
                    min="1"
                    value={appUpdateDraft.latestVersionCode}
                    onChange={(event) => updateAppUpdateDraft('latestVersionCode', event.target.value)}
                  />
                </label>
                <label>
                  <span>Versao</span>
                  <input
                    type="text"
                    value={appUpdateDraft.latestVersionName}
                    onChange={(event) => updateAppUpdateDraft('latestVersionName', event.target.value)}
                    placeholder="1.1"
                  />
                </label>
              </div>
              <label>
                <span>Link MediaFire/APK</span>
                <input
                  type="url"
                  value={appUpdateDraft.apkUrl}
                  onChange={(event) => updateAppUpdateDraft('apkUrl', event.target.value)}
                  placeholder="https://..."
                />
              </label>
              <label>
                <span>Mensagem</span>
                <input
                  type="text"
                  value={appUpdateDraft.message}
                  onChange={(event) => updateAppUpdateDraft('message', event.target.value)}
                />
              </label>
              <label>
                <span>Novidades</span>
                <textarea
                  value={appUpdateDraft.changelog}
                  onChange={(event) => updateAppUpdateDraft('changelog', event.target.value)}
                  rows={3}
                />
              </label>
              <div className="app-update-switches">
                <label>
                  <input
                    type="checkbox"
                    checked={appUpdateDraft.enabled}
                    onChange={(event) => updateAppUpdateDraft('enabled', event.target.checked)}
                  />
                  <span>Publicar</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={appUpdateDraft.required}
                    onChange={(event) => updateAppUpdateDraft('required', event.target.checked)}
                  />
                  <span>Obrigatoria</span>
                </label>
              </div>
              <button type="submit" disabled={appUpdateBusy}>
                {appUpdateBusy ? 'Salvando...' : 'Salvar versao'}
              </button>
              {appUpdateStatus && <small className="app-update-status">{appUpdateStatus}</small>}
            </form>
          )}
        </section>

        <AdminChatList
          chats={chats}
          activeChatId={selectedChat?.id}
          unreadChatIds={unreadChatIds}
          onSelect={(chat) => {
            markChatRead(chat)
            setSelectedChat(chat)
            setDraft('')
            setPaymentLink('')
            setPaymentMessage('')
            setActionStatus('')
            setActivities([])
            setActionsOpen(false)
            setLeadMenuOpen(false)
            setActivityOpen(false)
          }}
        />
      </aside>

      <section className="admin-chat-panel">
        <header className="chat-header">
          <div>
            <span>
              {selectedChat?.accessUsername
                ? `Usuario ${selectedChat.accessUsername}`
                : 'Nenhum chat selecionado'}
            </span>
            <h2>
              {selectedChat?.leadProfile?.deviceLabel
                ? `Chat privado ${selectedChat.leadProfile.deviceLabel}`
                : selectedChat
                  ? 'Chat privado'
                  : 'Selecione uma conversa'}
            </h2>
          </div>
          {isLoggedIn && (
            <button className="secondary-button" type="button" onClick={handleLogout}>
              Sair
            </button>
          )}
        </header>

        {selectedChat ? (
          <>
            {confirmPlan && (
              <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label="Confirmar ativacao">
                <div className="confirm-dialog">
                  <span>Confirmar ativacao</span>
                  <h3>Ativar plano {planOptions.find((plan) => plan.value === confirmPlan)?.label}?</h3>
                  <p>Isso libera o plano na conta do cliente. Confirme somente depois de conferir o pagamento.</p>
                  <div className="confirm-actions">
                    <button
                      type="button"
                      onClick={() => {
                        runAdminAction('activated', { plan: confirmPlan })
                        setConfirmPlan(null)
                      }}
                    >
                      Sim, ativar
                    </button>
                    <button type="button" onClick={() => setConfirmPlan(null)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            )}
            <LeadSummary
              chat={selectedChat}
              status={actionStatus}
              menuOpen={leadMenuOpen}
              onToggleMenu={() => setLeadMenuOpen((open) => !open)}
              onOpenActivities={() => {
                setLeadMenuOpen(false)
                setActivityOpen(true)
              }}
              onOpenChatActions={() => {
                setLeadMenuOpen(false)
                setActionsOpen(true)
              }}
            />
            {activityOpen && (
              <ActivityModal
                chat={selectedChat}
                activities={activities}
                onClose={() => setActivityOpen(false)}
              />
            )}
            {actionsOpen && (
              <ChatActionsModal
                busy={actionBusy}
                onClose={() => setActionsOpen(false)}
                onStatus={(nextStatus) => runAdminAction(nextStatus)}
                onActivate={(plan) => {
                  setActionsOpen(false)
                  setConfirmPlan(plan)
                }}
                onActivatePlugin={() => runAdminAction('activate_plugin')}
                onPluginIncluded={() => runAdminAction('set_plugin_included')}
                onPluginNotIncluded={() => runAdminAction('set_plugin_not_included')}
                onDeactivate={() => runAdminAction('deactivate_plan')}
                onBlockAccount={() => runAdminAction('block_account')}
                onUnblockAccount={() => runAdminAction('unblock_account')}
                accountBlocked={selectedChat.accessBlocked === true || selectedChat.accountBlock?.active === true}
              />
            )}
            <ChatMessages
              messages={visibleMessages}
              perspective="admin"
              pluginIncluded={selectedChat.plugin?.included !== false}
              paymentLinks={activePaymentLinks}
              pluginPaymentLink={activePluginPaymentLink}
              paymentProvider={paymentProvider}
              selectedDevice={selectedChat.leadProfile?.device || ''}
              paidPlan={selectedChatPaidPlan}
              onEditMessage={handleEditMessage}
              onDeleteMessage={handleDeleteMessage}
            />
            <SavedReplies onPick={setDraft} onSend={handleSend} quickActions={quickReplyActions} />
            {draft && (
              <div className="draft-bar">
                <span>{draft}</span>
                <button
                  type="button"
                  onClick={() => {
                    handleSend(draft)
                    setDraft('')
                  }}
                >
                  Usar
                </button>
              </div>
            )}
            <MessageComposer disabled={!selectedChat} placeholder="Digite como atendente" onSend={handleSend} />
          </>
        ) : (
          <div className="state-message">
            As mensagens aparecem aqui quando voce escolher um cliente.
          </div>
        )}
      </section>
    </main>
  )
}
