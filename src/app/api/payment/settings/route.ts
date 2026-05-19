import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebase-admin'
import type { PaymentProvider, PlanType } from '@/types/chat'

export const runtime = 'nodejs'

const perfectPayLinks: Record<PlanType, string> = {
  weekly: 'https://go.perfectpay.com.br/PPU38CPSFTN',
  monthly: 'https://go.perfectpay.com.br/PPU38CP7M55',
  lifetime: 'https://go.perfectpay.com.br/PPU38CP7M56',
}
const kiwifyPluginLink = 'https://pay.kiwify.com.br/uOARny8'

function normalizeProvider(value: unknown): PaymentProvider {
  return value === 'kiwify' || value === 'perfect-pay' ? value : 'perfect-pay'
}

function envLink(name: string) {
  return (process.env[name] || '').trim()
}

function getLinks(provider: PaymentProvider): Record<PlanType, string> {
  if (provider === 'kiwify') {
    return {
      weekly: envLink('KIWIFY_WEEKLY_LINK') || envLink('NEXT_PUBLIC_KIWIFY_WEEKLY_LINK'),
      monthly: envLink('KIWIFY_MONTHLY_LINK') || envLink('NEXT_PUBLIC_KIWIFY_MONTHLY_LINK'),
      lifetime: envLink('KIWIFY_LIFETIME_LINK') || envLink('NEXT_PUBLIC_KIWIFY_LIFETIME_LINK'),
    }
  }

  return perfectPayLinks
}

function getPluginLink(provider: PaymentProvider) {
  if (provider === 'kiwify') {
    return envLink('KIWIFY_PLUGIN_LINK') || envLink('NEXT_PUBLIC_KIWIFY_PLUGIN_LINK') || kiwifyPluginLink
  }

  return (
    envLink('PERFECT_PAY_PLUGIN_LINK') ||
    envLink('NEXT_PUBLIC_PERFECT_PAY_PLUGIN_LINK') ||
    envLink('KIWIFY_PLUGIN_LINK') ||
    envLink('NEXT_PUBLIC_KIWIFY_PLUGIN_LINK') ||
    kiwifyPluginLink
  )
}

export async function GET() {
  const adminDb = getAdminDb()
  const settingsSnapshot = await adminDb.collection('settings').doc('chat-private').get()
  const paymentProvider = normalizeProvider(settingsSnapshot.data()?.paymentProvider)

  return NextResponse.json({
    paymentProvider,
    links: getLinks(paymentProvider),
    pluginLink: getPluginLink(paymentProvider),
  })
}
