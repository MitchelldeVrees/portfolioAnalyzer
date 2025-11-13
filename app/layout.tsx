import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { Analytics } from '@vercel/analytics/next'

import { SessionWatcher } from '@/components/auth/session-watcher'

import './globals.css'

export const metadata: Metadata = {
  title: 'Portify',
  description: 'Create and analyze your investment portfolio with AI assistance.',
  generator: 'v',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`font-sans ${GeistSans.variable} ${GeistMono.variable}`}>
        {children}
        <SessionWatcher />
        <Analytics />
      </body>
    </html>
  )
}
