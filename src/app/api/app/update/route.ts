import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest, NextResponse } from 'next/server'
import { isAdminUser } from '@/lib/admin-auth'
import { isAccountAccessBlocked } from '@/lib/account-block'
import { getAdminAuth, getAdminDb, isFirebaseAuthTokenError } from '@/lib/firebase-admin'

export const runtime = 'nodejs'

const settingsCollection = 'settings'
const appUpdateDoc = 'app-update'

type AppUpdateSettings = {
  enabled: boolean
  required: boolean
  latestVersionCode: number
  latestVersionName: string
  apkUrl: string
  message: string
  changelog: string
  updatedAtMillis?: number
}

const defaultSettings: AppUpdateSettings = {
  enabled: false,
  required: false,
  latestVersionCode: 1,
  latestVersionName: '1.0',
  apkUrl: '',
  message: 'Nova versao disponivel',
  changelog: '',
}

function toPositiveInt(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function toMillis(value: unknown) {
  if (!value || typeof value !== 'object') return undefined
  const maybeTimestamp = value as { toMillis?: () => number; seconds?: number }
  if (typeof maybeTimestamp.toMillis === 'function') return maybeTimestamp.toMillis()
  if (typeof maybeTimestamp.seconds === 'number') return maybeTimestamp.seconds * 1000
  return undefined
}

function normalizeSettings(data?: Record<string, unknown>): AppUpdateSettings {
  return {
    enabled: data?.enabled === true,
    required: data?.required === true,
    latestVersionCode: toPositiveInt(data?.latestVersionCode, defaultSettings.latestVersionCode),
    latestVersionName: String(data?.latestVersionName || defaultSettings.latestVersionName).trim(),
    apkUrl: String(data?.apkUrl || '').trim(),
    message: String(data?.message || defaultSettings.message).trim(),
    changelog: String(data?.changelog || '').trim(),
    updatedAtMillis: toMillis(data?.updatedAt),
  }
}

function withoutDownload(settings: AppUpdateSettings): AppUpdateSettings {
  return {
    ...settings,
    apkUrl: '',
  }
}

function timestampMillis(value: unknown) {
  if (!value || typeof value !== 'object') return 0
  const maybeTimestamp = value as { toMillis?: () => number; seconds?: number }
  if (typeof maybeTimestamp.toMillis === 'function') return maybeTimestamp.toMillis()
  if (typeof maybeTimestamp.seconds === 'number') return maybeTimestamp.seconds * 1000
  return 0
}

function hasActiveDownloadPlan(record: unknown) {
  if (!record || typeof record !== 'object') return false
  const data = record as Record<string, unknown>
  const subscription = data.subscription && typeof data.subscription === 'object'
    ? data.subscription as Record<string, unknown>
    : {}
  const status = String(subscription.status || '')
  const plan = String(subscription.plan || '')
  const expiresMillis = timestampMillis(subscription.expiresAt)
  return status === 'active'
    && ['daily', 'weekly', 'monthly', 'lifetime'].includes(plan)
    && (!expiresMillis || expiresMillis > Date.now())
}

function canDownloadDevice(record: unknown) {
  if (!record || typeof record !== 'object') return false
  const data = record as Record<string, unknown>
  const profile = data.profile && typeof data.profile === 'object'
    ? data.profile as Record<string, unknown>
    : data.leadProfile && typeof data.leadProfile === 'object'
      ? data.leadProfile as Record<string, unknown>
      : {}
  const device = String(profile.device || '')
  return device === 'android' || device === 'emulator'
}

async function readSettings() {
  const adminDb = getAdminDb()
  const snapshot = await adminDb.collection(settingsCollection).doc(appUpdateDoc).get()
  return normalizeSettings(snapshot.data())
}

export async function GET(request: NextRequest) {
  try {
    const settings = await readSettings()
    let safeSettings = withoutDownload(settings)
    const currentVersionCode = toPositiveInt(
      new URL(request.url).searchParams.get('versionCode'),
      0,
    )
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : ''

    if (token) {
      const adminAuth = getAdminAuth()
      const adminDb = getAdminDb()
      const decodedToken = await adminAuth.verifyIdToken(token)
      const isAdmin = await isAdminUser(decodedToken.uid, decodedToken.email)

      if (isAdmin) {
        safeSettings = settings
      } else {
        const chatId = request.nextUrl.searchParams.get('chatId')?.trim() || ''
        const accountId = request.nextUrl.searchParams.get('accountId')?.trim().toLowerCase() || ''
        const [chatSnapshot, accountSnapshot] = await Promise.all([
          chatId ? adminDb.collection('chats').doc(chatId).get() : Promise.resolve(null),
          accountId ? adminDb.collection('accounts').doc(accountId).get() : Promise.resolve(null),
        ])
        const chat = chatSnapshot?.data()
        const account = accountSnapshot?.data()
        const participantUids = Array.isArray(chat?.participantUids) ? chat.participantUids : []
        const chatAccountId = String(chat?.accountId || chat?.usernameKey || '').toLowerCase()
        const ownsChat = Boolean(chatSnapshot?.exists && accountId && chatAccountId === accountId)
        const participates = participantUids.includes(decodedToken.uid)

        if (
          ownsChat &&
          participates &&
          !isAccountAccessBlocked(chat) &&
          !isAccountAccessBlocked(account) &&
          (hasActiveDownloadPlan(account) || hasActiveDownloadPlan(chat)) &&
          (canDownloadDevice(account) || canDownloadDevice(chat))
        ) {
          safeSettings = settings
        }
      }
    }

    const updateAvailable =
      safeSettings.enabled &&
      Boolean(safeSettings.apkUrl) &&
      safeSettings.latestVersionCode > currentVersionCode

    return NextResponse.json({
      ...safeSettings,
      currentVersionCode,
      updateAvailable,
    })
  } catch (error) {
    if (isFirebaseAuthTokenError(error)) {
      return NextResponse.json({ error: 'Sessao invalida.' }, { status: 401 })
    }
    console.error('App update settings error:', error)
    return NextResponse.json(
      {
        ...withoutDownload(defaultSettings),
        currentVersionCode: 0,
        updateAvailable: false,
        error: 'Nao foi possivel buscar a atualizacao do app.',
      },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<AppUpdateSettings> & { idToken?: string }

    if (!body.idToken) {
      return NextResponse.json({ error: 'Sessao invalida.' }, { status: 401 })
    }

    const decodedToken = await getAdminAuth().verifyIdToken(body.idToken)

    if (!(await isAdminUser(decodedToken.uid, decodedToken.email))) {
      return NextResponse.json({ error: 'Admin nao autorizado.' }, { status: 403 })
    }

    const enabled = body.enabled === true
    const required = body.required === true
    const latestVersionCode = toPositiveInt(body.latestVersionCode, defaultSettings.latestVersionCode)
    const latestVersionName = String(body.latestVersionName || latestVersionCode).trim()
    const apkUrl = String(body.apkUrl || '').trim()
    const message = String(body.message || defaultSettings.message).trim()
    const changelog = String(body.changelog || '').trim()

    if (enabled && !apkUrl) {
      return NextResponse.json({ error: 'Informe o link da nova versao.' }, { status: 400 })
    }

    if (apkUrl && !/^https?:\/\//i.test(apkUrl)) {
      return NextResponse.json({ error: 'Use um link com http ou https.' }, { status: 400 })
    }

    const adminDb = getAdminDb()
    await adminDb.collection(settingsCollection).doc(appUpdateDoc).set(
      {
        enabled,
        required,
        latestVersionCode,
        latestVersionName,
        apkUrl,
        message,
        changelog,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: decodedToken.uid,
      },
      { merge: true },
    )

    return NextResponse.json({
      enabled,
      required,
      latestVersionCode,
      latestVersionName,
      apkUrl,
      message,
      changelog,
      updateAvailable: false,
    })
  } catch (error) {
    if (isFirebaseAuthTokenError(error)) {
      return NextResponse.json({ error: 'Sessao invalida.' }, { status: 401 })
    }
    console.error('App update save error:', error)
    return NextResponse.json({ error: 'Nao foi possivel salvar a atualizacao.' }, { status: 500 })
  }
}
