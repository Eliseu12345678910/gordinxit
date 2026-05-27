'use client'

import { PortalErrorState } from '@/components/PortalErrorState'

export default function GlobalErrorPage({ reset }: { reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body>
        <PortalErrorState
          code="Erro"
          title="Nao foi possivel abrir"
          text="O Gordin du Xit encontrou um erro inesperado. Tente recarregar a pagina ou volte para os planos."
          primaryLabel="Tentar de novo"
          onPrimaryClick={reset}
          secondaryLabel="Ver planos"
          secondaryHref="/planos"
        />
      </body>
    </html>
  )
}
