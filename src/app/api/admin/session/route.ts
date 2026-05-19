import { NextRequest, NextResponse } from 'next/server'
import { isAdminUser } from '@/lib/admin-auth'
import { getAdminAuth } from '@/lib/firebase-admin'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { idToken?: string }

    if (!body.idToken) {
      return NextResponse.json({ error: 'Sessao invalida.' }, { status: 401 })
    }

    const decodedToken = await getAdminAuth().verifyIdToken(body.idToken)

    if (!(await isAdminUser(decodedToken.uid, decodedToken.email))) {
      return NextResponse.json({ error: 'Pagina nao encontrada.' }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Admin session error:', error)
    return NextResponse.json({ error: 'Sessao invalida.' }, { status: 401 })
  }
}
