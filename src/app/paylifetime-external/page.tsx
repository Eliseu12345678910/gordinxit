import { ClientPortal } from '@/components/ClientPortal'

export default function PayLifetimeExternalPage() {
  return <ClientPortal checkoutPlan="lifetime" checkoutMode="pix" checkoutContext="external" />
}
