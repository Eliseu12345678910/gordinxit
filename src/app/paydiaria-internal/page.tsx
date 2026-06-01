import { ClientPortal } from '@/components/ClientPortal'

export default function PayDiariaInternalPage() {
  return <ClientPortal checkoutPlan="daily" checkoutMode="pix" checkoutContext="internal" />
}
