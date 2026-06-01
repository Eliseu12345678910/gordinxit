'use client'

import { useCallback, useEffect, useState } from 'react'

const contactLink = 'https://wa.me/554195934242?text=fala%20mano,%20quero%20ver%20os%20planos%20do%20Gordinxit'

type BrowserState = 'checking' | 'tiktok' | 'browser'

export default function ContatoPage() {
  const [browserState, setBrowserState] = useState<BrowserState>('checking')
  const [copyFeedback, setCopyFeedback] = useState('')

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
      return undefined
    }

    setBrowserState('browser')

    if (!isLocalPreview) {
      const redirectTimer = window.setTimeout(() => {
        window.location.replace(contactLink)
      }, 250)

      return () => window.clearTimeout(redirectTimer)
    }

    return undefined
  }, [])

  const copyContactLink = useCallback(async () => {
    const input = document.getElementById('contactLink') as HTMLInputElement | null

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(contactLink)
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
        {browserState === 'browser' ? (
          <section className="gz-open-card" aria-labelledby="openTitle">
            <span className="gz-open-label">Navegador detectado</span>
            <h1 id="openTitle">Abrindo o WhatsApp</h1>
            <p>Se nao abrir sozinho, toque no botao abaixo.</p>
            <a className="gz-whatsapp-button" href={contactLink}>
              Abrir conversa no WhatsApp
            </a>
          </section>
        ) : (
          <>
            <section className="gz-help-card" aria-labelledby="contactHelpText">
              <div className="gz-alert-panel" role="alert">
                <span className="gz-alert-mark">!</span>
                <div>
                  <p id="contactHelpText">
                    O WhatsApp pode nao abrir dentro do TikTok. Toque nos 3 pontos e escolha
                    abrir no navegador para entrar em contato comigo.
                  </p>
                </div>
              </div>

              <ol className="gz-steps" aria-label="Passo a passo">
                <li className="gz-step">
                  <span className="gz-step-number">1</span>
                  <div>
                    <strong>Toque nos 3 pontos</strong>
                    <small>Fica no topo ou no canto da tela do TikTok.</small>
                  </div>
                </li>

                <li className="gz-step">
                  <span className="gz-step-number">2</span>
                  <div>
                    <strong>Abrir no navegador</strong>
                    <small>Escolha Chrome, Safari ou navegador padrao.</small>
                  </div>
                </li>

                <li className="gz-step">
                  <span className="gz-step-number">3</span>
                  <div>
                    <strong>Fale comigo no WhatsApp</strong>
                    <small>A conversa vai abrir com a mensagem pronta.</small>
                  </div>
                </li>
              </ol>

              <a
                className="gz-primary-action"
                href="#abrir-no-navegador"
                aria-haspopup="dialog"
              >
                Abrir conversa no WhatsApp
              </a>
            </section>

            <section className="gz-copy-card" aria-labelledby="copyTitle">
              <div className="gz-copy-head">
                <h2 id="copyTitle">Se não abrir o link faça isso:</h2>
                <p>Copie o link e cole no Google, Chrome ou Safari.</p>
              </div>

              <div className="gz-link-box">
                <input
                  id="contactLink"
                  type="text"
                  readOnly
                  value={contactLink}
                  aria-label="Link do contato do WhatsApp"
                />
                <button className="gz-copy-button" type="button" onClick={copyContactLink}>
                  Copiar
                </button>
              </div>
              <p className="gz-copy-feedback" role="status" aria-live="polite">
                {copyFeedback}
              </p>
            </section>
          </>
        )}

        {browserState !== 'browser' && (
          <div id="abrir-no-navegador" className="gz-modal-target">
            <div className="gz-corner-pointer" aria-hidden="true">
              <i />
            </div>

            <div className="gz-modal-backdrop" role="presentation">
              <section
                className="gz-guide-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="guideModalTitle"
              >
                <a
                  className="gz-modal-close"
                  href="#"
                  aria-label="Fechar aviso"
                >
                  X
                </a>

                <p className="gz-modal-kicker">Abra no navegador</p>
                <h2 id="guideModalTitle">O TikTok bloqueou o WhatsApp aqui</h2>
                <p>
                  Use os 3 pontos no canto superior direito e abra esta pagina no navegador.
                  Depois a conversa comigo abre normal.
                </p>

                <ol className="gz-modal-steps" aria-label="Passo a passo no TikTok">
                  <li>
                    <span>1</span>
                    <strong>Toque nos 3 pontos</strong>
                  </li>
                  <li>
                    <span>2</span>
                    <strong>Escolha abrir no navegador</strong>
                  </li>
                  <li>
                    <span>3</span>
                    <strong>Toque no botao do WhatsApp de novo</strong>
                  </li>
                </ol>

                <a
                  className="gz-modal-action"
                  href="#"
                >
                  Entendi
                </a>
              </section>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .gz-page-shell {
          width: min(100%, 640px);
          min-height: 100vh;
          margin: 0 auto;
          padding: 12px;
          background:
            radial-gradient(circle at 8% 0%, rgba(0, 213, 223, 0.18), transparent 15rem),
            radial-gradient(circle at 100% 2%, rgba(254, 44, 85, 0.16), transparent 17rem),
            linear-gradient(180deg, #ffffff 0%, #f4f7fb 45%, #f7f8fa 100%),
            #f7f8fa;
          color: #12151b;
        }

        .gz-app-frame {
          min-height: calc(100vh - 24px);
          overflow: hidden;
          border: 1px solid #e6e8ee;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.92);
          box-shadow: 0 18px 44px rgba(18, 21, 27, 0.12);
        }

        .gz-help-card,
        .gz-copy-card,
        .gz-open-card {
          margin: 10px;
          border: 1px solid #e6e8ee;
          border-radius: 8px;
          background: #ffffff;
        }

        h2,
        p {
          margin-top: 0;
        }

        .gz-help-card {
          display: grid;
          gap: 12px;
          padding: 14px;
          background:
            linear-gradient(180deg, rgba(255, 240, 243, 0.72), rgba(255, 255, 255, 0.96) 46%),
            #ffffff;
        }

        .gz-alert-panel {
          display: grid;
          grid-template-columns: 48px minmax(0, 1fr);
          gap: 12px;
          align-items: center;
          padding: 14px;
          border: 1px solid rgba(254, 44, 85, 0.3);
          border-radius: 8px;
          background:
            linear-gradient(135deg, rgba(254, 44, 85, 0.14), rgba(0, 213, 223, 0.07)),
            #ffffff;
        }

        .gz-alert-mark {
          width: 48px;
          height: 48px;
          display: grid;
          place-items: center;
          border-radius: 50%;
          background: #fe2c55;
          color: #ffffff;
          font-size: 28px;
          font-weight: 950;
          box-shadow:
            -3px 0 0 #00d5df,
            0 12px 24px rgba(254, 44, 85, 0.2);
        }

        .gz-alert-panel p {
          margin: 0;
          color: #12151b;
          font-size: clamp(18px, 4.2vw, 23px);
          font-weight: 900;
          line-height: 1.18;
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
          align-items: start;
          min-height: 68px;
          padding: 12px;
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
          display: block;
          min-width: 0;
          color: #151515;
          font-size: clamp(18px, 4.4vw, 22px);
          line-height: 1.12;
        }

        .gz-step small {
          display: block;
          margin-top: 4px;
          color: #667085;
          font-size: 13px;
          font-weight: 750;
          line-height: 1.3;
        }

        .gz-primary-action {
          min-height: 56px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
          background: #16a34a;
          color: #ffffff;
          padding: 0 18px;
          font-size: 17px;
          font-weight: 950;
          text-align: center;
          text-decoration: none;
          box-shadow: 0 16px 32px rgba(22, 163, 74, 0.22);
        }

        .gz-primary-action:hover {
          background: #12803a;
        }

        .gz-copy-card {
          display: grid;
          gap: 12px;
          padding: 15px;
          background: #ffffff;
        }

        .gz-copy-head {
          display: grid;
          gap: 4px;
        }

        .gz-copy-card h2 {
          margin-bottom: 0;
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

        .gz-modal-target {
          display: none;
        }

        .gz-modal-target:target {
          display: block;
        }

        .gz-corner-pointer {
          position: fixed;
          top: 10px;
          right: 26px;
          z-index: 50;
          display: grid;
          justify-items: end;
          gap: 6px;
          pointer-events: none;
        }

        .gz-corner-pointer i {
          position: relative;
          width: 104px;
          height: 7px;
          margin-right: 18px;
          border-radius: 999px;
          background: #ff0033;
          transform: rotate(-34deg);
          transform-origin: right center;
          box-shadow:
            0 0 0 4px rgba(255, 255, 255, 0.86),
            0 0 22px rgba(255, 0, 51, 0.7),
            0 12px 28px rgba(255, 0, 51, 0.38);
        }

        .gz-corner-pointer i::after {
          content: '';
          position: absolute;
          right: -3px;
          top: -8px;
          width: 0;
          height: 0;
          border-left: 20px solid #ff0033;
          border-top: 11px solid transparent;
          border-bottom: 11px solid transparent;
          filter: drop-shadow(0 0 5px rgba(255, 0, 51, 0.5));
        }

        .gz-modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 35;
          display: grid;
          align-items: end;
          padding: 12px;
          background: rgba(18, 21, 27, 0.56);
        }

        .gz-guide-modal {
          width: min(100%, 560px);
          margin: 0 auto;
          position: relative;
          display: grid;
          gap: 12px;
          border: 1px solid rgba(0, 213, 223, 0.36);
          border-radius: 8px;
          background: #ffffff;
          padding: 18px;
          box-shadow: 0 24px 70px rgba(18, 21, 27, 0.3);
        }

        .gz-modal-close {
          position: absolute;
          top: 10px;
          right: 10px;
          width: 38px;
          height: 38px;
          border: 0;
          border-radius: 50%;
          display: grid;
          place-items: center;
          background: #eef2f7;
          color: #12151b;
          font-size: 16px;
          font-weight: 950;
          text-decoration: none;
          cursor: pointer;
        }

        .gz-modal-kicker {
          width: fit-content;
          margin: 0;
          border-radius: 999px;
          background: #fff0f3;
          color: #fe2c55;
          padding: 7px 10px;
          font-size: 12px;
          font-weight: 950;
          text-transform: uppercase;
        }

        .gz-guide-modal h2 {
          max-width: 13ch;
          margin: 0;
          color: #111111;
          font-size: clamp(30px, 8vw, 42px);
          line-height: 0.98;
          letter-spacing: 0;
        }

        .gz-guide-modal > p:not(.gz-modal-kicker) {
          margin: 0;
          color: #495466;
          font-size: 16px;
          font-weight: 750;
          line-height: 1.36;
        }

        .gz-modal-steps {
          display: grid;
          gap: 8px;
          margin: 0;
          padding: 0;
          list-style: none;
        }

        .gz-modal-steps li {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 10px;
          align-items: center;
          min-height: 48px;
          border: 1px solid #e6e8ee;
          border-radius: 8px;
          background: #fbfcff;
          padding: 9px;
        }

        .gz-modal-steps span {
          width: 30px;
          height: 30px;
          display: grid;
          place-items: center;
          border-radius: 50%;
          background: #111111;
          color: #ffffff;
          font-size: 14px;
          font-weight: 950;
          box-shadow:
            -2px 0 0 #00d5df,
            2px 0 0 #fe2c55;
        }

        .gz-modal-steps strong {
          min-width: 0;
          color: #151515;
          font-size: 16px;
          line-height: 1.15;
        }

        .gz-modal-action {
          min-height: 52px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 0;
          border-radius: 8px;
          background: #111111;
          color: #ffffff;
          font-size: 16px;
          font-weight: 950;
          text-align: center;
          text-decoration: none;
          cursor: pointer;
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

          .gz-help-card,
          .gz-copy-card,
          .gz-open-card {
            margin: 8px;
          }

          .gz-help-card {
            padding: 10px;
          }

          .gz-alert-panel {
            grid-template-columns: 1fr;
            gap: 8px;
          }

          .gz-alert-mark {
            width: 44px;
            height: 44px;
            font-size: 25px;
          }

          .gz-step {
            min-height: 64px;
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
