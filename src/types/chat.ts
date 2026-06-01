import type { Timestamp } from 'firebase/firestore'

export type ChatStatus = 'automation' | 'open'
export type DeviceType = 'android' | 'ios' | 'emulator'
export type PlanType = 'daily' | 'weekly' | 'monthly' | 'lifetime'
export type PaymentTarget = PlanType | 'plugin'
export type PaymentProvider = 'perfect-pay' | 'kiwify' | 'mercado-pago'
export type ResellerAccessType = 'internal' | 'external'
export type ResellerPurchase = {
  id?: string
  status?: 'pending' | 'paid' | 'rejected' | 'cancelled' | 'refunded'
  plan?: PlanType
  accessType?: ResellerAccessType
  priceLabel?: string
  paymentCode?: string
  platformCode?: string
  activatedAt?: Timestamp
  expiresAt?: Timestamp | null
}
export type FunnelStatus =
  | 'new'
  | 'device_selected'
  | 'plans_sent'
  | 'plan_selected'
  | 'payment_link_sent'
  | 'waiting_receipt'
  | 'paid'
  | 'activated'
  | 'deactivated'

export type AutomationAnswer = {
  question: string
  answer: string
}

export type ClientActivityType =
  | 'device_selected'
  | 'device_changed'
  | 'plan_selected'
  | 'payment_opened'
  | 'button_clicked'

export type ClientActivitySummary = {
  type: ClientActivityType
  label: string
  count: number
  lastAt?: Timestamp
}

export type ClientActivity = {
  id: string
  type: ClientActivityType
  key?: string
  label: string
  meta?: Record<string, string | number | boolean | null>
  createdAt?: Timestamp
}

export type AdminSettings = {
  paymentProvider?: PaymentProvider
  updatedAt?: Timestamp
}

export type Chat = {
  id: string
  accountId?: string
  clientId?: string
  accessUsername?: string
  usernameKey?: string
  passwordSalt?: string
  passwordHash?: string
  status: ChatStatus
  automationComplete: boolean
  answers?: AutomationAnswer[]
  lastMessage?: string
  lastSender?: 'client' | 'admin' | 'bot'
  lastMessageAt?: Timestamp
  createdAt?: Timestamp
  updatedAt?: Timestamp
  source?: string
  funnelStatus?: FunnelStatus
  leadProfile?: {
    device?: DeviceType
    deviceLabel?: string
    deviceSelectedAt?: Timestamp
  }
  selectedPlan?: {
    plan: PlanType
    label: string
    price: number
    priceLabel: string
  }
  subscription?: {
    plan?: PlanType
    status?: 'inactive' | 'active'
    activatedAt?: Timestamp
    expiresAt?: Timestamp | null
  }
  resellerAccess?: Partial<Record<ResellerAccessType, {
    status?: 'inactive' | 'active'
    plan?: PlanType
    activatedAt?: Timestamp
    expiresAt?: Timestamp | null
    paymentCode?: string
  }>>
  resellerPurchases?: ResellerPurchase[]
  payment?: {
    provider?: PaymentProvider | string
    status?: 'pending' | 'link_sent' | 'opened' | 'paid' | 'rejected' | 'cancelled' | 'refunded'
    link?: string
    plan?: PaymentTarget
    label?: string
    code?: string
    platformCode?: string
    localCode?: string
    eventId?: string
    saleAmount?: number | null
    customer?: {
      name?: string
      email?: string
      phone?: string
    }
    paidAt?: Timestamp
    openedAt?: Timestamp
  }
  plugin?: {
    name?: string
    status?: 'inactive' | 'active'
    included?: boolean
    activatedAt?: Timestamp
  }
  accessBlocked?: boolean
  accountBlock?: {
    active?: boolean
    blockedAt?: Timestamp
    blockedBy?: string
    unblockedAt?: Timestamp
    unblockedBy?: string
    updatedAt?: Timestamp
  }
  activitySummary?: Record<string, ClientActivitySummary>
  lastClientActivity?: ClientActivitySummary
}
