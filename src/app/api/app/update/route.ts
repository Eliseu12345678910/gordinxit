import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest, NextResponse } from 'next/server'
import { isAdminUser } from '@/lib/admin-auth'
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin'

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

async function readSettings() {
  const adminDb = getAdminDb()
  const snapshot = await adminDb.collection(settingsCollection).doc(appUpdateDoc).get()
  return normalizeSettings(snapshot.data())
}

export async function GET(request: NextRequest) {
  try {
    const settings = await readSettings()
    const currentVersionCode = toPositiveInt(
      new URL(request.url).searchParams.get('versionCode'),
      0,
    )
    const updateAvailable =
      settings.enabled &&
      Boolean(settings.apkUrl) &&
      settings.latestVersionCode > currentVersionCode

    return NextResponse.json({
      ...settings,
      currentVersionCode,
      updateAvailable,
    })
  } catch (error) {
    console.error('App update settings error:', error)
    return NextResponse.json(
      {
        ...defaultSettings,
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
    console.error('App update save error:', error)
    return NextResponse.json({ error: 'Nao foi possivel salvar a atualizacao.' }, { status: 500 })
  }
}
