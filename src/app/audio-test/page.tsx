'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AccessNotFound } from '@/components/AccessNotFound'
import { audioFiles } from '@/lib/audio'
import { checkClientSessionAccess, getStoredAccountBlocked } from '@/lib/chat'
import type { AudioKey, DeviceType } from '@/types/chat'

const audioLabels: Record<AudioKey, string> = {
  start: 'Audio start',
  'start-live': 'Audio start-live',
  'second-android': 'Audio second-android',
  'second-ios': 'Audio second-ios',
  'second-emulator': 'Audio second-emulator',
  'latest-android': 'Audio latest-android',
  'latest-ios': 'Audio latest-ios',
  'latest-emulator': 'Audio latest-emulator',
  penultimate: 'Audio penultimate',
}

type ChatMessage =
  | { id: string; type: 'audio'; audioKey: AudioKey; label: string }
  | { id: string; type: 'text'; text: string }

const featureLines = [
  'Aimbot Advanced',
  'Aimbot Neck',
  'Aimbot Legit',
  'Puxar Mira',
  'Ignorar Knocked',
  'Ignorar Bots',
  'Distance Max',
  'Max Distance',
  'Visible Check',
  'Filled Color',
  'Ver todas',
  'player...',
]

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export default function AudioTestPage() {
  const audioKeys = useMemo(() => Object.keys(audioFiles) as AudioKey[], [])
  const [checkingAccess, setCheckingAccess] = useState(true)
  const [blockedAccess, setBlockedAccess] = useState(() => getStoredAccountBlocked())
  const [device, setDevice] = useState<DeviceType>('android')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState('')
  const [currentAudioId, setCurrentAudioId] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const sequenceRef = useRef<ChatMessage[]>([])
  const sequenceTimerRef = useRef<number | null>(null)

  useEffect(() => {
    let active = true

    checkClientSessionAccess()
      .then((sessionAccess) => {
        if (active) setBlockedAccess(sessionAccess.blocked)
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setCheckingAccess(false)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      clearSequenceTimer()
    }
  }, [])

  function clearSequenceTimer() {
    if (sequenceTimerRef.current !== null) {
      window.clearTimeout(sequenceTimerRef.current)
      sequenceTimerRef.current = null
    }
  }

  function clearCurrentAudio() {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.onended = null
      audioRef.current.ontimeupdate = null
      audioRef.current.onplay = null
      audioRef.current.onpause = null
      audioRef.current.src = ''
      audioRef.current = null
    }
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setCurrentAudioId(null)
  }

  function setupAudio(key: AudioKey, messageId: string) {
    if (audioRef.current && currentAudioId !== messageId) {
      audioRef.current.pause()
    }

    const audio = new Audio(audioFiles[key])
    audio.playbackRate = playbackRate
    audio.onended = () => handleAudioEnded(messageId)
    audio.ontimeupdate = () => setCurrentTime(audio.currentTime)
    audio.onloadedmetadata = () => setDuration(audio.duration)
    audio.onplay = () => setIsPlaying(true)
    audio.onpause = () => setIsPlaying(false)
    audioRef.current = audio
    setCurrentAudioId(messageId)
  }

  function handleAudioEnded(messageId: string) {
    if (currentAudioId !== messageId) return

    setIsPlaying(false)
    setCurrentTime(0)

    const sequence = sequenceRef.current
    const currentIndex = sequence.findIndex((message) => message.id === messageId)
    if (currentIndex === -1) {
      return
    }

    const nextIndex = currentIndex + 1
    if (nextIndex >= sequence.length) {
      setIsRunning(false)
      return
    }

    const nextMessage = sequence[nextIndex]
    if (nextMessage.type === 'audio') {
      sequenceTimerRef.current = window.setTimeout(() => playSequenceStep(nextIndex), 2000)
    } else {
      playSequenceStep(nextIndex)
    }
  }

  function playSequenceStep(index: number) {
    const nextMessage = sequenceRef.current[index]
    if (!nextMessage) return

    setMessages((current) => [...current, nextMessage])

    if (nextMessage.type === 'audio') {
      setupAudio(nextMessage.audioKey, nextMessage.id)
      audioRef.current?.play().catch((playError) => {
        console.error('Erro ao tocar áudio:', playError)
        setError('Falha ao reproduzir o áudio. Verifique o navegador e tente novamente.')
      })
    } else {
      const nextIndex = index + 1
      if (nextIndex < sequenceRef.current.length) {
        sequenceTimerRef.current = window.setTimeout(() => playSequenceStep(nextIndex), 2000)
      }
    }
  }

  function startSequence() {
    if (isRunning) return

    clearSequenceTimer()
    clearCurrentAudio()
    setMessages([])
    setError('')
    setIsRunning(true)

    const sequence: ChatMessage[] = [
      { id: 'audio-start', type: 'audio', audioKey: 'start', label: audioLabels.start },
      {
        id: 'audio-second',
        type: 'audio',
        audioKey: `second-${device}` as AudioKey,
        label: audioLabels[`second-${device}` as AudioKey],
      },
      {
        id: 'message-resources',
        type: 'text',
        text:
          'Principais ferramentas Xit para seu dispositivo — prontas pra usar. Rápido, direto e com pegada hacker.\n\n' +
          featureLines.join('\n'),
      },
      { id: 'audio-penultimate', type: 'audio', audioKey: 'penultimate', label: audioLabels.penultimate },
      {
        id: 'audio-latest',
        type: 'audio',
        audioKey: `latest-${device}` as AudioKey,
        label: audioLabels[`latest-${device}` as AudioKey],
      },
    ]

    sequenceRef.current = sequence
    playSequenceStep(0)
  }

  function playAudioMessage(message: ChatMessage) {
    if (message.type !== 'audio') return

    clearSequenceTimer()
    if (currentAudioId === message.id && audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause()
      } else {
        audioRef.current.play().catch((playError) => {
          console.error('Erro ao retomar áudio:', playError)
          setError('Falha ao retomar o áudio.')
        })
      }
      return
    }

    setupAudio(message.audioKey, message.id)
    audioRef.current?.play().catch((playError) => {
      console.error('Erro ao tocar áudio:', playError)
      setError('Falha ao reproduzir o áudio. Verifique o navegador e tente novamente.')
    })
  }

  function togglePlayPause() {
    if (!audioRef.current) return
    if (isPlaying) {
      audioRef.current.pause()
    } else {
      audioRef.current.play().catch((playError) => {
        console.error('Erro ao continuar áudio:', playError)
        setError('Falha ao continuar o áudio.')
      })
    }
  }

  function skipForward() {
    if (!audioRef.current) return
    audioRef.current.currentTime = Math.min(audioRef.current.duration, audioRef.current.currentTime + 10)
  }

  function changePlaybackRate() {
    const nextRate = playbackRate >= 1.5 ? 1 : playbackRate + 0.25
    setPlaybackRate(nextRate)
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate
    }
  }

  function formatTime(seconds: number) {
    const minutes = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${minutes}:${secs.toString().padStart(2, '0')}`
  }

  if (blockedAccess) return <AccessNotFound />
  if (checkingAccess) return <main className="client-page" aria-hidden="true" />

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-5xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-semibold text-slate-900">Simulação de Chat com Áudio</h1>
        <p className="mt-3 text-slate-600">
          Use o player para reproduzir apenas um áudio por vez e controlar pausa, avanço e velocidade.
        </p>

        <div className="mt-8 space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
            <h2 className="text-xl font-semibold text-slate-900">1. Selecione o dispositivo</h2>
            <div className="mt-4 flex flex-wrap gap-3">
              {(['android', 'ios', 'emulator'] as DeviceType[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`rounded-full border px-5 py-3 text-sm font-medium transition ${
                    device === option
                      ? 'border-sky-500 bg-sky-50 text-slate-900'
                      : 'border-slate-300 bg-white text-slate-700'
                  }`}
                  onClick={() => setDevice(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
            <h2 className="text-xl font-semibold text-slate-900">2. Controle de áudio</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="font-semibold text-slate-900">Áudio atual</p>
                <p className="mt-2 text-slate-600">{currentAudioId ?? 'Nenhum áudio em reprodução'}</p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="rounded-2xl bg-slate-900 px-5 py-3 text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                    onClick={togglePlayPause}
                    disabled={!audioRef.current}
                  >
                    {isPlaying ? 'Pausar' : 'Reproduzir'}
                  </button>
                  <button
                    type="button"
                    className="rounded-2xl border border-slate-300 bg-white px-5 py-3 text-slate-900 hover:bg-slate-100"
                    onClick={skipForward}
                    disabled={!audioRef.current}
                  >
                    +10s
                  </button>
                  <button
                    type="button"
                    className="rounded-2xl border border-slate-300 bg-white px-5 py-3 text-slate-900 hover:bg-slate-100"
                    onClick={changePlaybackRate}
                    disabled={!audioRef.current}
                  >
                    Velocidade {playbackRate.toFixed(2)}x
                  </button>
                </div>
                <div className="mt-4 w-full rounded-full bg-slate-200 p-1">
                  <div
                    className="h-2 rounded-full bg-slate-900"
                    style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%' }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-sm text-slate-500">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
                {error ? <p className="mt-4 text-sm text-rose-600">{error}</p> : null}
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="font-semibold text-slate-900">Sequência de chat</p>
                <p className="mt-2 text-slate-600">
                  Clique em <strong>Iniciar sequência</strong> para reproduzir os áudios na ordem correta.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="rounded-2xl bg-slate-900 px-5 py-3 text-white shadow-sm hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                    onClick={startSequence}
                    disabled={isRunning}
                  >
                    {isRunning ? 'Executando...' : 'Iniciar sequência'}
                  </button>
                  <button
                    type="button"
                    className="rounded-2xl border border-slate-300 bg-white px-5 py-3 text-slate-900 hover:bg-slate-100"
                    onClick={() => {
                      clearSequenceTimer()
                      clearCurrentAudio()
                      setMessages([])
                      setIsRunning(false)
                    }}
                  >
                    Limpar chat
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
            <h2 className="text-xl font-semibold text-slate-900">3. Chat simulado</h2>
            <div className="mt-4 space-y-4">
              {messages.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-6 text-slate-500">
                  Nenhuma mensagem ainda. Clique em <strong>Iniciar sequência</strong>.
                </div>
              ) : (
                messages.map((message) =>
                  message.type === 'audio' ? (
                    <article
                      key={message.id}
                      className="rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-900">{message.label}</p>
                          <small className="text-slate-500">{message.audioKey}</small>
                        </div>
                        <button
                          type="button"
                          className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
                          onClick={() => playAudioMessage(message)}
                        >
                          {currentAudioId === message.id && isPlaying ? 'Pausar' : 'Reproduzir'}
                        </button>
                      </div>
                    </article>
                  ) : (
                    <article key={message.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                      <p className="whitespace-pre-line text-slate-700">{message.text}</p>
                    </article>
                  ),
                )
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
            <h2 className="text-xl font-semibold text-slate-900">4. Áudios independentes</h2>
            <p className="mt-2 text-slate-600">
              Clique em qualquer áudio para pausar o que estiver rodando e iniciar o novo.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {audioKeys.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`rounded-2xl border px-4 py-4 text-left transition-all hover:border-slate-400 ${
                    currentAudioId === `manual-${key}` ? 'border-sky-500 bg-sky-50' : 'bg-white'
                  }`}
                  onClick={() => {
                    const manualMessage: ChatMessage = {
                      id: `manual-${key}`,
                      type: 'audio',
                      audioKey: key,
                      label: audioLabels[key],
                    }
                    playAudioMessage(manualMessage)
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-900">{audioLabels[key]}</p>
                      <small className="text-slate-500">{key}</small>
                    </div>
                    <span className="rounded-full bg-slate-900 px-3 py-2 text-sm font-medium text-white">Play</span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
