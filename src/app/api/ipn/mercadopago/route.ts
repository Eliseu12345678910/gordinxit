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
    request.nextUrl.searchParams.get('payment_id') ||
    getString(asRecord(payload.data).id) ||
    getString(payload.id) ||
    getString(payload.payment_id)
  ).trim()
}

async function readPayload(request: NextRequest) {
  const contentType = request.headers.get('content-type') || ''
  const rawBody = await request.text().catch(() => '')
  if (!rawBody) return {}

  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(rawBody).entries())
  }

  try {
    return JSON.parse(rawBody) as JsonRecord
  } catch {
    return {}
  }
}

async function handleIpn(request: NextRequest) {
  try {
    const payload = await readPayload(request)
    const paymentId = getPaymentId(request, payload)

    if (!paymentId) {
      return NextResponse.json({ ok: true, matched: false, reason: 'missing_payment_id' })
    }

    const adminDb = getAdminDb()
    const localPayment = await adminDb.collection('mercadoPagoPayments').doc(paymentId).get()
    if (!localPayment.exists) {
      return NextResponse.json({ ok: true, matched: false, reason: 'local_payment_not_found' })
    }

    const result = await syncMercadoPagoPayment(adminDb, paymentId)
    return NextResponse.json({
      ok: true,
      matched: result.matched,
      status: result.status,
      reason: result.reason,
    })
  } catch (error) {
    console.error('Mercado Pago IPN error:', error)
    return NextResponse.json({ ok: true, matched: false, reason: 'ipn_accepted_with_processing_error' })
  }
}

export async function POST(request: NextRequest) {
  return handleIpn(request)
}

export async function GET(request: NextRequest) {
  return handleIpn(request)
}
