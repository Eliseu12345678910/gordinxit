'use client'

import type { Chat } from '@/types/chat'

function formatStatus(chat: Chat) {
  if (chat.accessBlocked === true || chat.accountBlock?.active === true) return 'Bloqueado'

  const labels = {
    new: 'Novo',
    device_selected: 'Dispositivo escolhido',
    plans_sent: 'Planos enviados',
    plan_selected: 'Plano escolhido',
    payment_link_sent: 'Link enviado',
    waiting_receipt: 'Aguardando comprovante',
    paid: 'Pago',
    activated: 'Ativado',
    deactivated: 'Desativado',
  }

  return chat.funnelStatus ? labels[chat.funnelStatus] : 'Novo'
}

function getStatusColor(status?: string) {
  switch (status) {
    case 'blocked':
      return 'status-blocked'
    case 'new':
      return 'status-new'
    case 'device_selected':
    case 'plans_sent':
    case 'plan_selected':
      return 'status-progress'
    case 'payment_link_sent':
    case 'waiting_receipt':
    case 'deactivated':
      return 'status-waiting'
    case 'paid':
      return 'status-paid'
    case 'activated':
      return 'status-activated'
    default:
      return 'status-new'
  }
}

function formatChatTime(chat: Chat) {
  const date = chat.lastMessageAt?.toDate?.() || chat.updatedAt?.toDate?.() || chat.createdAt?.toDate?.()
  if (!date) return ''

  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function formatLastMessage(chat: Chat) {
  const message = chat.lastMessage || 'Novo chat privado'
  if (!chat.lastSender) return message
  if (chat.lastSender === 'admin') return `Voce: ${message}`
  if (chat.lastSender === 'client') return message
  return message
}

export function AdminChatList({
  chats,
  activeChatId,
  unreadChatIds,
  onSelect,
}: {
  chats: Chat[]
  activeChatId?: string
  unreadChatIds?: Set<string>
  onSelect: (chat: Chat) => void
}) {
  if (!chats.length) {
    return (
      <div className="empty-list">
        <div className="empty-list-icon">?</div>
        <p>Nenhuma conversa ainda</p>
        <span>Suas conversas aparecerao aqui</span>
      </div>
    )
  }

  return (
    <div className="chat-list">
      {chats.map((chat) => {
        const unread = unreadChatIds?.has(chat.id)
        const accountBlocked = chat.accessBlocked === true || chat.accountBlock?.active === true

        return (
          <button
            key={chat.id}
            type="button"
            className={`chat-list-item ${chat.id === activeChatId ? 'active' : ''} ${unread ? 'unread' : ''}`}
            onClick={() => onSelect(chat)}
          >
            {unread && <span className="unread-dot" aria-label="Mensagem nova" />}
            <div className="chat-list-header">
              <div className="chat-list-user">
                <div className="user-avatar">{chat.accessUsername?.[0]?.toUpperCase() || '?'}</div>
                <div className="user-info">
                  <strong className="user-name">{chat.accessUsername || 'Usuario sem nome'}</strong>
                  <span className="user-message">{formatLastMessage(chat)}</span>
                </div>
              </div>
              <div className="chat-list-side">
                <time>{formatChatTime(chat)}</time>
                <span className={`status-badge ${getStatusColor(accountBlocked ? 'blocked' : chat.funnelStatus)}`}>
                  {formatStatus(chat)}
                </span>
              </div>
            </div>

            <div className="chat-list-meta">
              {chat.leadProfile?.deviceLabel && (
                <span className="meta-chip device-chip">{chat.leadProfile.deviceLabel}</span>
              )}
              {chat.selectedPlan?.label && (
                <span className="meta-chip plan-chip">{chat.selectedPlan.label}</span>
              )}
              {chat.lastClientActivity?.label && (
                <span className="meta-chip activity-chip">
                  {chat.lastClientActivity.label}
                </span>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}
