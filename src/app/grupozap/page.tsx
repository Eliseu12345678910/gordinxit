'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

const groupLink = 'https://chat.whatsapp.com/BiPHpD4lwR82qFjC6mNtEh'

type BrowserState = 'checking' | 'tiktok' | 'browser'

export default function GrupoZapPage() {
  const [browserState, setBrowserState] = useState<BrowserState>('checking')
  const [copyFeedback, setCopyFeedback] = useState('')

  const status = useMemo(() => {
    if (browserState === 'browser') {
      return {
        label: 'Ok',
        title: 'Abrindo o grupo',
        text: 'Voce saiu do TikTok. Aguarde.',
      }
    }

    if (browserState === 'tiktok') {
      return {
        label: 'TikTok',
        title: 'O Grupo no Whatsapp nao abre aqui',
        text: 'Toque nos 3 pontos e abra no navegador.',
      }
    }

    return {
      label: 'TikTok',
      title: 'Verificando navegador',
      text: 'Conferindo onde o link abriu.',
    }
  }, [browserState])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const forcedTikTok = params.get('preview') === 'tiktok'
    const forcedBrowser = params.get('preview') === 'browser'
    const userAgent = navigator.userAgent || ''
    const referrer = document.referrer || ''
    const isLocalPreview = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
    const detectedTikTok = /tiktok|musical_ly|bytedance|aweme|trill/i.test(userAgent)
      || /tiktok/i.test(referrer)
    const isTikTokBrowser = forcedTikTok || (!forcedBrowser && detectedTikTok)

    if (isTikTokBrowser) {
      setBrowserState('tiktok')
      return
    }

    setBrowserState('browser')

    if (!isLocalPreview) {
      window.setTimeout(() => {
        window.location.replace(groupLink)
      }, 700)
    }
  }, [])

  const copyGroupLink = useCallback(async () => {
    const input = document.getElementById('groupLink') as HTMLInputElement | null

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(groupLink)
      } else if (input) {
        copyFromInput(input)
      }

      setCopyFeedback('Link copiado. Cole no Google, Chrome ou Safari.')
    } catch {
      try {
        if (!input) throw new Error('Input not found')
        copyFromInput(input)
        setCopyFeedback('Link copiado. Cole no Google, Chrome ou Safari.')
      } catch {
        input?.focus()
        input?.select()
        setCopyFeedback('Selecione o link e copie manualmente.')
      }
    }
  }, [])

  return (
    <main className="gz-page-shell">
      <div className="gz-app-frame">
        {browserState !== 'browser' && (
          <header className="gz-app-bar" aria-label="Navegador do TikTok">
            <span className="gz-brand-word">TikTok</span>
          </header>
        )}

        {browserState === 'browser' ? (
          <section className="gz-open-card" aria-labelledby="openTitle">
            <span className="gz-open-label">Navegador detectado</span>
            <h1 id="openTitle">Abrindo o grupo</h1>
            <p>Se nao abrir sozinho, toque no botao abaixo.</p>
            <a className="gz-whatsapp-button" href={groupLink}>
              Abrir grupo no WhatsApp
            </a>
          </section>
        ) : (
          <>
            <section className="gz-top-card" aria-labelledby="pageTitle">
              <div className={`gz-status-panel gz-state-${browserState}`} aria-live="polite">
                <span className="gz-status-label">{status.label}</span>
                <p>{status.title}</p>
                <small>{status.text}</small>
              </div>

              <p className="gz-kicker">Aviso do navegador</p>
              <h1 id="pageTitle">Abra o grupo pelo navegador</h1>

              <ol className="gz-steps" aria-label="Passo a passo">
                <li className="gz-step">
                  <span className="gz-step-number">1</span>
                  <strong>Toque nos 3 pontos</strong>
                </li>

                <li className="gz-step">
                  <span className="gz-step-number">2</span>
                  <strong>Abrir no navegador</strong>
                </li>

                <li className="gz-step">
                  <span className="gz-step-number">3</span>
                  <strong>O grupo abre sozinho</strong>
                </li>
              </ol>
            </section>

            <section className="gz-copy-card" aria-labelledby="copyTitle">
              <div>
                <h2 id="copyTitle">Nao apareceu a opcao?</h2>
                <p>Copie o link e cole no Google.</p>
              </div>

              <div className="gz-link-box">
                <input
                  id="groupLink"
                  type="text"
                  readOnly
                  value={groupLink}
                  aria-label="Link do grupo do WhatsApp"
                />
                <button className="gz-copy-button" type="button" onClick={copyGroupLink}>
                  Copiar
                </button>
              </div>
              <p className="gz-copy-feedback" role="status" aria-live="polite">
                {copyFeedback}
              </p>
            </section>

            <section className="gz-video-card" aria-labelledby="videoTitle">
              <div className="gz-video-copy">
                <span>Tutorial rapido</span>
                <h2 id="videoTitle">Veja onde tocar</h2>
                <p>O video mostra como abrir os 3 pontos e escolher abrir no navegador.</p>
              </div>

              <video
                className="gz-tutorial-video"
                controls
                playsInline
                preload="metadata"
                src="/grupozap-tutorial.mp4"
              />
            </section>
          </>
        )}
      </div>

      <style jsx>{`
        .gz-page-shell {
          width: min(100%, 640px);
          min-height: 100vh;
          margin: 0 auto;
          padding: 10px;
          background:
            radial-gradient(circle at 0% 0%, rgba(0, 213, 223, 0.14), transparent 17rem),
            radial-gradient(circle at 100% 5%, rgba(254, 44, 85, 0.12), transparent 18rem),
            #f7f8fa;
          color: #12151b;
        }

        .gz-app-frame {
          min-height: calc(100vh - 20px);
          overflow: hidden;
          border: 1px solid #e6e8ee;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.88);
          box-shadow: 0 18px 44px rgba(18, 21, 27, 0.1);
        }

        .gz-app-bar {
          height: 54px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 16px;
          border-bottom: 1px solid #e6e8ee;
          background: #ffffff;
        }

        .gz-brand-word {
          color: #111111;
          font-size: 22px;
          font-weight: 950;
          letter-spacing: 0;
          text-shadow:
            -1.8px 0 0 rgba(0, 213, 223, 0.78),
            1.8px 0 0 rgba(254, 44, 85, 0.72);
        }

        .gz-top-card,
        .gz-copy-card,
        .gz-video-card,
        .gz-open-card {
          margin: 10px;
          border: 1px solid #e6e8ee;
          border-radius: 8px;
          background: #ffffff;
        }

        .gz-top-card {
          padding: clamp(15px, 4vw, 24px);
        }

        .gz-status-panel {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 4px 10px;
          align-items: center;
          margin-bottom: 16px;
          padding: 12px;
          border: 1px solid rgba(254, 44, 85, 0.24);
          border-radius: 8px;
          background: #fff0f3;
        }

        .gz-status-panel.gz-state-browser {
          border-color: rgba(22, 163, 74, 0.28);
          background: #e9f8ef;
        }

        .gz-status-label {
          grid-row: span 2;
          width: fit-content;
          padding: 7px 10px;
          border-radius: 999px;
          background: #fe2c55;
          color: #ffffff;
          font-size: 11px;
          font-weight: 950;
          letter-spacing: 0;
          text-transform: uppercase;
        }

        .gz-state-browser .gz-status-label {
          background: #16a34a;
        }

        .gz-status-panel p,
        .gz-status-panel small {
          margin: 0;
        }

        .gz-status-panel p {
          color: #12151b;
          font-size: clamp(17px, 4vw, 22px);
          font-weight: 950;
          line-height: 1.1;
        }

        .gz-status-panel small {
          color: #8d3b49;
          line-height: 1.28;
        }

        .gz-state-browser small {
          color: #24663d;
        }

        .gz-kicker {
          margin: 0 0 8px;
          color: #008e96;
          font-size: 12px;
          font-weight: 950;
          letter-spacing: 0;
          text-transform: uppercase;
        }

        h1,
        h2,
        p {
          margin-top: 0;
        }

        h1 {
          max-width: 12ch;
          margin-bottom: 14px;
          color: #111111;
          font-size: clamp(40px, 11vw, 66px);
          line-height: 0.92;
          letter-spacing: 0;
        }

        .gz-steps {
          display: grid;
          gap: 8px;
          margin: 0;
          padding: 0;
          list-style: none;
        }

        .gz-step {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 12px;
          align-items: center;
          min-height: 62px;
          padding: 11px 12px;
          border: 1px solid #e6e8ee;
          border-radius: 8px;
          background: #fbfcff;
        }

        .gz-step:first-child {
          border-color: rgba(0, 213, 223, 0.34);
          background:
            linear-gradient(90deg, rgba(0, 213, 223, 0.07), rgba(254, 44, 85, 0.04)),
            #ffffff;
        }

        .gz-step-number {
          width: 36px;
          height: 36px;
          display: grid;
          place-items: center;
          border-radius: 50%;
          background: #111111;
          color: #ffffff;
          font-size: 17px;
          font-weight: 950;
          box-shadow:
            -2px 0 0 #00d5df,
            2px 0 0 #fe2c55;
        }

        .gz-step strong {
          display: flex;
          align-items: center;
          min-width: 0;
          color: #151515;
          font-size: clamp(18px, 4.5vw, 23px);
          line-height: 1.12;
        }

        .gz-copy-card {
          display: grid;
          gap: 12px;
          padding: 15px;
        }

        .gz-copy-card h2 {
          margin-bottom: 4px;
          color: #111111;
          font-size: clamp(22px, 5vw, 28px);
          line-height: 1.1;
          letter-spacing: 0;
        }

        .gz-copy-card p {
          margin-bottom: 0;
          color: #6b7280;
          line-height: 1.38;
        }

        .gz-link-box {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
        }

        .gz-link-box input {
          width: 100%;
          min-width: 0;
          min-height: 48px;
          border: 1px solid #e6e8ee;
          border-radius: 8px;
          padding: 0 12px;
          color: #12151b;
          background: #f6f7f9;
          outline: 0;
        }

        .gz-link-box input:focus {
          border-color: #00d5df;
          box-shadow: 0 0 0 3px rgba(0, 213, 223, 0.16);
        }

        .gz-copy-button {
          min-height: 48px;
          border: 0;
          border-radius: 8px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0 18px;
          background: #111111;
          color: #ffffff;
          font: inherit;
          font-weight: 950;
          text-align: center;
          cursor: pointer;
        }

        .gz-copy-button:hover {
          background: #2a2a2a;
        }

        .gz-copy-feedback {
          min-height: 20px;
          margin: -2px 0 0;
          color: #008e96;
          font-size: 14px;
          font-weight: 850;
        }

        .gz-video-card {
          display: grid;
          gap: 12px;
          padding: 15px;
          background:
            linear-gradient(135deg, rgba(0, 213, 223, 0.06), rgba(254, 44, 85, 0.04)),
            #ffffff;
        }

        .gz-video-copy {
          display: grid;
          gap: 4px;
        }

        .gz-video-copy span {
          color: #008e96;
          font-size: 12px;
          font-weight: 950;
          letter-spacing: 0;
          text-transform: uppercase;
        }

        .gz-video-copy h2 {
          margin: 0;
          color: #111111;
          font-size: clamp(22px, 5vw, 28px);
          line-height: 1.1;
          letter-spacing: 0;
        }

        .gz-video-copy p {
          margin: 0;
          color: #6b7280;
          line-height: 1.38;
        }

        .gz-tutorial-video {
          display: block;
          width: 100%;
          max-height: min(68vh, 620px);
          border: 1px solid #e6e8ee;
          border-radius: 8px;
          background: #111111;
          box-shadow: 0 14px 30px rgba(18, 21, 27, 0.1);
        }

        .gz-open-card {
          min-height: calc(100vh - 40px);
          display: grid;
          align-content: center;
          justify-items: center;
          gap: 12px;
          padding: clamp(24px, 7vw, 46px);
          text-align: center;
          background:
            radial-gradient(circle at 50% 0%, rgba(0, 213, 223, 0.12), transparent 18rem),
            #ffffff;
        }

        .gz-open-label {
          display: inline-flex;
          min-height: 30px;
          align-items: center;
          border-radius: 999px;
          background: #e9f8ef;
          color: #24663d;
          padding: 0 12px;
          font-size: 12px;
          font-weight: 950;
          letter-spacing: 0;
          text-transform: uppercase;
        }

        .gz-open-card h1 {
          max-width: 10ch;
          margin: 0;
        }

        .gz-open-card p {
          margin: 0;
          color: #6b7280;
          font-size: clamp(16px, 4vw, 19px);
          line-height: 1.35;
        }

        .gz-whatsapp-button {
          width: min(100%, 360px);
          min-height: 56px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
          background: #16a34a;
          color: #ffffff;
          padding: 0 20px;
          font-size: 17px;
          font-weight: 950;
          text-align: center;
          text-decoration: none;
          box-shadow: 0 16px 32px rgba(22, 163, 74, 0.22);
        }

        .gz-whatsapp-button:hover {
          background: #12803a;
        }

        @media (max-width: 430px) {
          .gz-page-shell {
            padding: 0;
          }

          .gz-app-frame {
            min-height: 100vh;
            border-radius: 0;
            border: 0;
          }

          .gz-app-bar {
            height: 50px;
          }

          .gz-top-card,
          .gz-copy-card,
          .gz-video-card,
          .gz-open-card {
            margin: 8px;
          }

          .gz-top-card {
            padding: 14px;
          }

          .gz-status-panel {
            grid-template-columns: 1fr;
            gap: 6px;
            margin-bottom: 13px;
          }

          .gz-status-label {
            grid-row: auto;
          }

          .gz-step {
            min-height: 56px;
            padding: 10px;
          }

          .gz-step-number {
            width: 34px;
            height: 34px;
          }

          .gz-link-box {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  )
}

function copyFromInput(input: HTMLInputElement) {
  input.focus()
  input.select()
  const copied = document.execCommand('copy')
  input.blur()

  if (!copied) {
    throw new Error('Copy command blocked')
  }
}
