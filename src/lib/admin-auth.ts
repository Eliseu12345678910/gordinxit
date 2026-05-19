import { getAdminDb } from '@/lib/firebase-admin'

export async function isAdminUser(uid: string, email?: string) {
  const allowedAdminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase()

  if (allowedAdminEmail && email?.toLowerCase() === allowedAdminEmail) {
    return true
  }

  const adminDb = getAdminDb()
  const adminDoc = await adminDb.collection('admins').doc(uid).get()
  return adminDoc.exists && adminDoc.data()?.isAdmin === true
}
