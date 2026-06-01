import { ClientPortal } from '@/components/ClientPortal'

export default function PaySemanalExternalPage() {
  return <ClientPortal checkoutPlan="weekly" checkoutMode="pix" checkoutContext="external" />
}
