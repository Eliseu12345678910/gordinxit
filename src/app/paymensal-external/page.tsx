import { ClientPortal } from '@/components/ClientPortal'

export default function PayMensalExternalPage() {
  return <ClientPortal checkoutPlan="monthly" checkoutMode="pix" checkoutContext="external" />
}
