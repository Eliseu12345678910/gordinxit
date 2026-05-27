import { ClientPortal } from '@/components/ClientPortal'

export default async function PlanosPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const preview = params?.preview
  const loginPreview = params?.loginPreview
  const previewAuth = preview === 'login' || loginPreview === '1'

  return <ClientPortal initialTab="plans" previewAuth={previewAuth} />
}
