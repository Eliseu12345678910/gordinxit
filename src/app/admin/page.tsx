'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { verifyAdminSession, signInAdmin } from '@/lib/admin-session'
import { auth } from '@/lib/firebase'
import {
  listenChats,
  loadAdminSettings,
  paymentProviderLabels,
  planOptions,
  updateChatFunnel,
  updatePaymentProviderSetting,
} from '@/lib/chat'
import type { Chat, FunnelStatus, PaymentProvider, PlanType } from '@/types/chat'

const deviceLabels = {
  android: 'Android',
  ios: 'iOS',
  emulator: 'Emulador (PC)',
} as const

function formatPhone(value?: string) {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.length <= 2) return value || 'Sem telefone'
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`
}

function formatDate(value: Chat['updatedAt']) {
  const date = value?.toDate?.()
  if (!date) return 'Sem data'
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusLabel(chat: Chat) {
  if (chat.accessBlocked || chat.accountBlock?.active) return 'Bloqueado'
  if (chat.subscription?.status === 'active') return 'Plano ativo'
  if (chat.payment?.status === 'paid') return 'Pago'
  if (chat.payment?.status === 'opened') return 'Checkout aberto'
  if (chat.funnelStatus === 'deactivated') return 'Desativado'
  if (chat.selectedPlan?.plan) return 'Plano escolhido'
  return 'Novo'
}

function planLabel(plan?: string) {
  if (!plan) return 'Sem plano'
  return planOptions.find((option) => option.value === plan)?.label || plan
}

function getActivePlan(chat: Chat | null) {
  if (!chat) return ''
  if (chat.subscription?.status === 'active' && chat.subscription.plan) return chat.subscription.plan
  if (chat.payment?.status === 'paid' && chat.payment.plan && chat.payment.plan !== 'plugin') return chat.payment.plan
  return ''
}

function getPaymentCode(chat: Chat | null) {
  return chat?.payment?.code || chat?.id || ''
}

function searchHaystack(chat: Chat) {
  return [
    chat.accessUsername,
    chat.usernameKey,
    chat.accountId,
    chat.id,
    chat.payment?.code,
    chat.payment?.customer?.name,
    chat.payment?.customer?.email,
    chat.payment?.customer?.phone,
    chat.leadProfile?.deviceLabel,
    chat.selectedPlan?.label,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function LoginPanel({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')

    try {
      await signInAdmin(email.trim(), password)
      onLoggedIn()
    } catch {
      setError('Admin invalido.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="new-admin-login">
      <form className="new-admin-login-card" onSubmit={handleSubmit}>
        <span>Painel admin</span>
        <h1>Entrar</h1>
        <label>
          <small>E-mail</small>
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
        </label>
        <label>
          <small>Senha</small>
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
        </label>
        {error && <strong>{error}</strong>}
        <button type="submit" disabled={busy}>{busy ? 'Entrando...' : 'Entrar no admin'}</button>
      </form>
      <AdminStyles />
    </main>
  )
}

function ClientList({
  chats,
  selectedId,
  onSelect,
}: {
  chats: Chat[]
  selectedId?: string
  onSelect: (chat: Chat) => void
}) {
  return (
    <div className="new-admin-list">
      {chats.map((chat) => (
        <button
          key={chat.id}
          type="button"
          className={selectedId === chat.id ? 'active' : ''}
          onClick={() => onSelect(chat)}
        >
          <div>
            <strong>{formatPhone(chat.accessUsername || chat.usernameKey)}</strong>
            <small>{formatDate(chat.updatedAt || chat.createdAt)}</small>
          </div>
          <span className={`status-pill ${statusLabel(chat).toLowerCase().replace(/\s/g, '-')}`}>
            {statusLabel(chat)}
          </span>
          <p>
            {chat.leadProfile?.deviceLabel || 'Sem dispositivo'} | {planLabel(chat.selectedPlan?.plan || getActivePlan(chat))}
          </p>
        </button>
      ))}
    </div>
  )
}

function StatCards({ chats }: { chats: Chat[] }) {
  const stats = useMemo(() => {
    const paid = chats.filter((chat) => chat.payment?.status === 'paid').length
    const active = chats.filter((chat) => getActivePlan(chat)).length
    const plugin = chats.filter((chat) => chat.plugin?.status === 'active').length
    const opened = chats.filter((chat) => chat.payment?.status === 'opened').length

    return [
      { label: 'Clientes', value: chats.length },
      { label: 'Planos ativos', value: active },
      { label: 'Pagos', value: paid },
      { label: 'Checkout aberto', value: opened },
      { label: 'Plugins ativos', value: plugin },
    ]
  }, [chats])

  return (
    <section className="new-admin-stats">
      {stats.map((item) => (
        <article key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </article>
      ))}
    </section>
  )
}

function DetailPanel({
  chat,
  busy,
  actionStatus,
  onAction,
}: {
  chat: Chat | null
  busy: boolean
  actionStatus: string
  onAction: (action: FunnelStatus | 'paid' | 'deactivate_plan' | 'activate_plugin' | 'set_plugin_included' | 'set_plugin_not_included' | 'block_account' | 'unblock_account', plan?: PlanType) => void
}) {
  if (!chat) {
    return (
      <section className="new-admin-detail empty">
        <h2>Selecione um cliente</h2>
        <p>Pesquise por telefone, codigo da compra, e-mail ou ID para administrar a conta.</p>
      </section>
    )
  }

  const accountBlocked = chat.accessBlocked === true || chat.accountBlock?.active === true
  const activePlan = getActivePlan(chat)
  const paymentCode = getPaymentCode(chat)
  const pluginActive = chat.plugin?.status === 'active'

  return (
    <section className="new-admin-detail">
      <header>
        <div>
          <span>Cliente</span>
          <h2>{formatPhone(chat.accessUsername || chat.usernameKey)}</h2>
          <p>{chat.id}</p>
        </div>
        <strong className={`status-pill ${statusLabel(chat).toLowerCase().replace(/\s/g, '-')}`}>
          {statusLabel(chat)}
        </strong>
      </header>

      {actionStatus && <p className="admin-action-status">{actionStatus}</p>}

      <div className="new-admin-info-grid">
        <article>
          <span>Telefone/login</span>
          <strong>{formatPhone(chat.accessUsername || chat.usernameKey)}</strong>
        </article>
        <article>
          <span>Dispositivo</span>
          <strong>
            {chat.leadProfile?.device
              ? deviceLabels[chat.leadProfile.device]
              : chat.leadProfile?.deviceLabel || 'Nao escolhido'}
          </strong>
        </article>
        <article>
          <span>Plano escolhido</span>
          <strong>{planLabel(chat.selectedPlan?.plan)}</strong>
        </article>
        <article>
          <span>Plano ativo</span>
          <strong>{activePlan ? planLabel(activePlan) : 'Nenhum'}</strong>
        </article>
        <article>
          <span>Plugin</span>
          <strong>{pluginActive ? 'Ativo' : chat.plugin?.included === false ? 'Nao incluso' : 'Incluso/Pendente'}</strong>
        </article>
        <article>
          <span>Pagamento</span>
          <strong>{chat.payment?.status || 'Sem pagamento'}</strong>
        </article>
        <article className="wide">
          <span>Codigo da compra</span>
          <strong>{paymentCode}</strong>
        </article>
        <article className="wide">
          <span>Cliente no checkout</span>
          <strong>{chat.payment?.customer?.name || chat.payment?.customer?.email || chat.payment?.customer?.phone || 'Sem dados'}</strong>
        </article>
      </div>

      <section className="new-admin-actions">
        <div>
          <span>Pagamento e plano</span>
          <button type="button" disabled={busy} onClick={() => onAction('paid')}>
            Marcar pago
          </button>
          {planOptions.map((plan) => (
            <button key={plan.value} type="button" disabled={busy} onClick={() => onAction('activated', plan.value)}>
              Ativar {plan.label}
            </button>
          ))}
          <button className="danger" type="button" disabled={busy} onClick={() => onAction('deactivate_plan')}>
            Retirar plano
          </button>
        </div>

        <div>
          <span>Plugin</span>
          <button type="button" disabled={busy} onClick={() => onAction('set_plugin_included')}>
            Plugin incluso
          </button>
          <button type="button" disabled={busy} onClick={() => onAction('set_plugin_not_included')}>
            Plugin nao incluso
          </button>
          <button type="button" disabled={busy} onClick={() => onAction('activate_plugin')}>
            Ativar plugin
          </button>
        </div>

        <div>
          <span>Conta</span>
          {accountBlocked ? (
            <button type="button" disabled={busy} onClick={() => onAction('unblock_account')}>
              Liberar conta
            </button>
          ) : (
            <button className="danger" type="button" disabled={busy} onClick={() => onAction('block_account')}>
              Bloquear conta
            </button>
          )}
        </div>
      </section>
    </section>
  )
}

export default function AdminPage() {
  const [authReady, setAuthReady] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [chats, setChats] = useState<Chat[]>([])
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [paymentProvider, setPaymentProvider] = useState<PaymentProvider>('perfect-pay')
  const [providerBusy, setProviderBusy] = useState(false)

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      const allowed = await verifyAdminSession(user).catch(() => false)
      setIsLoggedIn(allowed)
      setAuthReady(true)
    })
  }, [])

  useEffect(() => {
    if (!isLoggedIn) return undefined
    return listenChats(setChats)
  }, [isLoggedIn])

  useEffect(() => {
    if (!isLoggedIn) return

    loadAdminSettings()
      .then((settings) => {
        if (settings.paymentProvider === 'kiwify' || settings.paymentProvider === 'perfect-pay') {
          setPaymentProvider(settings.paymentProvider)
        }
      })
      .catch(() => undefined)
  }, [isLoggedIn])

  useEffect(() => {
    if (!selectedChat) return
    const updated = chats.find((chat) => chat.id === selectedChat.id)
    if (updated) setSelectedChat(updated)
  }, [chats, selectedChat])

  const filteredChats = useMemo(() => {
    const cleanSearch = search.trim().toLowerCase()
    if (!cleanSearch) return chats
    return chats.filter((chat) => searchHaystack(chat).includes(cleanSearch))
  }, [chats, search])

  async function handleLogout() {
    await signOut(auth)
    setIsLoggedIn(false)
    setSelectedChat(null)
    setChats([])
  }

  async function handleProviderChange(nextProvider: PaymentProvider) {
    if (providerBusy || nextProvider === paymentProvider) return
    setProviderBusy(true)
    setStatus(`Mudando checkout para ${paymentProviderLabels[nextProvider]}...`)

    try {
      const settings = await updatePaymentProviderSetting(nextProvider)
      setPaymentProvider(settings.paymentProvider || nextProvider)
      setStatus(`Checkout ativo: ${paymentProviderLabels[nextProvider]}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Nao foi possivel mudar o checkout.')
    } finally {
      setProviderBusy(false)
    }
  }

  async function handleAction(
    action: FunnelStatus | 'paid' | 'deactivate_plan' | 'activate_plugin' | 'set_plugin_included' | 'set_plugin_not_included' | 'block_account' | 'unblock_account',
    plan?: PlanType,
  ) {
    if (!selectedChat || busy) return
    setBusy(true)
    setStatus('Atualizando cliente...')

    try {
      await updateChatFunnel({
        chatId: selectedChat.id,
        action,
        plan,
        paymentProvider,
      })
      setStatus('Cliente atualizado.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Nao foi possivel atualizar.')
    } finally {
      setBusy(false)
    }
  }

  if (!authReady) return <main className="new-admin-page" aria-hidden="true" />
  if (!isLoggedIn) return <LoginPanel onLoggedIn={() => setIsLoggedIn(true)} />

  return (
    <main className="new-admin-page">
      <aside className="new-admin-sidebar">
        <header className="new-admin-title">
          <div>
            <span>Painel admin</span>
            <h1>Clientes e compras</h1>
          </div>
          <button type="button" onClick={handleLogout}>Sair</button>
        </header>

        <StatCards chats={chats} />

        <section className="new-admin-provider">
          <div>
            <span>Checkout ativo</span>
            <strong>{paymentProviderLabels[paymentProvider]}</strong>
          </div>
          <div>
            {(['perfect-pay', 'kiwify'] as PaymentProvider[]).map((provider) => (
              <button
                key={provider}
                type="button"
                className={paymentProvider === provider ? 'active' : ''}
                disabled={providerBusy}
                onClick={() => handleProviderChange(provider)}
              >
                {paymentProviderLabels[provider]}
              </button>
            ))}
          </div>
        </section>

        <label className="new-admin-search">
          <span>Pesquisar</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Telefone, codigo, email, id..."
          />
        </label>

        <ClientList chats={filteredChats} selectedId={selectedChat?.id} onSelect={setSelectedChat} />
      </aside>

      <DetailPanel chat={selectedChat} busy={busy} actionStatus={status} onAction={handleAction} />
      <AdminStyles />
    </main>
  )
}

function AdminStyles() {
  return (
    <style jsx global>{`
      .new-admin-page,
      .new-admin-login {
        min-height: 100vh;
        background: #eef2f7;
        color: #0f172a;
      }

      .new-admin-login {
        display: grid;
        place-items: center;
        padding: 16px;
      }

      .new-admin-login-card {
        width: min(100%, 420px);
        display: grid;
        gap: 14px;
        border: 1px solid #dbe3ee;
        border-radius: 8px;
        background: #ffffff;
        padding: 22px;
        box-shadow: 0 24px 70px rgba(15, 23, 42, 0.14);
      }

      .new-admin-login-card span,
      .new-admin-title span,
      .new-admin-provider span,
      .new-admin-search span,
      .new-admin-detail header span,
      .new-admin-info-grid span,
      .new-admin-actions span,
      .new-admin-stats span {
        color: #64748b;
        font-size: 12px;
        font-weight: 950;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .new-admin-login-card h1,
      .new-admin-title h1,
      .new-admin-detail h2 {
        margin: 0;
        color: #0f172a;
        letter-spacing: 0;
      }

      .new-admin-login-card label {
        display: grid;
        gap: 6px;
      }

      .new-admin-login-card input,
      .new-admin-search input {
        width: 100%;
        min-height: 44px;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        padding: 0 12px;
        outline: none;
      }

      .new-admin-login-card input:focus,
      .new-admin-search input:focus {
        border-color: #0ea5e9;
        box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.14);
      }

      .new-admin-login-card button,
      .new-admin-title button,
      .new-admin-provider button,
      .new-admin-actions button {
        min-height: 40px;
        border-radius: 8px;
        background: #0f172a;
        color: #ffffff;
        padding: 0 12px;
        font-weight: 900;
      }

      .new-admin-login-card strong,
      .admin-action-status {
        border: 1px solid #fecaca;
        border-radius: 8px;
        background: #fff7f7;
        color: #b91c1c;
        padding: 10px;
        font-size: 13px;
      }

      .new-admin-page {
        display: grid;
        grid-template-columns: minmax(340px, 430px) minmax(0, 1fr);
        gap: 14px;
        padding: 14px;
      }

      .new-admin-sidebar,
      .new-admin-detail {
        border: 1px solid #dbe3ee;
        border-radius: 8px;
        background: #ffffff;
        box-shadow: 0 18px 44px rgba(15, 23, 42, 0.08);
      }

      .new-admin-sidebar {
        min-height: calc(100vh - 28px);
        display: grid;
        grid-template-rows: auto auto auto auto 1fr;
        gap: 12px;
        padding: 12px;
      }

      .new-admin-title {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: flex-start;
      }

      .new-admin-title h1 {
        margin-top: 4px;
        font-size: 26px;
        line-height: 1;
      }

      .new-admin-title button {
        background: #fff7f7;
        color: #b91c1c;
        border: 1px solid #fecaca;
      }

      .new-admin-stats {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      .new-admin-stats article,
      .new-admin-provider,
      .new-admin-info-grid article {
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #f8fafc;
        padding: 10px;
      }

      .new-admin-stats strong {
        display: block;
        margin-top: 4px;
        font-size: 26px;
      }

      .new-admin-provider {
        display: grid;
        gap: 10px;
      }

      .new-admin-provider > div:last-child {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px;
      }

      .new-admin-provider button {
        background: #e2e8f0;
        color: #334155;
      }

      .new-admin-provider button.active {
        background: #0f172a;
        color: #ffffff;
      }

      .new-admin-search {
        display: grid;
        gap: 6px;
      }

      .new-admin-list {
        min-height: 0;
        overflow: auto;
        display: grid;
        align-content: start;
        gap: 8px;
        padding-right: 2px;
      }

      .new-admin-list button {
        display: grid;
        gap: 8px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #ffffff;
        color: #0f172a;
        padding: 10px;
        text-align: left;
      }

      .new-admin-list button.active {
        border-color: #0ea5e9;
        background: #e0f2fe;
      }

      .new-admin-list button > div {
        display: flex;
        justify-content: space-between;
        gap: 8px;
      }

      .new-admin-list small,
      .new-admin-list p,
      .new-admin-detail header p {
        margin: 0;
        color: #64748b;
        font-size: 12px;
        font-weight: 800;
      }

      .status-pill {
        width: fit-content;
        border: 1px solid #cbd5e1;
        border-radius: 999px;
        background: #f8fafc;
        color: #334155;
        padding: 5px 8px;
        font-size: 11px;
        font-weight: 950;
      }

      .status-pill.plano-ativo,
      .status-pill.pago {
        border-color: #bbf7d0;
        background: #f0fdf4;
        color: #166534;
      }

      .status-pill.bloqueado,
      .status-pill.desativado {
        border-color: #fecaca;
        background: #fff7f7;
        color: #b91c1c;
      }

      .status-pill.checkout-aberto {
        border-color: #fed7aa;
        background: #fff7ed;
        color: #c2410c;
      }

      .new-admin-detail {
        min-height: calc(100vh - 28px);
        display: grid;
        align-content: start;
        gap: 14px;
        padding: 16px;
      }

      .new-admin-detail.empty {
        place-content: center;
        text-align: center;
      }

      .new-admin-detail header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        border-bottom: 1px solid #e2e8f0;
        padding-bottom: 14px;
      }

      .new-admin-detail h2 {
        margin-top: 4px;
        font-size: clamp(32px, 5vw, 54px);
        line-height: 0.92;
      }

      .new-admin-info-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
      }

      .new-admin-info-grid article {
        display: grid;
        gap: 4px;
      }

      .new-admin-info-grid article.wide {
        grid-column: span 3;
      }

      .new-admin-info-grid strong {
        min-width: 0;
        color: #0f172a;
        overflow-wrap: anywhere;
      }

      .new-admin-actions {
        display: grid;
        gap: 12px;
      }

      .new-admin-actions > div {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        border-top: 1px solid #e2e8f0;
        padding-top: 12px;
      }

      .new-admin-actions span {
        flex: 0 0 100%;
      }

      .new-admin-actions button {
        background: #0ea5e9;
        color: #ffffff;
      }

      .new-admin-actions button.danger {
        background: #dc2626;
      }

      .new-admin-actions button:disabled {
        cursor: wait;
        opacity: 0.65;
      }

      @media (max-width: 980px) {
        .new-admin-page {
          grid-template-columns: 1fr;
        }

        .new-admin-sidebar,
        .new-admin-detail {
          min-height: auto;
        }

        .new-admin-list {
          max-height: 520px;
        }
      }

      @media (max-width: 640px) {
        .new-admin-page {
          padding: 8px;
        }

        .new-admin-info-grid {
          grid-template-columns: 1fr;
        }

        .new-admin-info-grid article.wide {
          grid-column: auto;
        }
      }
    `}</style>
  )
}
