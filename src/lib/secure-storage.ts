const STORAGE_PREFIX = 'chatseal:v1:'
const STORAGE_SALT_KEY = 'chat-atendimento-storage-salt-v1'

function getStorage() {
  if (typeof window === 'undefined') return null
  return window.localStorage
}

function makeSalt() {
  const bytes = new Uint8Array(16)
  window.crypto?.getRandomValues?.(bytes)
  const fallback = `${Date.now()}-${Math.random()}`
  return bytes.some(Boolean)
    ? Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    : fallback
}

function getSalt(storage: Storage) {
  const current = storage.getItem(STORAGE_SALT_KEY)
  if (current) return current

  const salt = makeSalt()
  storage.setItem(STORAGE_SALT_KEY, salt)
  return salt
}

function hashSeed(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0 || 0x9e3779b9
}

function nextByte(seedState: { value: number }) {
  let value = seedState.value
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  seedState.value = value >>> 0
  return seedState.value & 255
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return window.btoa(binary)
}

function base64ToBytes(value: string) {
  const binary = window.atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function scramble(key: string, value: Uint8Array, storage: Storage) {
  const host = window.location?.host || 'local'
  const state = { value: hashSeed(`${getSalt(storage)}:${host}:${key}`) }
  const output = new Uint8Array(value.length)
  for (let index = 0; index < value.length; index += 1) {
    output[index] = value[index] ^ nextByte(state)
  }
  return output
}

export function getSecureItem(key: string) {
  const storage = getStorage()
  if (!storage) return null

  const stored = storage.getItem(key)
  if (stored === null) return null
  if (!stored.startsWith(STORAGE_PREFIX)) {
    setSecureItem(key, stored)
    return stored
  }

  try {
    const encrypted = base64ToBytes(stored.slice(STORAGE_PREFIX.length))
    const decrypted = scramble(key, encrypted, storage)
    return new TextDecoder().decode(decrypted)
  } catch {
    return null
  }
}

export function setSecureItem(key: string, value: string) {
  const storage = getStorage()
  if (!storage) return

  const bytes = new TextEncoder().encode(value)
  const encrypted = scramble(key, bytes, storage)
  storage.setItem(key, `${STORAGE_PREFIX}${bytesToBase64(encrypted)}`)
}

export function removeSecureItem(key: string) {
  getStorage()?.removeItem(key)
}

export function listStorageKeys() {
  const storage = getStorage()
  if (!storage) return []
  return Object.keys(storage)
}
