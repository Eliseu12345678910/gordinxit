import { ClientPortal } from '@/components/ClientPortal'

export default function PayDiariaExternalPage() {
  return <ClientPortal checkoutPlan="daily" checkoutMode="pix" checkoutContext="external" />
}
