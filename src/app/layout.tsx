import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Gordin du Xit',
  description: 'Area de planos, plugin e download do Gordin du Xit',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  )
}
