import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebase-admin'
import { syncMercadoPagoPayment } from '@/lib/mercadopago-payment-sync'

export const runtime = 'nodejs'

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function getPaymentId(request: NextRequest, payload: JsonRecord) {
  return (
    request.nextUrl.searchParams.get('data.id') ||
    request.nextUrl.searchParams.get('id') ||
    getString(asRecord(payload.data).id) ||
    getString(payload.id)
  ).trim()
}

function parseSignature(value: string) {
  return value.split(',').reduce<Record<string, string>>((acc, part) => {
    const [key, rawValue] = part.split('=')
    if (key && rawValue) acc[key.trim()] = rawValue.trim()
    return acc
  }, {})
}

function safeEqual(first: string, second: string) {
  const firstBuffer = Buffer.from(first)
  const secondBuffer = Buffer.from(second)
  return firstBuffer.length === secondBuffer.length && timingSafeEqual(firstBuffer, secondBuffer)
}

function verifyWebhookSignature(request: NextRequest, paymentId: string) {
  const secret = (process.env.MERCADO_PAGO_WEBHOOK_SECRET || '').trim()
  if (!secret) return process.env.NODE_ENV !== 'production'

  const xSignature = request.headers.get('x-signature') || ''
  const xRequestId = request.headers.get('x-request-id') || ''
  const parts = parseSignature(xSignature)
  const ts = parts.ts
  const signature = parts.v1
  if (!paymentId || !xRequestId || !ts || !signature) return false

  const manifest = `id:${paymentId};request-id:${xRequestId};ts:${ts};`
  const expected = createHmac('sha256', secret).update(manifest).digest('hex')
  return safeEqual(expected, signature)
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json().catch(() => ({})) as JsonRecord
    const paymentId = getPaymentId(request, payload)

    if (!paymentId) {
      return NextResponse.json({ ok: true, matched: false, reason: 'missing_payment_id' })
    }

    if (!verifyWebhookSignature(request, paymentId)) {
      return NextResponse.json({ ok: false, error: 'Assinatura invalida.' }, { status: 401 })
    }

    const result = await syncMercadoPagoPayment(getAdminDb(), paymentId)
    return NextResponse.json({
      ok: true,
      matched: result.matched,
      status: result.status,
      reason: result.reason,
    })
  } catch (error) {
    console.error('Mercado Pago webhook error:', error)
    return NextResponse.json({ ok: false, error: 'Nao foi possivel processar o webhook Mercado Pago.' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    ok: true,
    endpoint: '/api/webhooks/mercadopago',
    postbackUrl: `${request.nextUrl.origin}/api/webhooks/mercadopago`,
  })
}
