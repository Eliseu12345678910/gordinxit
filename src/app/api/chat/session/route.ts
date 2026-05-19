import { NextRequest, NextResponse } from 'next/server'
import { isAccountAccessBlocked } from '@/lib/account-block'
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { idToken?: string }

    if (!body.idToken) {
      return NextResponse.json({ error: 'Sessao invalida.' }, { status: 401 })
    }

    const adminAuth = getAdminAuth()
    const adminDb = getAdminDb()
    const decodedToken = await adminAuth.verifyIdToken(body.idToken)
    const uid = decodedToken.uid

    const [ownedAccounts, participantChats] = await Promise.all([
      adminDb.collection('accounts').where('ownerUid', '==', uid).limit(5).get(),
      adminDb.collection('chats').where('participantUids', 'array-contains', uid).limit(5).get(),
    ])

    const blockedAccount = ownedAccounts.docs.some((doc) => isAccountAccessBlocked(doc.data()))
    const blockedChat = participantChats.docs.some((doc) => isAccountAccessBlocked(doc.data()))

    if (blockedAccount || blockedChat) {
      return NextResponse.json(
        { error: 'Pagina nao encontrada.', code: 'account_blocked', blocked: true },
        { status: 404 },
      )
    }

    return NextResponse.json({ ok: true, blocked: false })
  } catch (error) {
    console.error('Chat session check error:', error)
    return NextResponse.json({ error: 'Nao foi possivel validar a sessao.' }, { status: 500 })
  }
}
