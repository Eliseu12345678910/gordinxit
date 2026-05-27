import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { NextRequest, NextResponse } from 'next/server'
import { isAccountAccessBlocked } from '@/lib/account-block'
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin'
import { isPhoneInput, normalizeBrazilPhone } from '@/lib/phone'

export const runtime = 'nodejs'

const usernamePattern = /^[a-zA-Z0-9_.-]{2,24}$/
const validBrazilDdds = new Set([
  '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '21', '22', '24', '27', '28',
  '31', '32', '33', '34', '35', '37', '38',
  '41', '42', '43', '44', '45', '46', '47', '48', '49',
  '51', '53', '54', '55',
  '61', '62', '63', '64', '65', '66', '67', '68', '69',
  '71', '73', '74', '75', '77', '79',
  '81', '82', '83', '84', '85', '86', '87', '88', '89',
  '91', '92', '93', '94', '95', '96', '97', '98', '99',
])
const deviceValues = new Set(['android', 'ios', 'emulator'])
const planValues = new Set(['weekly', 'monthly', 'lifetime'])
type IntroAudioKey = 'start' | 'start-live'

function normalizeUsername(username: string) {
  const clean = username.trim().toLowerCase()
  const phoneDigits = normalizeBrazilPhone(clean)

  if (phoneDigits.length >= 10 && isPhoneInput(clean)) {
    return phoneDigits
  }

  return clean
}

function validateBrazilPhone(digits: string) {
  if (digits.length !== 10 && digits.length !== 11) return 'Digite seu WhatsApp com DDD.'
  if (!validBrazilDdds.has(digits.slice(0, 2))) return 'Confira o DDD do seu numero.'
  if (/^(\d)\1+$/.test(digits)) return 'Digite um numero de WhatsApp valido.'
  return ''
}

function validateUsername(username: string) {
  const normalized = normalizeUsername(username)

  if (/^\d+$/.test(normalized)) return validateBrazilPhone(normalized)

  if (!usernamePattern.test(normalized)) {
    return 'Digite um WhatsApp com DDD ou usuario valido.'
  }
  return ''
}

function validatePassword(password: string) {
  if (password.length < 4) return 'Senha deve ter pelo menos 4 caracteres.'
  if (password.length > 32) return 'Senha deve ter no maximo 32 caracteres.'
  return ''
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString('hex')
}

function verifyPassword(password: string, salt: string, hash: string) {
  const candidate = Buffer.from(hashPassword(password, salt), 'hex')
  const stored = Buffer.from(hash, 'hex')
  return candidate.length === stored.length && timingSafeEqual(candidate, stored)
}

function readRecordValue(record: unknown, key: string) {
  if (!record || typeof record !== 'object') return ''
  const value = (record as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

function getAccessProfile(account: unknown, chat: unknown) {
  const accountProfile = account && typeof account === 'object'
    ? (account as Record<string, unknown>).profile
    : undefined
  const accountPurchaseIntent = account && typeof account === 'object'
    ? (account as Record<string, unknown>).purchaseIntent
    : undefined
  const chatLeadProfile = chat && typeof chat === 'object'
    ? (chat as Record<string, unknown>).leadProfile
    : undefined
  const chatSelectedPlan = chat && typeof chat === 'object'
    ? (chat as Record<string, unknown>).selectedPlan
    : undefined

  const device = readRecordValue(accountProfile, 'device') || readRecordValue(chatLeadProfile, 'device')
  const plan = readRecordValue(accountPurchaseIntent, 'plan') || readRecordValue(chatSelectedPlan, 'plan')

  return {
    ...(deviceValues.has(device) ? { device } : {}),
    ...(planValues.has(plan) ? { plan } : {}),
  }
}

function getSavedIntroAudioKey(account: unknown, chat: unknown): IntroAudioKey {
  const chatIntro = readRecordValue(chat, 'introAudioKey')
  const accountIntro = readRecordValue(account, 'introAudioKey')
  return chatIntro === 'start-live' || accountIntro === 'start-live' ? 'start-live' : 'start'
}

async function getCurrentIntroAudioKey(adminDb: Firestore): Promise<IntroAudioKey> {
  const settingsSnapshot = await adminDb.collection('settings').doc('chat-private').get()
  return settingsSnapshot.data()?.liveIntroEnabled === true ? 'start-live' : 'start'
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      idToken?: string
      username?: string
      password?: string
      clientId?: string
      requestedChatId?: string
      mode?: 'login' | 'signup'
    }

    if (!body.idToken) {
      return NextResponse.json({ error: 'Sessao invalida.' }, { status: 401 })
    }

    const adminAuth = getAdminAuth()
    const adminDb = getAdminDb()
    const decodedToken = await adminAuth.verifyIdToken(body.idToken)
    const uid = decodedToken.uid
    const username = normalizeUsername(String(body.username || ''))
    const password = String(body.password || '')
    const mode = body.mode === 'signup' ? 'signup' : 'login'
    const usernameError = validateUsername(username)
    const passwordError = password ? validatePassword(password) : ''

    if (usernameError || passwordError) {
      return NextResponse.json({ error: usernameError || passwordError }, { status: 400 })
    }

    const usernameKey = username
    const accountRef = adminDb.collection('accounts').doc(usernameKey)
    const accountSnapshot = await accountRef.get()

    if (accountSnapshot.exists) {
      const account = accountSnapshot.data()

      if (isAccountAccessBlocked(account)) {
        return NextResponse.json(
          { error: 'Pagina nao encontrada.', code: 'account_blocked' },
          { status: 404 },
        )
      }

      const chatId = String(account?.chatId || body.requestedChatId || adminDb.collection('chats').doc().id)
      const chatRef = adminDb.collection('chats').doc(chatId)
      const chatSnapshot = await chatRef.get()
      const chat = chatSnapshot.data()
      const introAudioKey = getSavedIntroAudioKey(account, chat)

      await accountRef.set(
        {
          introAudioKey,
          lastAccessAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )

      await chatRef.set(
        {
          accountId: usernameKey,
          clientId: body.clientId || '',
          ownerUid: account?.ownerUid || uid,
          participantUids: FieldValue.arrayUnion(uid),
          accessUsername: account?.accessUsername || username,
          usernameKey,
          status: 'open',
          automationComplete: true,
          introAudioKey,
          funnelStatus: account?.funnelStatus || 'new',
          lastAccessAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )

      return NextResponse.json({
        chatId,
        accountId: usernameKey,
        recovered: true,
        accessUsername: account?.accessUsername || username,
        profile: getAccessProfile(account, chat),
        introAudioKey,
      })
    }

    const legacyChats = await adminDb
      .collection('chats')
      .where('usernameKey', '==', usernameKey)
      .limit(10)
      .get()

    for (const item of legacyChats.docs) {
      const chat = item.data()

      if (isAccountAccessBlocked(chat)) {
        return NextResponse.json(
          { error: 'Pagina nao encontrada.', code: 'account_blocked' },
          { status: 404 },
        )
      }

      const introAudioKey = getSavedIntroAudioKey(chat, chat)

      await accountRef.set(
        {
          chatId: item.id,
          ownerUid: chat.ownerUid || uid,
          accessUsername: chat.accessUsername || username,
          usernameKey,
          ...(chat.passwordSalt ? { passwordSalt: chat.passwordSalt } : {}),
          ...(chat.passwordHash ? { passwordHash: chat.passwordHash } : {}),
          clientId: body.clientId || chat.clientId || '',
          source: chat.source || 'site',
          introAudioKey,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          lastAccessAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )

      await item.ref.set(
        {
          accountId: usernameKey,
          participantUids: FieldValue.arrayUnion(uid),
          introAudioKey,
          lastAccessAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )

      return NextResponse.json({
        chatId: item.id,
        accountId: usernameKey,
        recovered: true,
        accessUsername: chat.accessUsername || username,
        profile: getAccessProfile(chat, chat),
        introAudioKey,
      })
    }

    const chatId = body.requestedChatId || adminDb.collection('chats').doc().id
    const passwordSalt = password ? randomBytes(16).toString('hex') : ''
    const accountCredentials = passwordSalt
      ? {
          passwordSalt,
          passwordHash: hashPassword(password, passwordSalt),
        }
      : {}
    const introAudioKey = await getCurrentIntroAudioKey(adminDb)

    await accountRef.set(
      {
        chatId,
        ownerUid: uid,
        accessUsername: username,
        usernameKey,
        ...accountCredentials,
        clientId: body.clientId || '',
        source: 'site',
        introAudioKey,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastAccessAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

    await adminDb.collection('chats').doc(chatId).set(
      {
        accountId: usernameKey,
        clientId: body.clientId || '',
        ownerUid: uid,
        participantUids: [uid],
        accessUsername: username,
        usernameKey,
        status: 'open',
        automationComplete: true,
        introAudioKey,
        funnelStatus: 'new',
        source: 'whatsapp',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastAccessAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

    return NextResponse.json({
      chatId,
      accountId: usernameKey,
      recovered: false,
      accessUsername: username,
      profile: {},
      introAudioKey,
    })
  } catch (error) {
    console.error('Chat access error:', error)
    return NextResponse.json({ error: 'Nao foi possivel validar o acesso.' }, { status: 500 })
  }
}
