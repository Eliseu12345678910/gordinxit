import { auth } from '@/lib/firebase'

export type AppUpdateSettings = {
  enabled: boolean
  required: boolean
  latestVersionCode: number
  latestVersionName: string
  apkUrl: string
  message: string
  changelog: string
  currentVersionCode?: number
  updateAvailable?: boolean
  updatedAtMillis?: number
}

export const defaultAppUpdateSettings: AppUpdateSettings = {
  enabled: false,
  required: false,
  latestVersionCode: 1,
  latestVersionName: '1.0',
  apkUrl: '',
  message: 'Nova versao disponivel',
  changelog: '',
}

export async function loadAppUpdateSettings(options: { chatId?: string; accountId?: string } = {}) {
  const params = new URLSearchParams()
  if (options.chatId) params.set('chatId', options.chatId)
  if (options.accountId) params.set('accountId', options.accountId)
  const user = auth.currentUser
  const idToken = user ? await user.getIdToken().catch(() => '') : ''
  const response = await fetch(`/api/app/update${params.size ? `?${params}` : ''}`, {
    cache: 'no-store',
    headers: idToken ? { Authorization: `Bearer ${idToken}` } : undefined,
  })
  const payload = (await response.json()) as AppUpdateSettings & { error?: string }

  if (!response.ok) {
    throw new Error(payload.error || 'Nao foi possivel carregar a atualizacao do app.')
  }

  return payload
}

export async function saveAppUpdateSettings(settings: AppUpdateSettings) {
  const user = auth.currentUser
  if (!user || user.isAnonymous) throw new Error('Admin nao autenticado.')

  const idToken = await user.getIdToken()
  const response = await fetch('/api/app/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idToken,
      ...settings,
    }),
  })
  const payload = (await response.json()) as AppUpdateSettings & { error?: string }

  if (!response.ok) {
    throw new Error(payload.error || 'Nao foi possivel salvar a atualizacao do app.')
  }

  return payload
}
