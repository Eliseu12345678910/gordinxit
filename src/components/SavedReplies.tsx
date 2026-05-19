'use client'

import { useEffect, useState } from 'react'

export type QuickReplyAction = {
  id: string
  label: string
  message?: string
  onSend: (message?: string) => Promise<void> | void
}

type CustomReply = {
  id: string
  title: string
  message: string
}

const CUSTOM_REPLIES_KEY = 'chat-privado-custom-replies-v1'

function makeReplyId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `reply_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function SavedReplies({
  onPick,
  onSend,
  quickActions = [],
}: {
  onPick: (reply: string) => void
  onSend?: (reply: string) => Promise<void> | void
  quickActions?: QuickReplyAction[]
}) {
  const [preview, setPreview] = useState<{ label: string; message: string; onSend?: (message: string) => Promise<void> | void } | null>(null)
  const [sending, setSending] = useState(false)
  const [customReplies, setCustomReplies] = useState<CustomReply[]>([])
  const [managerOpen, setManagerOpen] = useState(false)
  const [editingReply, setEditingReply] = useState<CustomReply>({
    id: '',
    title: '',
    message: '',
  })

  useEffect(() => {
    try {
      const stored = localStorage.getItem(CUSTOM_REPLIES_KEY)
      const parsed = stored ? JSON.parse(stored) : []
      if (Array.isArray(parsed)) {
        setCustomReplies(
          parsed
            .filter((reply) => reply && typeof reply.title === 'string' && typeof reply.message === 'string')
            .map((reply) => ({
              id: typeof reply.id === 'string' ? reply.id : makeReplyId(),
              title: reply.title,
              message: reply.message,
            })),
        )
      }
    } catch {
      setCustomReplies([])
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(CUSTOM_REPLIES_KEY, JSON.stringify(customReplies))
  }, [customReplies])

  async function sendPreview() {
    const message = preview?.message.trim()
    if (!message || sending) return

    setSending(true)
    try {
      if (preview?.onSend) {
        await preview.onSend(message)
      } else if (onSend) {
        await onSend(message)
      }
      setPreview(null)
    } finally {
      setSending(false)
    }
  }

  async function sendMessage(message: string) {
    if (!message.trim() || !onSend || sending) return

    setSending(true)
    try {
      await onSend(message)
    } finally {
      setSending(false)
    }
  }

  function startNewReply() {
    setEditingReply({
      id: '',
      title: '',
      message: '',
    })
    setManagerOpen(true)
  }

  function saveCustomReply() {
    const title = editingReply.title.trim()
    const message = editingReply.message.trim()
    if (!title || !message) return

    setCustomReplies((current) => {
      if (!editingReply.id) {
        return [...current, { id: makeReplyId(), title, message }]
      }

      return current.map((reply) =>
        reply.id === editingReply.id ? { ...reply, title, message } : reply,
      )
    })
    setEditingReply({ id: '', title: '', message: '' })
  }

  function removeCustomReply(replyId: string) {
    setCustomReplies((current) => current.filter((reply) => reply.id !== replyId))
    if (editingReply.id === replyId) setEditingReply({ id: '', title: '', message: '' })
  }

  return (
    <div className="saved-replies" aria-label="Respostas prontas">
      <div className="saved-replies-head">
        <div>
          <span className="saved-replies-label">Respostas rapidas</span>
          <small>Enviar direto ou editar antes.</small>
        </div>
        <button type="button" className="organize-replies-button" onClick={startNewReply}>
          Organizar
        </button>
      </div>
      <div className="saved-replies-container">
        {quickActions.map((action) => (
          <div key={action.id} className="saved-reply-card quick-action-card">
            <span>{action.label}</span>
            <div>
              {action.message && (
                <button
                  type="button"
                  className="reply-edit-button"
                  onClick={() => setPreview({ label: action.label, message: action.message || '', onSend: action.onSend })}
                  aria-label={`Editar ${action.label}`}
                  title="Editar antes"
                >
                  <span aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                className="reply-send-button"
                onClick={() => action.onSend(action.message)}
                disabled={sending}
              >
                Enviar
              </button>
            </div>
          </div>
        ))}
        {customReplies.map((reply, index) => (
          <div
            key={reply.id}
            className="saved-reply-card"
          >
            <span>{reply.title}</span>
            <div>
              <button
                type="button"
                className="reply-edit-button manage-reply-button"
                onClick={() => {
                  setEditingReply(reply)
                  setManagerOpen(true)
                }}
                aria-label={`Organizar ${reply.title || `resposta ${index + 1}`}`}
                title="Organizar"
              >
                <span aria-hidden="true" />
              </button>
              <button
                type="button"
                className="reply-send-button"
                onClick={() => sendMessage(reply.message)}
                disabled={sending}
              >
                Enviar
              </button>
            </div>
          </div>
        ))}
      </div>
      {managerOpen && (
        <div className="popup-backdrop" role="presentation" onClick={() => setManagerOpen(false)}>
          <div
            className="reply-manager popup-card"
            role="dialog"
            aria-modal="true"
            aria-label="Organizar respostas rapidas"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="popup-card-head">
              <div>
                <span>Respostas rapidas</span>
                <h3>Organizar</h3>
              </div>
              <button type="button" onClick={() => setManagerOpen(false)} aria-label="Fechar">
                Fechar
              </button>
            </header>
            <div className="reply-manager-grid">
              <section className="reply-manager-list" aria-label="Mensagens salvas">
                {customReplies.length ? (
                  customReplies.map((reply) => (
                    <article key={reply.id}>
                      <button type="button" onClick={() => setEditingReply(reply)}>
                        <strong>{reply.title}</strong>
                        <span>{reply.message}</span>
                      </button>
                      <button type="button" className="reply-delete-button" onClick={() => removeCustomReply(reply.id)}>
                        Remover
                      </button>
                    </article>
                  ))
                ) : (
                  <p>Nenhuma resposta salva ainda.</p>
                )}
              </section>
              <section className="reply-manager-editor" aria-label="Adicionar ou editar mensagem rapida">
                <label>
                  <span>Nome curto</span>
                  <input
                    value={editingReply.title}
                    onChange={(event) => setEditingReply((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Ex: garantia"
                  />
                </label>
                <label>
                  <span>Mensagem</span>
                  <textarea
                    value={editingReply.message}
                    onChange={(event) => setEditingReply((current) => ({ ...current, message: event.target.value }))}
                    rows={5}
                    placeholder="Escreva a resposta que voce quer salvar"
                  />
                </label>
                <div className="reply-manager-actions">
                  <button type="button" onClick={saveCustomReply} disabled={!editingReply.title.trim() || !editingReply.message.trim()}>
                    Salvar
                  </button>
                  <button type="button" onClick={() => setEditingReply({ id: '', title: '', message: '' })}>
                    Nova
                  </button>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
      {preview && (
        <div className="popup-backdrop" role="presentation" onClick={() => setPreview(null)}>
          <div
            className="reply-preview popup-card"
            role="dialog"
            aria-modal="true"
            aria-label="Revisar resposta rapida"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="popup-card-head">
              <div>
                <span>Resposta rapida</span>
                <h3>{preview.label}</h3>
              </div>
              <button type="button" onClick={() => setPreview(null)} aria-label="Fechar">
                Fechar
              </button>
            </header>
            <label>
              <span>Editar antes de enviar</span>
              <textarea
                value={preview.message}
                onChange={(event) => setPreview((current) => current ? { ...current, message: event.target.value } : current)}
                rows={8}
              />
            </label>
            <div className="reply-preview-actions">
              <button
                type="button"
                onClick={() => {
                  onPick(preview.message)
                  setPreview(null)
                }}
              >
                Colocar no campo
              </button>
              <button type="button" onClick={sendPreview} disabled={sending || !preview.message.trim()}>
                {sending ? 'Enviando...' : 'Enviar'}
              </button>
              <button type="button" onClick={() => setPreview(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
