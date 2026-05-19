import type { Timestamp } from 'firebase/firestore'

export type ChatStatus = 'automation' | 'open'
export type MessageSender = 'client' | 'admin' | 'bot'
export type DeviceType = 'android' | 'ios' | 'emulator'
export type PlanType = 'weekly' | 'monthly' | 'lifetime'
export type PaymentTarget = PlanType | 'plugin'
export type PaymentProvider = 'perfect-pay' | 'kiwify'
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
  | 'audio_started'
  | 'audio_half'
  | 'audio_completed'
  | 'device_selected'
  | 'device_changed'
  | 'plan_selected'
  | 'payment_opened'
  | 'button_clicked'
  | 'message_sent'

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

export type IntroAudioKey = 'start' | 'start-live'

export type AdminSettings = {
  liveIntroEnabled?: boolean
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
  lastSender?: MessageSender
  lastMessageAt?: Timestamp
  createdAt?: Timestamp
  updatedAt?: Timestamp
  source?: string
  introAudioKey?: IntroAudioKey
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
  payment?: {
    provider?: PaymentProvider | string
    status?: 'link_sent' | 'opened' | 'paid' | 'rejected' | 'cancelled' | 'refunded'
    link?: string
    plan?: PaymentTarget
    label?: string
    code?: string
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

export type AudioKey =
  | 'start'
  | 'start-live'
  | 'second-android'
  | 'second-ios'
  | 'second-emulator'
  | 'latest-android'
  | 'latest-ios'
  | 'latest-emulator'
  | 'penultimate'

export type ChatMessage = {
  id: string
  text: string
  sender: MessageSender
  kind?:
    | 'text'
    | 'plan_options'
    | 'payment_link'
    | 'device_intro'
    | 'device_selector'
    | 'feature_showcase'
    | 'demo_video'
    | 'recording_indicator'
    | 'plugin_payment_link'
    | 'plugin_diagnostic'
  audioKey?: AudioKey
  videoUrl?: string
  paymentLink?: string
  paymentLabel?: string
  paymentPlan?: PaymentTarget
  editedAt?: Timestamp
  editedBy?: string
  buttonClicks?: Record<
    string,
    {
      label?: string
      count?: number
      lastAt?: Timestamp
    }
  >
  createdAt?: Timestamp
}

export type InitialQuestion = {
  id: string
  text: string
  type: 'accountStatus' | 'credentials' | 'yesno'
  answer?: string
  username?: string
  password?: string
  asked?: boolean
}
