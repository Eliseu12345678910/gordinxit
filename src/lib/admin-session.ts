import {
  browserSessionPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth'
import { auth } from '@/lib/firebase'

export class AdminAccessError extends Error {
  constructor(message = 'Acesso invalido.') {
    super(message)
    this.name = 'AdminAccessError'
  }
}

export async function verifyAdminSession(user: User | null = auth.currentUser) {
  if (!user || user.isAnonymous) return false

  const idToken = await user.getIdToken()
  const response = await fetch('/api/admin/session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ idToken }),
  })

  return response.ok
}

export async function signInAdmin(email: string, password: string) {
  try {
    await setPersistence(auth, browserSessionPersistence)
    const result = await signInWithEmailAndPassword(auth, email, password)
    const allowed = await verifyAdminSession(result.user)

    if (!allowed) {
      await signOut(auth).catch(() => undefined)
      throw new AdminAccessError()
    }

    return result.user
  } catch (error) {
    if (error instanceof AdminAccessError) throw error
    await signOut(auth).catch(() => undefined)
    throw new AdminAccessError()
  }
}
