import type { AudioKey } from '@/types/chat'

export const audioFiles: Record<AudioKey, string> = {
  start: '/audio/start.MP3',
  'start-live': '/audio/start-live.MP3',
  'second-android': '/audio/second-android.MP3',
  'second-ios': '/audio/second-ios.MP3',
  'second-emulator': '/audio/second-emulador.MP3',
  'latest-android': '/audio/latest-android.MP3',
  'latest-ios': '/audio/latest-ios.MP3',
  'latest-emulator': '/audio/latest-emulador.MP3',
  penultimate: '/audio/penultimate.MP3',
}

export function playAudio(key: AudioKey) {
  const audio = new Audio(audioFiles[key])
  audio.play().catch(() => {
    // autoplay may be blocked until the user interacts with the page.
  })
  return audio
}
