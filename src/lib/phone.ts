export function getPhoneDigits(value?: string) {
  return String(value || '').replace(/\D/g, '').slice(0, 15)
}

export function normalizeBrazilPhone(value?: string) {
  const digits = getPhoneDigits(value)
  const localDigits =
    digits.startsWith('55') && (digits.length === 12 || digits.length === 13)
      ? digits.slice(2)
      : digits

  return localDigits.slice(0, 11)
}

export function isPhoneInput(value?: string) {
  return /^[+\d\s().-]+$/.test(String(value || '').trim())
}

export function formatBrazilPhone(value?: string, { countryCode = false } = {}) {
  const digits = normalizeBrazilPhone(value)
  if (digits.length <= 2) return digits

  const ddd = digits.slice(0, 2)
  const number = digits.slice(2)
  const prefix = countryCode && (digits.length === 10 || digits.length === 11) ? '+55 ' : ''

  if (digits.length <= 6) return `${prefix}(${ddd}) ${number}`
  if (digits.length <= 10) return `${prefix}(${ddd}) ${number.slice(0, 4)}-${number.slice(4)}`
  return `${prefix}(${ddd}) ${number.slice(0, 5)}-${number.slice(5, 9)}`
}

export function formatPhoneOrUsername(value?: string, fallback = 'Sem telefone') {
  const clean = String(value || '').trim()
  const digits = getPhoneDigits(clean)

  if (!digits) return clean || fallback

  const normalized = normalizeBrazilPhone(clean)
  if (normalized.length === 10 || normalized.length === 11) {
    return formatBrazilPhone(normalized, { countryCode: true })
  }

  return clean || fallback
}
