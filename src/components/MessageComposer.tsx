'use client'

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react'

type MessageComposerProps = {
  disabled?: boolean
  canSend?: boolean
  placeholder?: string
  onSend: (message: string) => Promise<void> | void
  onBlockedSend?: (message: string) => void
}

export function MessageComposer({
  disabled = false,
  canSend = true,
  placeholder = 'Digite sua mensagem',
  onSend,
  onBlockedSend,
}: MessageComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [value, setValue] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 116)}px`
  }, [value])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const message = value.trim()
    if (!message || disabled || sending) return

    if (!canSend) {
      onBlockedSend?.(message)
      return
    }

    setValue('')
    setSending(true)
    try {
      await onSend(message)
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return

    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  const isEmpty = !value.trim()

  return (
    <form className={`composer ${isEmpty ? 'empty' : 'ready'}`} onSubmit={handleSubmit}>
      <div className="composer-shell">
        <div className="composer-input-wrapper">
          <textarea
            ref={textareaRef}
            cols={1}
            rows={1}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled || sending}
            placeholder={placeholder}
            aria-label={placeholder}
            className="composer-input"
          />
        </div>
        <button
          type="submit"
          disabled={disabled || sending || isEmpty}
          className="composer-button"
          title={isEmpty ? 'Digite uma mensagem' : 'Enviar mensagem'}
          aria-label="Enviar mensagem"
        >
          {sending ? <span className="spinner-small" /> : <span className="composer-send-icon" aria-hidden="true" />}
        </button>
      </div>
    </form>
  )
}
