import { PortalErrorState } from '@/components/PortalErrorState'

export function AccessNotFound() {
  return (
    <PortalErrorState
      title="Pagina nao encontrada"
      text="Esse acesso nao esta disponivel ou nao pertence a esta conta do Gordin du Xit."
      primaryLabel="Ir para planos"
      primaryHref="/planos"
    />
  )
}
