'use client'

import { PortalErrorState } from '@/components/PortalErrorState'

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <PortalErrorState
      code="Erro"
      title="Algo saiu fora do ponto"
      text="A pagina nao carregou como deveria. Tente novamente ou volte para os planos do Gordin du Xit."
      primaryLabel="Tentar de novo"
      onPrimaryClick={reset}
      secondaryLabel="Ver planos"
      secondaryHref="/planos"
    />
  )
}
