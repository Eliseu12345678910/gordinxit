import type { PlanType, ResellerAccessType } from '@/types/chat'

export type PlanCatalogItem = {
  value: PlanType
  label: string
  price: number
  amountCents: number
  priceLabel: string
  badge: string
  detail: string
  durationDays: number | null
  normalPriceLabel: string
  perfectPayLink: string
}

export type PublicPlanCatalogItem = Omit<PlanCatalogItem, 'amountCents' | 'perfectPayLink'> & {
  paymentLink?: string
}

export const defaultPlanCatalog: Record<PlanType, PlanCatalogItem> = {
  daily: {
    value: 'daily',
    label: 'Diario',
    price: 16.9,
    amountCents: 1690,
    priceLabel: 'R$ 16,90',
    badge: '',
    detail: '1 dia de acesso ao painel.',
    durationDays: 1,
    normalPriceLabel: 'R$ 29,90',
    perfectPayLink: 'https://go.perfectpay.com.br/PPU38CPQUB3',
  },
  weekly: {
    value: 'weekly',
    label: 'Semanal',
    price: 17.9,
    amountCents: 1790,
    priceLabel: 'R$ 17,90',
    badge: '',
    detail: '7 dias de acesso ao painel.',
    durationDays: 7,
    normalPriceLabel: 'R$ 29,90',
    perfectPayLink: 'https://go.perfectpay.com.br/PPU38CPSFTN',
  },
  monthly: {
    value: 'monthly',
    label: 'Mensal',
    price: 44.9,
    amountCents: 4490,
    priceLabel: 'R$ 44,90',
    badge: 'Mais comprado',
    detail: '30 dias de acesso ao painel.',
    durationDays: 30,
    normalPriceLabel: 'R$ 79,90',
    perfectPayLink: 'https://go.perfectpay.com.br/PPU38CP7M55',
  },
  lifetime: {
    value: 'lifetime',
    label: 'Vitalicio',
    price: 124.9,
    amountCents: 12490,
    priceLabel: 'R$ 124,90',
    badge: '',
    detail: 'Acesso permanente ao painel.',
    durationDays: null,
    normalPriceLabel: 'R$ 219,90',
    perfectPayLink: 'https://go.perfectpay.com.br/PPU38CP7M56',
  },
}

export const planOrder: PlanType[] = ['daily', 'weekly', 'monthly', 'lifetime']

export const defaultResellerPlanCatalog: Record<ResellerAccessType, Record<PlanType, PlanCatalogItem>> = {
  internal: {
    daily: {
      ...defaultPlanCatalog.daily,
      price: 12.9,
      amountCents: 1290,
      priceLabel: 'R$ 12,90',
      normalPriceLabel: 'R$ 19,90',
    },
    weekly: {
      ...defaultPlanCatalog.weekly,
      price: 34.9,
      amountCents: 3490,
      priceLabel: 'R$ 34,90',
      normalPriceLabel: 'R$ 49,90',
    },
    monthly: {
      ...defaultPlanCatalog.monthly,
      price: 59.9,
      amountCents: 5990,
      priceLabel: 'R$ 59,90',
      normalPriceLabel: 'R$ 79,90',
    },
    lifetime: {
      ...defaultPlanCatalog.lifetime,
      price: 129.9,
      amountCents: 12990,
      priceLabel: 'R$ 129,90',
      normalPriceLabel: 'R$ 179,90',
    },
  },
  external: {
    daily: {
      ...defaultPlanCatalog.daily,
      price: 6.9,
      amountCents: 690,
      priceLabel: 'R$ 6,90',
      normalPriceLabel: 'R$ 9,90',
    },
    weekly: {
      ...defaultPlanCatalog.weekly,
      price: 16.9,
      amountCents: 1690,
      priceLabel: 'R$ 16,90',
      normalPriceLabel: 'R$ 25,90',
    },
    monthly: {
      ...defaultPlanCatalog.monthly,
      price: 24.9,
      amountCents: 2490,
      priceLabel: 'R$ 24,90',
      normalPriceLabel: 'R$ 39,90',
    },
    lifetime: {
      ...defaultPlanCatalog.lifetime,
      price: 54.9,
      amountCents: 5490,
      priceLabel: 'R$ 54,90',
      normalPriceLabel: 'R$ 79,90',
    },
  },
}

export function isPlanType(value: unknown): value is PlanType {
  return value === 'daily' || value === 'weekly' || value === 'monthly' || value === 'lifetime'
}

export function formatCurrencyFromCents(amountCents: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(amountCents / 100)
}

export function planCatalogToOptions(catalog: Record<PlanType, PlanCatalogItem>) {
  return planOrder.map((plan) => {
    const item = catalog[plan]
    return {
      value: item.value,
      label: item.label,
      price: item.price,
      priceLabel: item.priceLabel,
      badge: item.badge,
      detail: item.detail,
    }
  })
}

export function publicPlanCatalog(
  catalog: Record<PlanType, PlanCatalogItem>,
  links: Record<PlanType, string>,
  includeFallbackLinks = true,
): PublicPlanCatalogItem[] {
  return planOrder.map((plan) => {
    const { amountCents, perfectPayLink, ...item } = catalog[plan]
    return {
      ...item,
      paymentLink: links[plan] || (includeFallbackLinks ? perfectPayLink : ''),
    }
  })
}
