import type { ResellerAccessType } from '@/types/chat'

export type PcAccessDownloadSettings = {
  enabled: boolean
  title: string
  versionName: string
  downloadUrl: string
  files: PcAccessDownloadFile[]
  tutorials: PcAccessDownloadFile[]
  fixErrors: PcAccessDownloadFile[]
  tutorialUrl: string
  notes: string
}

export type PcAccessDownloadFile = {
  label: string
  url: string
}

export type PcAccessSettings = Record<ResellerAccessType, PcAccessDownloadSettings>

export const defaultPcAccessSettings: PcAccessSettings = {
  internal: {
    enabled: true,
    title: 'Internal',
    versionName: 'FreeFire V7A',
    downloadUrl: 'https://www.mediafire.com/file/fn4rq4mp6d5l4u8/Garena_Free_Fire_1.123.1_apkcombo.com.xapk/file',
    files: [
      {
        label: 'FreeFire V7A',
        url: 'https://www.mediafire.com/file/fn4rq4mp6d5l4u8/Garena_Free_Fire_1.123.1_apkcombo.com.xapk/file',
      },
      {
        label: 'Everything.exe',
        url: 'https://www.mediafire.com/file/b3n4foc5gdt04lm/Everything.exe/file',
      },
    ],
    tutorials: [],
    fixErrors: [],
    tutorialUrl: '',
    notes: '',
  },
  external: {
    enabled: true,
    title: 'External',
    versionName: 'SysResetErr.exe',
    downloadUrl: 'https://www.mediafire.com/file/l56i91momgodvfx/SysResetErr.exe/file',
    files: [
      {
        label: 'SysResetErr.exe',
        url: 'https://www.mediafire.com/file/l56i91momgodvfx/SysResetErr.exe/file',
      },
    ],
    tutorials: [],
    fixErrors: [],
    tutorialUrl: '',
    notes: '',
  },
}

export async function loadPcAccessSettings(options: { chatId?: string; accountId?: string } = {}) {
  const { auth } = await import('@/lib/firebase')
  const params = new URLSearchParams()
  if (options.chatId) params.set('chatId', options.chatId)
  if (options.accountId) params.set('accountId', options.accountId)
  const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : ''
  const response = await fetch(`/api/pc-access/settings${params.size ? `?${params.toString()}` : ''}`, {
    cache: 'no-store',
    headers: idToken ? { Authorization: `Bearer ${idToken}` } : undefined,
  })
  const payload = (await response.json()) as PcAccessSettings & { error?: string }

  if (!response.ok) {
    throw new Error(payload.error || 'Nao foi possivel carregar os downloads PC.')
  }

  return payload
}

export async function savePcAccessSettings(settings: PcAccessSettings) {
  const { auth } = await import('@/lib/firebase')
  const user = auth.currentUser
  if (!user || user.isAnonymous) throw new Error('Admin nao autenticado.')

  const idToken = await user.getIdToken()
  const response = await fetch('/api/pc-access/settings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idToken,
      ...settings,
    }),
  })
  const payload = (await response.json()) as PcAccessSettings & { error?: string }

  if (!response.ok) {
    throw new Error(payload.error || 'Nao foi possivel salvar os downloads PC.')
  }

  return payload
}
