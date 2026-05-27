'use client'

type PortalErrorStateProps = {
  code?: string
  title: string
  text: string
  primaryLabel?: string
  primaryHref?: string
  onPrimaryClick?: () => void
  secondaryLabel?: string
  secondaryHref?: string
}

export function PortalErrorState({
  code = '404',
  title,
  text,
  primaryLabel = 'Ir para planos',
  primaryHref = '/planos',
  onPrimaryClick,
  secondaryLabel = 'Voltar ao inicio',
  secondaryHref = '/',
}: PortalErrorStateProps) {
  return (
    <main className="portal-error-page">
      <section className="portal-error-card" role="alert" aria-label={title}>
        <span>{code}</span>
        <h1>{title}</h1>
        <p>{text}</p>

        <div className="portal-error-actions">
          {onPrimaryClick ? (
            <button type="button" onClick={onPrimaryClick}>
              {primaryLabel}
            </button>
          ) : (
            <a href={primaryHref}>{primaryLabel}</a>
          )}
          <a href={secondaryHref}>{secondaryLabel}</a>
        </div>
      </section>

      <style jsx>{`
        .portal-error-page {
          min-height: 100vh;
          display: grid;
          place-items: center;
          overflow: hidden;
          background:
            radial-gradient(circle at 20% 8%, rgba(20, 184, 166, 0.2), transparent 23rem),
            radial-gradient(circle at 84% 10%, rgba(249, 115, 22, 0.15), transparent 22rem),
            linear-gradient(180deg, #fbfcfe 0%, #eef3f8 100%);
          color: #0f172a;
          padding: 18px;
        }

        .portal-error-card {
          width: min(100%, 520px);
          display: grid;
          justify-items: center;
          gap: 12px;
          border: 1px solid rgba(148, 163, 184, 0.22);
          border-radius: 24px;
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.96));
          padding: clamp(24px, 6vw, 44px);
          text-align: center;
          box-shadow: 0 28px 80px rgba(15, 23, 42, 0.14);
        }

        .portal-error-card span {
          display: inline-flex;
          min-height: 38px;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(20, 184, 166, 0.22);
          border-radius: 999px;
          background: #f0fdfa;
          color: #0f766e;
          padding: 0 14px;
          font-size: 12px;
          font-weight: 950;
          text-transform: uppercase;
        }

        .portal-error-card h1 {
          margin: 4px 0 0;
          background: linear-gradient(135deg, #111827, #0f766e 58%, #f97316);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          font-size: clamp(38px, 9vw, 64px);
          line-height: 0.9;
        }

        .portal-error-card p {
          max-width: 410px;
          margin: 0;
          color: #475569;
          font-size: 14px;
          font-weight: 780;
          line-height: 1.45;
        }

        .portal-error-actions {
          width: 100%;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          margin-top: 8px;
        }

        .portal-error-actions a,
        .portal-error-actions button {
          min-height: 48px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 0;
          border-radius: 14px;
          padding: 0 14px;
          font-size: 12px;
          font-weight: 950;
          text-decoration: none;
          text-transform: uppercase;
          cursor: pointer;
        }

        .portal-error-actions a:first-child,
        .portal-error-actions button {
          background: linear-gradient(135deg, #111827, #0f172a);
          color: #ffffff;
          box-shadow: 0 18px 36px rgba(15, 23, 42, 0.2);
        }

        .portal-error-actions a:last-child {
          border: 1px solid rgba(148, 163, 184, 0.24);
          background: #ffffff;
          color: #334155;
        }

        @media (max-width: 520px) {
          .portal-error-actions {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  )
}
