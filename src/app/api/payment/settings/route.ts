import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebase-admin'
import { publicPlanCatalog } from '@/lib/payment-catalog'
import { loadServerPlanCatalog } from '@/lib/payment-catalog-server'
import type { PaymentProvider, PlanType } from '@/types/chat'

export const runtime = 'nodejs'
const kiwifyPluginLink = 'https://pay.kiwify.com.br/uOARny8'

function normalizeProvider(value: unknown): PaymentProvider {
  return value === 'kiwify' || value === 'perfect-pay' ? value : 'perfect-pay'
}

function envLink(name: string) {
  return (process.env[name] || '').trim()
}

function getLinks(provider: PaymentProvider, perfectPayLinks: Record<PlanType, string>): Record<PlanType, string> {
  if (provider === 'kiwify') {
    return {
      daily: envLink('KIWIFY_DAILY_LINK') || envLink('NEXT_PUBLIC_KIWIFY_DAILY_LINK'),
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
  const [settingsSnapshot, catalog] = await Promise.all([
    adminDb.collection('settings').doc('chat-private').get(),
    loadServerPlanCatalog(adminDb),
  ])
  const paymentProvider = normalizeProvider(settingsSnapshot.data()?.paymentProvider)
  const links = getLinks(paymentProvider, {
    daily: catalog.daily.perfectPayLink,
    weekly: catalog.weekly.perfectPayLink,
    monthly: catalog.monthly.perfectPayLink,
    lifetime: catalog.lifetime.perfectPayLink,
  })

  return NextResponse.json({
    paymentProvider,
    links,
    plans: publicPlanCatalog(catalog, links),
    pluginLink: getPluginLink(paymentProvider),
  })
}
