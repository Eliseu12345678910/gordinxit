import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest, NextResponse } from 'next/server'
import { isAdminUser } from '@/lib/admin-auth'
import { getAdminAuth, getAdminDb, isFirebaseAuthTokenError } from '@/lib/firebase-admin'
import { defaultPcAccessSettings, type PcAccessDownloadSettings, type PcAccessSettings } from '@/lib/pc-access'
import type { ResellerAccessType } from '@/types/chat'

export const runtime = 'nodejs'

const settingsDoc = 'pc-access'
const accessTypes: ResellerAccessType[] = ['internal', 'external']

function cleanString(value: unknown, fallback: string, maxLength = 300) {
  const clean = typeof value === 'string' ? value.trim() : ''
  return clean ? clean.slice(0, maxLength) : fallback
}

function cleanUrl(value: unknown) {
  const clean = typeof value === 'string' ? value.trim() : ''
  if (!clean) return ''
  try {
    const url = new URL(clean)
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString()
  } catch {
    return ''
  }
  return ''
}

function cleanFiles(value: unknown, fallback: PcAccessDownloadSettings['files']) {
  if (!Array.isArray(value)) return fallback

  const files = value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const data = item as Record<string, unknown>
      const label = cleanString(data.label, '', 80)
      const url = cleanUrl(data.url)
      if (!label || !url) return null
      return { label, url }
    })
    .filter((item): item is PcAccessDownloadSettings['files'][number] => Boolean(item))

  return files.length ? files.slice(0, 8) : fallback
}

function normalizeDownload(type: ResellerAccessType, data?: Record<string, unknown>): PcAccessDownloadSettings {
  const fallback = defaultPcAccessSettings[type]
  const downloadUrl = cleanUrl(data?.downloadUrl) || fallback.downloadUrl
  const files = cleanFiles(data?.files, fallback.files)
  const tutorials = cleanFiles(data?.tutorials, fallback.tutorials)
  const fixErrors = cleanFiles(data?.fixErrors, fallback.fixErrors)
  const hasConfiguredFiles = Array.isArray(data?.files)

  return {
    enabled: data?.enabled === false && hasConfiguredFiles ? false : data?.enabled === true || fallback.enabled,
    title: cleanString(data?.title, fallback.title, 60),
    versionName: cleanString(data?.versionName, fallback.versionName, 40),
    downloadUrl,
    files,
    tutorials,
    fixErrors,
    tutorialUrl: cleanUrl(data?.tutorialUrl),
    notes: cleanString(data?.notes, fallback.notes, 500),
  }
}

function normalizeSettings(data?: Record<string, unknown>): PcAccessSettings {
  return {
    internal: normalizeDownload('internal', data?.internal as Record<string, unknown> | undefined),
    external: normalizeDownload('external', data?.external as Record<string, unknown> | undefined),
  }
}

async function readSettings() {
  const snapshot = await getAdminDb().collection('settings').doc(settingsDoc).get()
  return normalizeSettings(snapshot.data())
}

function withoutPrivateLinks(settings: PcAccessSettings, allowed: Partial<Record<ResellerAccessType, boolean>> = {}) {
  return accessTypes.reduce((result, type) => {
    result[type] = allowed[type]
      ? settings[type]
      : {
          ...settings[type],
          downloadUrl: '',
          files: [],
          tutorials: [],
          fixErrors: [],
          tutorialUrl: '',
        }
    return result
  }, {} as PcAccessSettings)
}

function isActiveAccess(access: unknown) {
  if (!access || typeof access !== 'object') return false
  const data = access as Record<string, unknown>
  if (data.status !== 'active') return false
  const expiresAt = data.expiresAt as { toDate?: () => Date } | null | undefined
  const expiresDate = expiresAt?.toDate?.()
  return !expiresDate || expiresDate.getTime() > Date.now()
}

export async function GET(request: NextRequest) {
  try {
    const settings = await readSettings()
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : ''

    if (!token) {
      return NextResponse.json(withoutPrivateLinks(settings))
    }

    const decodedToken = await getAdminAuth().verifyIdToken(token)

    if (await isAdminUser(decodedToken.uid, decodedToken.email)) {
      return NextResponse.json(settings)
    }

    const chatId = (request.nextUrl.searchParams.get('chatId') || '').trim()
    if (!chatId) {
      return NextResponse.json(withoutPrivateLinks(settings))
    }

    const chatSnapshot = await getAdminDb().collection('chats').doc(chatId).get()
    const chat = chatSnapshot.data()
    const participantUids = Array.isArray(chat?.participantUids) ? chat.participantUids : []
    const ownerUid = typeof chat?.ownerUid === 'string' ? chat.ownerUid : ''

    if (!chatSnapshot.exists || (ownerUid !== decodedToken.uid && !participantUids.includes(decodedToken.uid))) {
      return NextResponse.json(withoutPrivateLinks(settings))
    }

    const resellerAccess = chat?.resellerAccess && typeof chat.resellerAccess === 'object'
      ? chat.resellerAccess as Record<ResellerAccessType, unknown>
      : undefined

    return NextResponse.json(withoutPrivateLinks(settings, {
      internal: isActiveAccess(resellerAccess?.internal),
      external: isActiveAccess(resellerAccess?.external),
    }))
  } catch (error) {
    console.error('PC access settings error:', error)
    return NextResponse.json({ ...withoutPrivateLinks(defaultPcAccessSettings), error: 'Nao foi possivel buscar os downloads PC.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<PcAccessSettings> & { idToken?: string }

    if (!body.idToken) {
      return NextResponse.json({ error: 'Sessao invalida.' }, { status: 401 })
    }

    const decodedToken = await getAdminAuth().verifyIdToken(body.idToken)

    if (!(await isAdminUser(decodedToken.uid, decodedToken.email))) {
      return NextResponse.json({ error: 'Admin nao autorizado.' }, { status: 403 })
    }

    const settings = normalizeSettings(body as Record<string, unknown>)

    for (const type of accessTypes) {
      const item = settings[type]
      if (item.enabled && !item.downloadUrl && item.files.length === 0) {
        return NextResponse.json({ error: `Informe o link de download ${item.title}.` }, { status: 400 })
      }
    }

    await getAdminDb().collection('settings').doc(settingsDoc).set(
      {
        ...settings,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: decodedToken.uid,
      },
      { merge: true },
    )

    return NextResponse.json(settings)
  } catch (error) {
    if (isFirebaseAuthTokenError(error)) {
      return NextResponse.json({ error: 'Sessao invalida.' }, { status: 401 })
    }
    console.error('PC access settings save error:', error)
    return NextResponse.json({ error: 'Nao foi possivel salvar os downloads PC.' }, { status: 500 })
  }
}
