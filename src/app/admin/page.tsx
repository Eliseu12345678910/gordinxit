'use client'

import { FormEvent, useEffect, useMemo, useState, type ReactNode } from 'react'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { verifyAdminSession, signInAdmin } from '@/lib/admin-session'
import {
  defaultAppUpdateSettings,
  loadAppUpdateSettings,
  saveAppUpdateSettings,
  type AppUpdateSettings,
} from '@/lib/app-update'
import { auth } from '@/lib/firebase'
import { formatPhoneOrUsername } from '@/lib/phone'
import {
  listenChats,
  loadAdminSettings,
  paymentProviderLabels,
  planOptions,
  updateChatFunnel,
  updatePaymentProviderSetting,
} from '@/lib/chat'
import {
  defaultPcAccessSettings,
  loadPcAccessSettings,
  savePcAccessSettings,
  type PcAccessDownloadFile,
  type PcAccessSettings,
} from '@/lib/pc-access'
import type { Chat, FunnelStatus, PaymentProvider, PlanType, ResellerAccessType } from '@/types/chat'

type AdminAction =
  | FunnelStatus
  | 'paid'
  | 'deactivate_plan'
  | 'activate_plugin'
  | 'set_plugin_included'
  | 'set_plugin_not_included'
  | 'block_account'
  | 'unblock_account'

type AppUpdateDraft = {
  enabled: boolean
  required: boolean
  latestVersionCode: string
  latestVersionName: string
  apkUrl: string
  message: string
  changelog: string
}

type AdminView = 'clients' | 'pc' | 'prices'
type PcResourceKey = 'files' | 'tutorials' | 'fixErrors'
type PriceContext = 'gordin' | 'internal' | 'external'

type PlanPriceDraft = {
  label: string
  amountCents: string
  priceLabel: string
  normalPriceLabel?: string
}

type PriceSettingsDraft = Record<PriceContext, Record<PlanType, PlanPriceDraft>>

const deviceLabels = {
  android: 'Android',
  ios: 'iOS',
  emulator: 'Emulador (PC)',
} as const

function formatPhone(value?: string) {
  return formatPhoneOrUsername(value)
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

function isPcClient(chat: Chat | null) {
  return chat?.leadProfile?.device === 'emulator'
}

function resellerAccessLabel(type?: ResellerAccessType) {
  if (type === 'internal') return 'Internal'
  if (type === 'external') return 'External'
  return ''
}

function getActiveResellerAccess(chat: Chat | null): ResellerAccessType | undefined {
  if (!chat?.resellerAccess) return undefined
  if (chat.resellerAccess.internal?.status === 'active') return 'internal'
  if (chat.resellerAccess.external?.status === 'active') return 'external'
  return undefined
}

function getSelectedResellerAccess(chat: Chat | null): ResellerAccessType | undefined {
  return chat?.resellerPurchases?.find((purchase) => purchase.accessType)?.accessType || getActiveResellerAccess(chat)
}

function getPcClientSummary(chat: Chat) {
  const activeAccess = getActiveResellerAccess(chat)
  const selectedAccess = getSelectedResellerAccess(chat)
  const accessText = resellerAccessLabel(activeAccess || selectedAccess) || 'sem tipo'
  const lastPurchase = chat.resellerPurchases?.find((purchase) => purchase.accessType === (activeAccess || selectedAccess))
  const planText = planLabel(lastPurchase?.plan || chat.payment?.plan)
  return `Emulador (PC) | ${accessText}${planText !== 'Sem plano' ? ` | ${planText}` : ''}`
}

function getActivePlan(chat: Chat | null) {
  if (!chat) return ''
  if (chat.subscription?.status === 'active' && chat.subscription.plan) return chat.subscription.plan
  if (chat.payment?.status === 'paid' && chat.payment.plan && chat.payment.plan !== 'plugin') return chat.payment.plan
  return ''
}

function getPaymentCode(chat: Chat | null) {
  return chat?.payment?.code || chat?.payment?.platformCode || chat?.id || ''
}

function getPlatformCode(chat: Chat | null) {
  return chat?.payment?.platformCode || chat?.payment?.code || ''
}

function getEventCode(chat: Chat | null) {
  return chat?.payment?.eventId || ''
}

function getPlanExpiry(chat: Chat | null) {
  const expiresAt = chat?.subscription?.expiresAt?.toDate?.()
  if (!chat?.subscription?.plan) return 'Sem plano'
  if (!expiresAt) return 'Permanente'
  return expiresAt.toLocaleDateString('pt-BR')
}

function getResellerExpiry(chat: Chat | null, type: ResellerAccessType) {
  const expiresAt = chat?.resellerAccess?.[type]?.expiresAt?.toDate?.()
  if (chat?.resellerAccess?.[type]?.status !== 'active') return 'Sem acesso'
  if (!expiresAt) return 'Permanente'
  return expiresAt.toLocaleDateString('pt-BR')
}

function paymentStatusLabel(status?: string) {
  const labels: Record<string, string> = {
    paid: 'Pago',
    opened: 'Checkout aberto',
    link_sent: 'Link enviado',
    refunded: 'Reembolsado',
    rejected: 'Recusado',
    cancelled: 'Cancelado',
    pending: 'Pendente',
  }

  return status ? labels[status] || status : 'Sem pagamento'
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

function centsToInput(value: unknown) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return ''
  return (numeric / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function inputToCents(value: string) {
  const clean = value.replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
  const numeric = Number(clean)
  if (!Number.isFinite(numeric)) return null
  return Math.round(numeric * 100)
}

function makeEmptyPriceDraft(): PriceSettingsDraft {
  function makeContext() {
    return planOptions.reduce((result, plan) => {
      result[plan.value] = {
        label: plan.label,
        amountCents: centsToInput(Math.round(plan.price * 100)),
        priceLabel: plan.priceLabel,
      }
      return result
    }, {} as Record<PlanType, PlanPriceDraft>)
  }

  return {
    gordin: makeContext(),
    internal: makeContext(),
    external: makeContext(),
  }
}

function makePlanPricePayload(draft: PriceSettingsDraft) {
  return (['gordin', 'internal', 'external'] as PriceContext[]).reduce((contexts, context) => {
    contexts[context] = planOptions.reduce((plans, plan) => {
      const amountCents = inputToCents(draft[context][plan.value].amountCents)
      if (!amountCents || amountCents < 100 || amountCents > 100000) {
        throw new Error(`Valor invalido em ${priceContextLabels[context].title} / ${plan.label}.`)
      }
      plans[plan.value] = { amountCents }
      return plans
    }, {} as Record<PlanType, { amountCents: number }>)
    return contexts
  }, {} as Record<PriceContext, Record<PlanType, { amountCents: number }>>)
}

function searchHaystack(chat: Chat) {
  return [
    chat.accessUsername,
    chat.usernameKey,
    chat.accountId,
    chat.id,
    chat.payment?.code,
    chat.payment?.platformCode,
    chat.payment?.eventId,
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
            {isPcClient(chat)
              ? getPcClientSummary(chat)
              : `${chat.leadProfile?.deviceLabel || 'Sem dispositivo'} | ${planLabel(chat.selectedPlan?.plan || getActivePlan(chat))}`}
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

function AppDownloadSettingsPanel() {
  const [draft, setDraft] = useState<AppUpdateDraft>(() => makeAppUpdateDraft())
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Carregando configuracao do download...')

  useEffect(() => {
    let active = true

    loadAppUpdateSettings()
      .then((settings) => {
        if (!active) return
        setDraft(makeAppUpdateDraft(settings))
        setStatus(
          settings.apkUrl
            ? `Download cadastrado: v${settings.latestVersionName || settings.latestVersionCode}.`
            : 'Cadastre o link do APK para liberar o download.',
        )
      })
      .catch((error) => {
        if (active) {
          setStatus(error instanceof Error ? error.message : 'Nao foi possivel carregar o download.')
        }
      })

    return () => {
      active = false
    }
  }, [])

  function updateDraft<Key extends keyof AppUpdateDraft>(key: Key, value: AppUpdateDraft[Key]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return

    const latestVersionCode = Number.parseInt(draft.latestVersionCode, 10)
    if (!Number.isFinite(latestVersionCode) || latestVersionCode < 1) {
      setStatus('Use um version code maior que zero.')
      return
    }

    if (draft.enabled && !draft.apkUrl.trim()) {
      setStatus('Informe o link do APK antes de ligar o download.')
      return
    }

    setBusy(true)
    setStatus('Salvando download do xit...')

    try {
      const settings = await saveAppUpdateSettings({
        enabled: draft.enabled,
        required: draft.required,
        latestVersionCode,
        latestVersionName: draft.latestVersionName.trim() || String(latestVersionCode),
        apkUrl: draft.apkUrl.trim(),
        message: draft.message.trim() || defaultAppUpdateSettings.message,
        changelog: draft.changelog.trim(),
      })
      setDraft(makeAppUpdateDraft(settings))
      setStatus(settings.apkUrl ? `Download salvo: v${settings.latestVersionName}.` : 'Download salvo sem link cadastrado.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Nao foi possivel salvar o download.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={`new-admin-download ${open ? 'open' : ''}`}>
      <button className="new-admin-download-toggle" type="button" onClick={() => setOpen((current) => !current)}>
        <div>
          <span>Download do xit</span>
          <strong>{draft.apkUrl ? `v${draft.latestVersionName || draft.latestVersionCode}` : 'Sem APK'}</strong>
        </div>
        <b>{open ? 'Fechar' : 'Abrir'}</b>
      </button>

      {open && (
        <form className="new-admin-download-form" onSubmit={handleSubmit}>
          <div className="new-admin-download-grid">
            <label>
              <small>Version code</small>
              <input
                value={draft.latestVersionCode}
                onChange={(event) => updateDraft('latestVersionCode', event.target.value)}
                inputMode="numeric"
                placeholder="2"
              />
            </label>
            <label>
              <small>Versao</small>
              <input
                value={draft.latestVersionName}
                onChange={(event) => updateDraft('latestVersionName', event.target.value)}
                placeholder="1.1"
              />
            </label>
          </div>

          <label>
            <small>Link do APK</small>
            <input
              value={draft.apkUrl}
              onChange={(event) => updateDraft('apkUrl', event.target.value)}
              placeholder="https://..."
            />
          </label>

          <label>
            <small>Mensagem para o app</small>
            <input
              value={draft.message}
              onChange={(event) => updateDraft('message', event.target.value)}
              placeholder="Nova versao disponivel"
            />
          </label>

          <label>
            <small>Notas da versao</small>
            <textarea
              value={draft.changelog}
              onChange={(event) => updateDraft('changelog', event.target.value)}
              placeholder="O que mudou nesta versao"
            />
          </label>

          <div className="new-admin-download-switches">
            <label>
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => updateDraft('enabled', event.target.checked)}
              />
              <span>Ligar download</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.required}
                onChange={(event) => updateDraft('required', event.target.checked)}
              />
              <span>Atualizacao obrigatoria</span>
            </label>
          </div>

          <button type="submit" disabled={busy}>{busy ? 'Salvando...' : 'Salvar download'}</button>
          {status && <small className="new-admin-download-status">{status}</small>}
        </form>
      )}
    </section>
  )
}

const priceContextLabels: Record<PriceContext, { title: string; description: string }> = {
  gordin: {
    title: 'Gordin du Xit',
    description: 'Altera o valor visual exibido nas pays normais. A cobranca real continua no checkout externo.',
  },
  internal: {
    title: 'Internal',
    description: 'Altera o visual e o valor seguro usado pelo Pix interno no servidor.',
  },
  external: {
    title: 'External',
    description: 'Altera o visual e o valor seguro usado pelo Pix externo no servidor.',
  },
}

function PriceSettingsPanel() {
  const [draft, setDraft] = useState<PriceSettingsDraft>(() => makeEmptyPriceDraft())
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Carregando valores...')

  useEffect(() => {
    let active = true

    async function loadPrices() {
      try {
        const user = auth.currentUser
        if (!user || user.isAnonymous) throw new Error('Admin nao autenticado.')
        const idToken = await user.getIdToken()
        const response = await fetch('/api/chat/admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken, action: 'get_price_settings' }),
        })
        const payload = await response.json() as PriceSettingsDraft & { error?: string }
        if (!response.ok) throw new Error(payload.error || 'Nao foi possivel carregar os valores.')
        if (!active) return

        setDraft((current) => {
          const next = makeEmptyPriceDraft()
          ;(['gordin', 'internal', 'external'] as PriceContext[]).forEach((context) => {
            planOptions.forEach((plan) => {
              const raw = payload[context]?.[plan.value]
              next[context][plan.value] = {
                label: raw?.label || plan.label,
                amountCents: centsToInput(raw?.amountCents),
                priceLabel: raw?.priceLabel || plan.priceLabel,
                normalPriceLabel: raw?.normalPriceLabel,
              }
            })
          })
          return next
        })
        setStatus('Valores carregados.')
      } catch (error) {
        if (active) setStatus(error instanceof Error ? error.message : 'Nao foi possivel carregar os valores.')
      }
    }

    loadPrices()
    return () => {
      active = false
    }
  }, [])

  function updatePrice(context: PriceContext, plan: PlanType, amountCents: string) {
    setDraft((current) => ({
      ...current,
      [context]: {
        ...current[context],
        [plan]: {
          ...current[context][plan],
          amountCents,
        },
      },
    }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return

    setBusy(true)
    setStatus('Salvando valores...')

    try {
      const priceSettings = makePlanPricePayload(draft)
      const user = auth.currentUser
      if (!user || user.isAnonymous) throw new Error('Admin nao autenticado.')
      const idToken = await user.getIdToken()
      const response = await fetch('/api/chat/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, action: 'set_price_settings', priceSettings }),
      })
      const payload = await response.json() as PriceSettingsDraft & { error?: string }
      if (!response.ok) throw new Error(payload.error || 'Nao foi possivel salvar os valores.')
      setStatus('Valores salvos.')
      setDraft((current) => {
        const next = { ...current }
        ;(['gordin', 'internal', 'external'] as PriceContext[]).forEach((context) => {
          next[context] = { ...next[context] }
          planOptions.forEach((plan) => {
            const raw = payload[context]?.[plan.value]
            next[context][plan.value] = {
              ...next[context][plan.value],
              amountCents: centsToInput(raw?.amountCents),
              priceLabel: raw?.priceLabel || next[context][plan.value].priceLabel,
            }
          })
        })
        return next
      })
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Nao foi possivel salvar os valores.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="new-admin-prices-page">
      <header className="new-admin-pc-page-head">
        <div>
          <span>Valores</span>
          <h2>Planos e Pix</h2>
          <p>Controle o visual dos planos e os valores usados pelo Pix Internal/External.</p>
        </div>
        <button type="submit" form="price-settings-form" disabled={busy}>{busy ? 'Salvando...' : 'Salvar valores'}</button>
      </header>

      <form id="price-settings-form" className="new-admin-prices-form" onSubmit={handleSubmit}>
        {(['gordin', 'internal', 'external'] as PriceContext[]).map((context) => (
          <section className="new-admin-price-context" key={context}>
            <header>
              <strong>{priceContextLabels[context].title}</strong>
              <small>{priceContextLabels[context].description}</small>
            </header>
            <div>
              {planOptions.map((plan) => (
                <label key={`${context}-${plan.value}`}>
                  <span>{plan.label}</span>
                  <input
                    value={draft[context][plan.value].amountCents}
                    onChange={(event) => updatePrice(context, plan.value, event.target.value)}
                    inputMode="decimal"
                    placeholder="1,00"
                  />
                </label>
              ))}
            </div>
          </section>
        ))}
        {status && <small className="new-admin-download-status">{status}</small>}
      </form>
    </section>
  )
}

const pcResourceLabels: Record<PcResourceKey, { title: string; label: string; url: string; add: string }> = {
  files: {
    title: 'Arquivos de download',
    label: 'Nome do arquivo',
    url: 'Link do arquivo',
    add: 'Adicionar arquivo',
  },
  tutorials: {
    title: 'Tutoriais',
    label: 'Nome do tutorial',
    url: 'Link do tutorial',
    add: 'Adicionar tutorial',
  },
  fixErrors: {
    title: 'Fix errors',
    label: 'Erro ou solucao',
    url: 'Link do fix',
    add: 'Adicionar fix',
  },
}

function PcResourceEditor({
  items,
  resourceKey,
  accessType,
  onChange,
  onAdd,
  onRemove,
}: {
  items: PcAccessDownloadFile[]
  resourceKey: PcResourceKey
  accessType: keyof PcAccessSettings
  onChange: (type: keyof PcAccessSettings, key: PcResourceKey, index: number, field: keyof PcAccessDownloadFile, value: string) => void
  onAdd: (type: keyof PcAccessSettings, key: PcResourceKey) => void
  onRemove: (type: keyof PcAccessSettings, key: PcResourceKey, index: number) => void
}) {
  const labels = pcResourceLabels[resourceKey]

  return (
    <section className="new-admin-pc-resource">
      <header>
        <strong>{labels.title}</strong>
        <button type="button" onClick={() => onAdd(accessType, resourceKey)}>{labels.add}</button>
      </header>

      {items.length === 0 ? (
        <p>Nenhum item cadastrado.</p>
      ) : (
        <div className="new-admin-pc-resource-list">
          {items.map((item, index) => (
            <article key={`${resourceKey}-${index}`}>
              <label>
                <small>{labels.label}</small>
                <input
                  value={item.label}
                  onChange={(event) => onChange(accessType, resourceKey, index, 'label', event.target.value)}
                  placeholder={labels.label}
                />
              </label>
              <label>
                <small>{labels.url}</small>
                <input
                  value={item.url}
                  onChange={(event) => onChange(accessType, resourceKey, index, 'url', event.target.value)}
                  placeholder="https://..."
                />
              </label>
              <button type="button" className="danger" onClick={() => onRemove(accessType, resourceKey, index)}>
                Remover
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function PcAccessSettingsPanel() {
  const [settings, setSettings] = useState<PcAccessSettings>(defaultPcAccessSettings)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Carregando downloads PC...')

  useEffect(() => {
    let active = true

    loadPcAccessSettings()
      .then((nextSettings) => {
        if (!active) return
        setSettings(nextSettings)
        setStatus('Downloads PC carregados.')
      })
      .catch((error) => {
        if (active) setStatus(error instanceof Error ? error.message : 'Nao foi possivel carregar downloads PC.')
      })

    return () => {
      active = false
    }
  }, [])

  function updateDownload(type: keyof PcAccessSettings, key: keyof PcAccessSettings['internal'], value: string | boolean) {
    setSettings((current) => ({
      ...current,
      [type]: {
        ...current[type],
        [key]: value,
      },
    }))
  }

  function updateResourceItem(
    type: keyof PcAccessSettings,
    key: PcResourceKey,
    index: number,
    field: keyof PcAccessDownloadFile,
    value: string,
  ) {
    setSettings((current) => ({
      ...current,
      [type]: {
        ...current[type],
        [key]: current[type][key].map((item, itemIndex) => (
          itemIndex === index ? { ...item, [field]: value } : item
        )),
      },
    }))
  }

  function addResourceItem(type: keyof PcAccessSettings, key: PcResourceKey) {
    setSettings((current) => ({
      ...current,
      [type]: {
        ...current[type],
        [key]: [...current[type][key], { label: '', url: '' }],
      },
    }))
  }

  function removeResourceItem(type: keyof PcAccessSettings, key: PcResourceKey, index: number) {
    setSettings((current) => {
      const nextItems = current[type][key].filter((_, itemIndex) => itemIndex !== index)
      return {
        ...current,
        [type]: {
          ...current[type],
          [key]: nextItems,
          ...(key === 'files' && current[type].downloadUrl === current[type][key][index]?.url
            ? { downloadUrl: nextItems[0]?.url || '' }
            : {}),
        },
      }
    })
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return

    setBusy(true)
    setStatus('Salvando downloads PC...')

    try {
      const saved = await savePcAccessSettings(settings)
      setSettings(saved)
      setStatus('Downloads PC salvos.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Nao foi possivel salvar downloads PC.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="new-admin-pc-page">
      <header className="new-admin-pc-page-head">
        <div>
          <span>Central PC</span>
          <h2>Downloads, tutoriais e fix errors</h2>
          <p>Configure separadamente o que aparece para clientes com acesso Internal ou External.</p>
        </div>
        <button type="submit" form="pc-access-settings-form" disabled={busy}>{busy ? 'Salvando...' : 'Salvar Central PC'}</button>
      </header>

      <form id="pc-access-settings-form" className="new-admin-download-form new-admin-pc-form" onSubmit={handleSubmit}>
        {(['internal', 'external'] as const).map((type) => (
          <section className="new-admin-pc-column" key={type}>
            <header>
              <div>
                <span>{type === 'internal' ? 'Plano Internal' : 'Plano External'}</span>
                <strong>{settings[type].title || (type === 'internal' ? 'Internal' : 'External')}</strong>
              </div>
              <label className="new-admin-download-check">
                <input
                  type="checkbox"
                  checked={settings[type].enabled}
                  onChange={(event) => updateDownload(type, 'enabled', event.target.checked)}
                />
                <span>Liberado</span>
              </label>
            </header>

            <div className="new-admin-download-grid">
              <label>
                <small>Nome exibido</small>
                <input
                  value={settings[type].title}
                  onChange={(event) => updateDownload(type, 'title', event.target.value)}
                  placeholder={type === 'internal' ? 'Internal' : 'External'}
                />
              </label>
              <label>
                <small>Versao / destaque</small>
                <input
                  value={settings[type].versionName}
                  onChange={(event) => updateDownload(type, 'versionName', event.target.value)}
                  placeholder="1.0"
                />
              </label>
            </div>

            <label>
              <small>Link principal de download</small>
              <input
                value={settings[type].downloadUrl}
                onChange={(event) => updateDownload(type, 'downloadUrl', event.target.value)}
                placeholder="https://..."
              />
            </label>

            <PcResourceEditor
              accessType={type}
              resourceKey="files"
              items={settings[type].files || []}
              onChange={updateResourceItem}
              onAdd={addResourceItem}
              onRemove={removeResourceItem}
            />
            <PcResourceEditor
              accessType={type}
              resourceKey="tutorials"
              items={settings[type].tutorials || []}
              onChange={updateResourceItem}
              onAdd={addResourceItem}
              onRemove={removeResourceItem}
            />
            <PcResourceEditor
              accessType={type}
              resourceKey="fixErrors"
              items={settings[type].fixErrors || []}
              onChange={updateResourceItem}
              onAdd={addResourceItem}
              onRemove={removeResourceItem}
            />

            <label>
              <small>Link do tutorial principal em video</small>
              <input
                value={settings[type].tutorialUrl}
                onChange={(event) => updateDownload(type, 'tutorialUrl', event.target.value)}
                placeholder="https://..."
              />
            </label>
            <label>
              <small>Observacao para o cliente</small>
              <textarea
                value={settings[type].notes}
                onChange={(event) => updateDownload(type, 'notes', event.target.value)}
                placeholder="Mensagem opcional para aparecer em acesso-pc"
              />
            </label>
          </section>
        ))}

        {status && <small className="new-admin-download-status">{status}</small>}
      </form>
    </section>
  )
}

function ActionButton({
  children,
  busy,
  tone,
  onClick,
}: {
  children: ReactNode
  busy: boolean
  tone?: 'primary' | 'danger' | 'quiet'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={tone || 'primary'}
      disabled={busy}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function ActionSection({
  title,
  description,
  children,
  open,
}: {
  title: string
  description: string
  children: ReactNode
  open?: boolean
}) {
  return (
    <details className="new-admin-action-section" open={open}>
      <summary>
        <span>
          <b>{title}</b>
          <small>{description}</small>
        </span>
        <i aria-hidden="true">Abrir</i>
      </summary>
      <div>{children}</div>
    </details>
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
  onAction: (action: AdminAction, plan?: PlanType) => void
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
  const platformCode = getPlatformCode(chat)
  const eventCode = getEventCode(chat)
  const pluginActive = chat.plugin?.status === 'active'
  const selectedPlan = chat.selectedPlan?.plan
  const availablePlanActions = planOptions.filter((plan) => plan.value !== activePlan)
  const selectedPlanAction = selectedPlan && selectedPlan !== activePlan ? selectedPlan : ''
  const needsPaymentConfirm = chat.payment?.status !== 'paid'
  const pcClient = isPcClient(chat)
  const selectedResellerAccess = getSelectedResellerAccess(chat)
  const activeResellerAccess = getActiveResellerAccess(chat)
  const resellerPurchase = chat.resellerPurchases?.find((purchase) => (
    purchase.accessType === (activeResellerAccess || selectedResellerAccess)
  ))

  return (
    <section className={`new-admin-detail ${pcClient ? 'pc-client' : ''}`}>
      <header>
        <div>
          <span>{pcClient ? 'Cliente emulador / PC' : 'Cliente'}</span>
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
            {pcClient
              ? 'Emulador (PC)'
              : chat.leadProfile?.device
                ? deviceLabels[chat.leadProfile.device]
              : chat.leadProfile?.deviceLabel || 'Nao escolhido'}
          </strong>
        </article>
        {pcClient ? (
          <>
            <article>
              <span>Acesso PC escolhido</span>
              <strong>{resellerAccessLabel(selectedResellerAccess) || 'Nao escolhido'}</strong>
            </article>
            <article>
              <span>Acesso PC ativo</span>
              <strong>{resellerAccessLabel(activeResellerAccess) || 'Nenhum'}</strong>
            </article>
            <article>
              <span>Plano PC</span>
              <strong>{planLabel(resellerPurchase?.plan || chat.payment?.plan)}</strong>
            </article>
          </>
        ) : (
          <>
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
          </>
        )}
        <article>
          <span>Pagamento</span>
          <strong>{paymentStatusLabel(chat.payment?.status)}</strong>
        </article>
        {pcClient ? (
          <>
            <article>
              <span>Internal expira</span>
              <strong>{getResellerExpiry(chat, 'internal')}</strong>
            </article>
            <article>
              <span>External expira</span>
              <strong>{getResellerExpiry(chat, 'external')}</strong>
            </article>
          </>
        ) : (
          <article>
            <span>Expira em</span>
            <strong>{getPlanExpiry(chat)}</strong>
          </article>
        )}
        <article className="wide">
          <span>Codigo pesquisavel</span>
          <strong>{paymentCode}</strong>
        </article>
        {platformCode && platformCode !== paymentCode && (
          <article className="wide">
            <span>Codigo da plataforma</span>
            <strong>{platformCode}</strong>
          </article>
        )}
        {eventCode && (
          <article className="wide muted">
            <span>ID interno do webhook</span>
            <strong>{eventCode}</strong>
          </article>
        )}
        <article className="wide">
          <span>Cliente no checkout</span>
          <strong>
            {chat.payment?.customer?.name ||
              chat.payment?.customer?.email ||
              formatPhone(chat.payment?.customer?.phone) ||
              'Sem dados'}
          </strong>
        </article>
      </div>

      <section className="new-admin-actions">
        <div className="new-admin-quick-actions">
          {needsPaymentConfirm && (
            <ActionButton busy={busy} onClick={() => onAction('paid')}>
              Marcar pagamento como pago
            </ActionButton>
          )}

          {!pcClient && selectedPlanAction && (
            <ActionButton busy={busy} onClick={() => onAction('activated', selectedPlanAction)}>
              Ativar {planLabel(selectedPlanAction)}
            </ActionButton>
          )}

          {!pcClient && activePlan && (
            <ActionButton busy={busy} tone="danger" onClick={() => onAction('deactivate_plan')}>
              Retirar plano ativo
            </ActionButton>
          )}

          {accountBlocked ? (
            <ActionButton busy={busy} tone="quiet" onClick={() => onAction('unblock_account')}>
              Liberar conta
            </ActionButton>
          ) : (
            <ActionButton busy={busy} tone="danger" onClick={() => onAction('block_account')}>
              Bloquear conta
            </ActionButton>
          )}
        </div>

        {pcClient ? (
          <section className="new-admin-pc-notice">
            <strong>Cliente de Emulador/PC</strong>
            <p>Este cliente usa a area de revenda PC. Por isso, as acoes de plano Android/iOS e plugin ficam ocultas aqui.</p>
          </section>
        ) : (
          <>
            <ActionSection
              title="Planos"
              description={activePlan ? `Ativo agora: ${planLabel(activePlan)}` : 'Escolha qual acesso liberar'}
              open={!activePlan}
            >
              {availablePlanActions.map((plan) => (
                <ActionButton
                  key={plan.value}
                  busy={busy}
                  tone={plan.value === selectedPlan ? 'primary' : 'quiet'}
                  onClick={() => onAction('activated', plan.value)}
                >
                  {activePlan ? `Trocar para ${plan.label}` : `Ativar ${plan.label}`}
                </ActionButton>
              ))}
            </ActionSection>

            <ActionSection
              title="Plugin"
              description={pluginActive ? 'ServiceSync Core ativo' : 'Controle de inclusao e ativacao'}
            >
              {chat.plugin?.included !== true && (
                <ActionButton busy={busy} tone="quiet" onClick={() => onAction('set_plugin_included')}>
                  Marcar plugin incluso
                </ActionButton>
              )}
              {chat.plugin?.included !== false && (
                <ActionButton busy={busy} tone="quiet" onClick={() => onAction('set_plugin_not_included')}>
                  Marcar plugin nao incluso
                </ActionButton>
              )}
              {!pluginActive && (
                <ActionButton busy={busy} onClick={() => onAction('activate_plugin')}>
                  Ativar plugin
                </ActionButton>
              )}
              {pluginActive && <p>Plugin ja ativo nesta conta.</p>}
            </ActionSection>
          </>
        )}

        <ActionSection
          title="Conta"
          description={accountBlocked ? 'Cliente bloqueado no portal' : 'Cliente liberado no portal'}
        >
          {accountBlocked ? (
            <ActionButton busy={busy} tone="quiet" onClick={() => onAction('unblock_account')}>
              Liberar acesso
            </ActionButton>
          ) : (
            <ActionButton busy={busy} tone="danger" onClick={() => onAction('block_account')}>
              Bloquear acesso
            </ActionButton>
          )}
        </ActionSection>
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
  const [view, setView] = useState<AdminView>('clients')

  useEffect(() => {
    if (window.location.hash === '#central-pc') setView('pc')
    if (window.location.hash === '#valores') setView('prices')
  }, [])

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

  function handleViewChange(nextView: AdminView) {
    setView(nextView)
    window.history.replaceState(
      null,
      '',
      nextView === 'pc' ? '#central-pc' : nextView === 'prices' ? '#valores' : window.location.pathname,
    )
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
    action: AdminAction,
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

        <section className="new-admin-nav">
          <button
            type="button"
            className={view === 'clients' ? 'active' : ''}
            onClick={() => handleViewChange('clients')}
          >
            <span>Clientes</span>
            <strong>Compras e acessos</strong>
          </button>
          <button
            type="button"
            className={view === 'pc' ? 'active' : ''}
            onClick={() => handleViewChange('pc')}
          >
            <span>Central PC</span>
            <strong>Downloads e tutoriais</strong>
          </button>
          <button
            type="button"
            className={view === 'prices' ? 'active' : ''}
            onClick={() => handleViewChange('prices')}
          >
            <span>Valores</span>
            <strong>Planos e Pix</strong>
          </button>
        </section>

        <AppDownloadSettingsPanel />

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

      {view === 'prices' ? (
        <PriceSettingsPanel />
      ) : view === 'pc' ? (
        <PcAccessSettingsPanel />
      ) : (
        <DetailPanel chat={selectedChat} busy={busy} actionStatus={status} onAction={handleAction} />
      )}
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
      .new-admin-download-toggle span,
      .new-admin-search span,
      .new-admin-detail header span,
      .new-admin-info-grid span,
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
      .new-admin-nav button,
      .new-admin-actions button,
      .new-admin-pc-page button,
      .new-admin-prices-page button {
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
        height: 100vh;
        display: grid;
        grid-template-columns: minmax(260px, 34vw) minmax(0, 1fr);
        gap: 14px;
        padding: 14px;
        overflow: hidden;
      }

      .new-admin-sidebar,
      .new-admin-detail,
      .new-admin-pc-page,
      .new-admin-prices-page {
        border: 1px solid #dbe3ee;
        border-radius: 8px;
        background: #ffffff;
        box-shadow: 0 18px 44px rgba(15, 23, 42, 0.08);
      }

      .new-admin-sidebar {
        height: calc(100vh - 28px);
        min-height: 0;
        display: grid;
        grid-template-rows: auto auto auto auto auto auto 1fr;
        gap: 12px;
        padding: 12px;
        overflow: hidden;
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
      .new-admin-download,
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

      .new-admin-nav {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }

      .new-admin-nav button {
        display: grid;
        gap: 3px;
        border: 1px solid #dbe3ee;
        background: #ffffff;
        color: #0f172a;
        padding: 10px;
        text-align: left;
      }

      .new-admin-nav button.active {
        border-color: #0ea5e9;
        background: #e0f2fe;
      }

      .new-admin-nav strong {
        font-size: 13px;
      }

      .new-admin-download {
        display: grid;
        gap: 10px;
      }

      .new-admin-download-toggle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        width: 100%;
        border: 0;
        background: transparent;
        color: #0f172a;
        padding: 0;
        text-align: left;
      }

      .new-admin-download-toggle div {
        display: grid;
        gap: 3px;
      }

      .new-admin-download-toggle strong {
        font-size: 15px;
      }

      .new-admin-download-toggle b {
        border: 1px solid #dbe3ee;
        border-radius: 999px;
        background: #ffffff;
        color: #0f172a;
        padding: 6px 10px;
        font-size: 12px;
      }

      .new-admin-download-form {
        display: grid;
        gap: 9px;
      }

      .new-admin-download-form label {
        display: grid;
        gap: 5px;
      }

      .new-admin-download-form small,
      .new-admin-download-status {
        color: #64748b;
        font-size: 12px;
        font-weight: 800;
      }

      .new-admin-download-form input,
      .new-admin-download-form textarea {
        width: 100%;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        background: #ffffff;
        color: #0f172a;
        padding: 10px;
        outline: none;
      }

      .new-admin-download-form textarea {
        min-height: 74px;
        resize: vertical;
      }

      .new-admin-download-form input:focus,
      .new-admin-download-form textarea:focus {
        border-color: #0ea5e9;
        box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.14);
      }

      .new-admin-download-grid,
      .new-admin-download-switches {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      .new-admin-download-switches label {
        display: flex;
        align-items: center;
        gap: 8px;
        border: 1px solid #dbe3ee;
        border-radius: 8px;
        background: #ffffff;
        padding: 8px;
      }

      .new-admin-download-switches input {
        width: auto;
      }

      .new-admin-download-form button {
        min-height: 40px;
        border-radius: 8px;
        background: #0f172a;
        color: #ffffff;
        font-weight: 900;
      }

      .new-admin-download-check {
        display: flex !important;
        align-items: center;
        gap: 8px;
        border: 1px solid #dbe3ee;
        border-radius: 8px;
        background: #f8fafc;
        padding: 8px;
      }

      .new-admin-download-check input {
        width: auto;
      }

      .new-admin-pc-page,
      .new-admin-prices-page {
        min-height: calc(100vh - 28px);
        display: grid;
        align-content: start;
        gap: 14px;
        padding: 16px;
      }

      .new-admin-pc-page-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 14px;
        border-bottom: 1px solid #e2e8f0;
        padding-bottom: 14px;
      }

      .new-admin-pc-page-head span,
      .new-admin-pc-column > header span,
      .new-admin-nav span {
        color: #64748b;
        font-size: 12px;
        font-weight: 950;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .new-admin-pc-page-head h2 {
        margin: 4px 0 0;
        color: #0f172a;
        font-size: clamp(30px, 4vw, 48px);
        line-height: 0.98;
        letter-spacing: 0;
      }

      .new-admin-pc-page-head p,
      .new-admin-pc-resource p {
        margin: 8px 0 0;
        color: #64748b;
        font-size: 13px;
        font-weight: 800;
      }

      .new-admin-pc-page-head button {
        min-width: 170px;
      }

      .new-admin-pc-form {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        align-items: start;
      }

      .new-admin-pc-form > .new-admin-download-status {
        grid-column: 1 / -1;
      }

      .new-admin-pc-column {
        display: grid;
        gap: 12px;
        border: 1px solid #dbe3ee;
        border-radius: 8px;
        background: #f8fafc;
        padding: 12px;
      }

      .new-admin-pc-column > header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .new-admin-pc-column > header strong {
        display: block;
        margin-top: 3px;
        font-size: 20px;
      }

      .new-admin-pc-resource {
        display: grid;
        gap: 8px;
        border: 1px solid #dbe3ee;
        border-radius: 8px;
        background: #ffffff;
        padding: 10px;
      }

      .new-admin-pc-resource header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .new-admin-pc-resource header button {
        min-height: 34px;
        background: #e0f2fe;
        color: #075985;
        padding: 0 10px;
        font-size: 12px;
      }

      .new-admin-pc-resource-list {
        display: grid;
        gap: 8px;
      }

      .new-admin-pc-resource-list article {
        display: grid;
        grid-template-columns: minmax(130px, 0.8fr) minmax(180px, 1.2fr) auto;
        gap: 8px;
        align-items: end;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #f8fafc;
        padding: 8px;
      }

      .new-admin-pc-resource-list button.danger {
        background: #fff7f7;
        color: #b91c1c;
        border: 1px solid #fecaca;
        padding: 0 10px;
      }

      .new-admin-prices-form {
        display: grid;
        gap: 12px;
      }

      .new-admin-price-context {
        display: grid;
        gap: 10px;
        border: 1px solid #dbe3ee;
        border-radius: 8px;
        background: #f8fafc;
        padding: 12px;
      }

      .new-admin-price-context header {
        display: grid;
        gap: 4px;
      }

      .new-admin-price-context header strong {
        color: #0f172a;
        font-size: 18px;
      }

      .new-admin-price-context header small {
        color: #64748b;
        font-size: 12px;
        font-weight: 800;
      }

      .new-admin-price-context > div {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
      }

      .new-admin-price-context label {
        display: grid;
        gap: 5px;
      }

      .new-admin-price-context label span {
        color: #64748b;
        font-size: 12px;
        font-weight: 950;
        text-transform: uppercase;
      }

      .new-admin-price-context input {
        width: 100%;
        min-height: 42px;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        background: #ffffff;
        color: #0f172a;
        padding: 0 10px;
        font-weight: 900;
        outline: none;
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
        height: calc(100vh - 28px);
        min-height: 0;
        overflow: auto;
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
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
      }

      .new-admin-info-grid article {
        display: grid;
        gap: 4px;
      }

      .new-admin-info-grid article.wide {
        grid-column: span 2;
      }

      .new-admin-info-grid article.muted {
        background: #f1f5f9;
      }

      .new-admin-info-grid strong {
        min-width: 0;
        color: #0f172a;
        overflow-wrap: anywhere;
      }

      .new-admin-actions {
        display: grid;
        gap: 10px;
      }

      .new-admin-quick-actions {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
      }

      .new-admin-action-section {
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #ffffff;
        overflow: hidden;
      }

      .new-admin-action-section summary {
        min-height: 58px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        cursor: pointer;
        padding: 10px 12px;
        list-style: none;
      }

      .new-admin-action-section summary::-webkit-details-marker {
        display: none;
      }

      .new-admin-action-section summary span {
        display: grid;
        gap: 3px;
      }

      .new-admin-action-section summary b {
        color: #0f172a;
        font-size: 15px;
      }

      .new-admin-action-section summary small {
        color: #64748b;
        font-size: 12px;
        font-weight: 800;
        text-transform: none;
      }

      .new-admin-action-section summary i {
        min-width: 58px;
        border-radius: 999px;
        background: #f1f5f9;
        color: #334155;
        padding: 6px 9px;
        font-size: 11px;
        font-style: normal;
        font-weight: 950;
        text-align: center;
        text-transform: uppercase;
      }

      .new-admin-action-section[open] summary i {
        background: #dbeafe;
        color: #1d4ed8;
      }

      .new-admin-action-section > div {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        border-top: 1px solid #e2e8f0;
        background: #f8fafc;
        padding: 10px;
      }

      .new-admin-action-section p {
        grid-column: 1 / -1;
        margin: 0;
        color: #64748b;
        font-size: 13px;
        font-weight: 850;
      }

      .new-admin-actions button {
        width: 100%;
        background: #0ea5e9;
        color: #ffffff;
      }

      .new-admin-actions button.quiet {
        border: 1px solid #cbd5e1;
        background: #ffffff;
        color: #334155;
      }

      .new-admin-actions button.danger {
        background: #dc2626;
      }

      .new-admin-actions button:disabled {
        cursor: wait;
        opacity: 0.65;
      }

      .new-admin-pc-notice {
        display: grid;
        gap: 4px;
        border: 1px solid #bae6fd;
        border-radius: 8px;
        background: #f0f9ff;
        color: #075985;
        padding: 12px;
      }

      .new-admin-pc-notice p {
        margin: 0;
        font-size: 13px;
        font-weight: 800;
      }

      @media (max-width: 420px) {
        .new-admin-page {
          height: auto;
          grid-template-columns: 1fr;
          overflow: visible;
        }

        .new-admin-sidebar,
        .new-admin-detail,
        .new-admin-pc-page,
        .new-admin-prices-page {
          min-height: auto;
        }

        .new-admin-list {
          max-height: 520px;
        }

        .new-admin-info-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .new-admin-quick-actions,
        .new-admin-action-section > div,
        .new-admin-pc-form,
        .new-admin-pc-resource-list article {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .new-admin-pc-resource-list article button {
          grid-column: 1 / -1;
        }

        .new-admin-price-context > div {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 640px) {
        .new-admin-page {
          padding: 8px;
          gap: 8px;
        }

        .new-admin-sidebar,
        .new-admin-detail,
        .new-admin-pc-page,
        .new-admin-prices-page {
          border-radius: 8px;
          padding: 10px;
        }

        .new-admin-title {
          align-items: center;
        }

        .new-admin-title h1 {
          font-size: 22px;
        }

        .new-admin-stats {
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 6px;
        }

        .new-admin-stats article {
          padding: 8px;
        }

        .new-admin-stats span {
          font-size: 9px;
        }

        .new-admin-stats strong {
          font-size: 20px;
        }

        .new-admin-list {
          max-height: 420px;
        }

        .new-admin-list button > div {
          display: grid;
        }

        .new-admin-detail header {
          display: grid;
        }

        .new-admin-detail h2 {
          font-size: 34px;
        }

        .new-admin-info-grid {
          grid-template-columns: 1fr;
        }

        .new-admin-info-grid article.wide {
          grid-column: auto;
        }

        .new-admin-quick-actions,
        .new-admin-action-section > div,
        .new-admin-pc-form,
        .new-admin-pc-resource-list article {
          grid-template-columns: 1fr;
        }

        .new-admin-pc-page-head,
        .new-admin-pc-column > header,
        .new-admin-pc-resource header {
          display: grid;
        }

        .new-admin-pc-page-head button {
          width: 100%;
        }

        .new-admin-nav,
        .new-admin-price-context > div {
          grid-template-columns: 1fr;
        }

        .new-admin-action-section summary {
          align-items: flex-start;
        }
      }
    `}</style>
  )
}
