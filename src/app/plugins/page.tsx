import { ClientPortal } from '@/components/ClientPortal'

export default async function PluginsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const preview = params?.preview
  const previewPlugin = preview === 'plugin' || params?.previewPlugin === '1'

  return <ClientPortal initialTab="plugins" previewPlugin={previewPlugin} />
}
