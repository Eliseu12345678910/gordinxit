import { ClientPortal } from '@/components/ClientPortal'

export default function PaySemanalInternalPage() {
  return <ClientPortal checkoutPlan="weekly" checkoutMode="pix" checkoutContext="internal" />
}
