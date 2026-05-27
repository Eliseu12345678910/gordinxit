import { PortalErrorState } from '@/components/PortalErrorState'

export default function NotFoundPage() {
  return (
    <PortalErrorState
      title="Pagina nao encontrada"
      text="O link pode ter expirado, mudado ou nao existir mais. Volte para os planos do Gordin du Xit e continue por la."
      primaryLabel="Ver planos"
      primaryHref="/planos"
    />
  )
}
