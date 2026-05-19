export function isAccountAccessBlocked(source: unknown) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return false

  const record = source as Record<string, unknown>
  if (record.accessBlocked === true || record.accountBlocked === true) return true

  const block = record.accountBlock
  if (!block || typeof block !== 'object' || Array.isArray(block)) return false

  return (block as Record<string, unknown>).active === true
}
