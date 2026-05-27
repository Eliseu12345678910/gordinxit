import { scryptSync, timingSafeEqual } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest, NextResponse } from 'next/server'
import { isAccountAccessBlocked } from '@/lib/account-block'
import { getAdminDb } from '@/lib/firebase-admin'
import { isPhoneInput, normalizeBrazilPhone } from '@/lib/phone'

export const runtime = 'nodejs'

const planLabels = {
  weekly: 'Semanal',
  monthly: 'Mensal',
  lifetime: 'Vitalicio',
} as const

type PlanType = keyof typeof planLabels

function normalizeUsername(username: string) {
  const clean = username.trim().toLowerCase()
  const phoneDigits = normalizeBrazilPhone(clean)

  if (phoneDigits.length >= 10 && isPhoneInput(clean)) {
    return phoneDigits
  }

  return clean
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString('hex')
}

function verifyPassword(password: string, salt: string, hash: string) {
  const candidate = Buffer.from(hashPassword(password, salt), 'hex')
  const stored = Buffer.from(hash, 'hex')
  return candidate.length === stored.length && timingSafeEqual(candidate, stored)
}

function isPlan(value: unknown): value is PlanType {
  return value === 'weekly' || value === 'monthly' || value === 'lifetime'
}

function timestampMillis(value: unknown) {
  if (!value || typeof value !== 'object') return 0
  const maybeTimestamp = value as { toMillis?: () => number; seconds?: number }
  if (typeof maybeTimestamp.toMillis === 'function') return maybeTimestamp.toMillis()
  if (typeof maybeTimestamp.seconds === 'number') return maybeTimestamp.seconds * 1000
  return 0
}

function formatExpiry(value: unknown) {
  const millis = timestampMillis(value)
  if (!millis) return 'Permanente'
  return new Date(millis).toLocaleDateString('pt-BR')
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      username?: string
      password?: string
      androidId?: string
      deviceModel?: string
      manufacturer?: string
      osVersion?: string
      brand?: string
    }

    const username = normalizeUsername(String(body.username || ''))
    const password = String(body.password || '')
    const androidId = String(body.androidId || '').trim()

    if (!username) {
      return NextResponse.json(
        {
          allowed: false,
          message: 'Informe o telefone cadastrado no Gordin du Xit.',
        },
        { status: 400 },
      )
    }

    if (!androidId) {
      return NextResponse.json(
        {
          allowed: false,
          message: 'Nao foi possivel identificar este aparelho.',
          code: 'missing_device_id',
        },
        { status: 400 },
      )
    }

    const adminDb = getAdminDb()
    const accountRef = adminDb.collection('accounts').doc(username)
    const accountSnapshot = await accountRef.get()

    if (!accountSnapshot.exists) {
      return NextResponse.json(
        {
          allowed: false,
          message: 'Conta nao encontrada. Entre pelo site do Gordin du Xit primeiro.',
        },
        { status: 404 },
      )
    }

    const account = accountSnapshot.data()

    if (isAccountAccessBlocked(account)) {
      return NextResponse.json(
        {
          allowed: false,
          message: 'Pagina nao encontrada.',
          code: 'account_blocked',
        },
        { status: 404 },
      )
    }

    if (password) {
      const passwordSalt = String(account?.passwordSalt || '')
      const passwordHash = String(account?.passwordHash || '')

      if (passwordSalt && passwordHash && !verifyPassword(password, passwordSalt, passwordHash)) {
        return NextResponse.json(
          {
            allowed: false,
            message: 'Telefone ou senha incorretos.',
          },
          { status: 401 },
        )
      }
    }

    const subscription =
      account?.subscription && typeof account.subscription === 'object'
        ? (account.subscription as Record<string, unknown>)
        : {}
    const plan = String(subscription.plan || '')
    const status = String(subscription.status || '')
    const expiresAt = subscription.expiresAt
    const expiresMillis = timestampMillis(expiresAt)
    const isExpired = Boolean(expiresMillis && expiresMillis <= Date.now())
    const hasActivePlan = status === 'active' && isPlan(plan) && !isExpired
    const plugin =
      account?.plugin && typeof account.plugin === 'object'
        ? (account.plugin as Record<string, unknown>)
        : {}
    const pluginStatus = String(plugin.status || 'inactive')
    const pluginName = String(plugin.name || 'ServiceSync Core')
    const pluginActive = pluginStatus === 'active'

    if (!hasActivePlan) {
      return NextResponse.json(
        {
          allowed: false,
          accountId: username,
          message: isExpired
            ? 'Seu plano expirou. Fale com o vendedor do Gordin du Xit.'
            : 'Voce nao possui plano para entrar dentro do xit.',
        },
        { status: 403 },
      )
    }

    const currentAppDevice =
      account?.appDevice && typeof account.appDevice === 'object'
        ? (account.appDevice as Record<string, unknown>)
        : {}
    const boundAndroidId = String(currentAppDevice.androidId || '').trim()

    if (boundAndroidId && boundAndroidId !== androidId) {
      return NextResponse.json(
        {
          allowed: false,
          accountId: username,
          message: 'Este acesso ja esta vinculado a outro aparelho. Fale com o vendedor para trocar o aparelho autorizado.',
          code: 'device_mismatch',
          deviceLocked: true,
        },
        { status: 403 },
      )
    }

    const appDevice = {
      ...currentAppDevice,
      androidId,
      deviceModel: String(body.deviceModel || ''),
      manufacturer: String(body.manufacturer || ''),
      osVersion: String(body.osVersion || ''),
      brand: String(body.brand || ''),
      lockedAt: currentAppDevice.lockedAt || FieldValue.serverTimestamp(),
      lastAppAccessAt: FieldValue.serverTimestamp(),
    }

    await accountRef.set(
      {
        appDevice,
        appDeviceLocked: true,
        lastAppAccessAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

    return NextResponse.json({
      allowed: true,
      accountId: username,
      username: account?.accessUsername || username,
      androidId,
      deviceModel: String(body.deviceModel || ''),
      deviceLocked: true,
      plan,
      planLabel: planLabels[plan],
      expiry: formatExpiry(expiresAt),
      premium: true,
      admin: false,
      pluginActive,
      pluginStatus,
      pluginName,
      message: 'Login autorizado.',
    })
  } catch (error) {
    console.error('App access error:', error)
    return NextResponse.json(
      {
        allowed: false,
        message: 'Nao foi possivel validar seu acesso agora.',
      },
      { status: 500 },
    )
  }
}
