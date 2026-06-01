import type { Firestore } from 'firebase-admin/firestore'
import {
  defaultPlanCatalog,
  defaultResellerPlanCatalog,
  formatCurrencyFromCents,
  isPlanType,
  type PlanCatalogItem,
} from '@/lib/payment-catalog'
import type { PlanType, ResellerAccessType } from '@/types/chat'

type AdminDb = Firestore

function cleanString(value: unknown, fallback: string, maxLength = 80) {
  const clean = typeof value === 'string' ? value.trim() : ''
  return clean ? clean.slice(0, maxLength) : fallback
}

function cleanAmountCents(value: unknown, fallback: number) {
  const numeric = Number(value)
  if (!Number.isInteger(numeric)) return fallback
  if (numeric < 100 || numeric > 100000) return fallback
  return numeric
}

function cleanDurationDays(value: unknown, fallback: number | null) {
  if (value === null) return null
  const numeric = Number(value)
  if (!Number.isInteger(numeric)) return fallback
  if (numeric < 1 || numeric > 3660) return fallback
  return numeric
}

function cleanHttpsUrl(value: unknown, fallback: string) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return fallback

  try {
    const url = new URL(raw)
    return url.protocol === 'https:' ? url.toString() : fallback
  } catch {
    return fallback
  }
}

function mergePlan(plan: PlanType, raw: unknown): PlanCatalogItem {
  const fallback = defaultPlanCatalog[plan]
  const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const amountCents = cleanAmountCents(data.amountCents ?? data.priceCents, fallback.amountCents)

  return {
    ...fallback,
    label: cleanString(data.label, fallback.label),
    amountCents,
    price: amountCents / 100,
    priceLabel: cleanString(data.priceLabel, formatCurrencyFromCents(amountCents), 30),
    badge: cleanString(data.badge, fallback.badge, 40),
    detail: cleanString(data.detail, fallback.detail, 120),
    durationDays: cleanDurationDays(data.durationDays, fallback.durationDays),
    normalPriceLabel: cleanString(data.normalPriceLabel, fallback.normalPriceLabel, 30),
    perfectPayLink: cleanHttpsUrl(data.perfectPayLink, fallback.perfectPayLink),
  }
}

function mergeResellerPlan(context: ResellerAccessType, plan: PlanType, raw: unknown): PlanCatalogItem {
  const fallback = defaultResellerPlanCatalog[context][plan]
  const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const amountCents = cleanAmountCents(data.amountCents ?? data.priceCents, fallback.amountCents)

  return {
    ...fallback,
    label: cleanString(data.label, fallback.label),
    amountCents,
    price: amountCents / 100,
    priceLabel: cleanString(data.priceLabel, formatCurrencyFromCents(amountCents), 30),
    badge: cleanString(data.badge, fallback.badge, 40),
    detail: cleanString(data.detail, fallback.detail, 120),
    durationDays: cleanDurationDays(data.durationDays, fallback.durationDays),
    normalPriceLabel: cleanString(data.normalPriceLabel, fallback.normalPriceLabel, 30),
    perfectPayLink: cleanHttpsUrl(data.perfectPayLink, fallback.perfectPayLink),
  }
}

export async function loadServerPlanCatalog(adminDb: AdminDb): Promise<Record<PlanType, PlanCatalogItem>> {
  try {
    const snapshot = await adminDb.collection('settings').doc('payment-plans').get()
    const plans = snapshot.data()?.plans
    const rawPlans = plans && typeof plans === 'object' && !Array.isArray(plans) ? plans as Record<string, unknown> : {}

    return {
      daily: mergePlan('daily', rawPlans.daily),
      weekly: mergePlan('weekly', rawPlans.weekly),
      monthly: mergePlan('monthly', rawPlans.monthly),
      lifetime: mergePlan('lifetime', rawPlans.lifetime),
    }
  } catch {
    return defaultPlanCatalog
  }
}

export function getPlanOrThrow(catalog: Record<PlanType, PlanCatalogItem>, plan: unknown) {
  if (!isPlanType(plan)) throw new Error('Plano invalido.')
  return catalog[plan]
}

export async function loadServerResellerPlanCatalog(
  adminDb: AdminDb,
): Promise<Record<ResellerAccessType, Record<PlanType, PlanCatalogItem>>> {
  try {
    const snapshot = await adminDb.collection('settings').doc('reseller-payment-plans').get()
    const data = snapshot.data() || {}
    const internal = data.internal && typeof data.internal === 'object' ? data.internal as Record<string, unknown> : {}
    const external = data.external && typeof data.external === 'object' ? data.external as Record<string, unknown> : {}

    return {
      internal: {
        daily: mergeResellerPlan('internal', 'daily', internal.daily),
        weekly: mergeResellerPlan('internal', 'weekly', internal.weekly),
        monthly: mergeResellerPlan('internal', 'monthly', internal.monthly),
        lifetime: mergeResellerPlan('internal', 'lifetime', internal.lifetime),
      },
      external: {
        daily: mergeResellerPlan('external', 'daily', external.daily),
        weekly: mergeResellerPlan('external', 'weekly', external.weekly),
        monthly: mergeResellerPlan('external', 'monthly', external.monthly),
        lifetime: mergeResellerPlan('external', 'lifetime', external.lifetime),
      },
    }
  } catch {
    return defaultResellerPlanCatalog
  }
}
