import { ClientPortal } from '@/components/ClientPortal'

export default function PayLifetimeInternalPage() {
  return <ClientPortal checkoutPlan="lifetime" checkoutMode="pix" checkoutContext="internal" />
}
