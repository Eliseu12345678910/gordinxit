import { ClientPortal } from '@/components/ClientPortal'

export default function PayMensalInternalPage() {
  return <ClientPortal checkoutPlan="monthly" checkoutMode="pix" checkoutContext="internal" />
}
