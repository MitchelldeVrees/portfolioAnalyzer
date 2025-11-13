import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { Analytics } from '@vercel/analytics/next'

import { SessionWatcher } from '@/components/auth/session-watcher'

import './globals.css'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.portify.app'
const siteName = 'Portify'
const defaultTitle = 'Portify | AI Portfolio Manager'
const defaultDescription =
  'Portify is the AI-powered portfolio manager that gives you real insight in your portfolio with instant analysis, sector diversification checks, and actionable research.'
const primaryKeywords = [
  'Portfolio manager',
  'Insight in your portfolio',
  'AI analysis on portfolio',
  'Investment analytics',
  'Wealth management software',
]

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: defaultTitle,
    template: `%s | ${siteName}`,
  },
  description: defaultDescription,
  keywords: primaryKeywords,
  category: 'Finance',
  generator: 'Portify',
  alternates: {
    canonical: siteUrl,
  },
  openGraph: {
    title: defaultTitle,
    description: defaultDescription,
    url: siteUrl,
    siteName,
    type: 'website',
    locale: 'en_US',
    images: [
      {
        url: `${siteUrl}/og-cover.png`,
        width: 1200,
        height: 630,
        alt: 'Portify – AI Insight For Every Portfolio',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: defaultTitle,
    description: defaultDescription,
    images: [`${siteUrl}/og-cover.png`],
    creator: '@portify',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
}

const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'FinancialService',
  name: siteName,
  url: siteUrl,
  description: defaultDescription,
  slogan: 'AI analysis on every portfolio in seconds',
  serviceType: 'AI portfolio manager',
  areaServed: 'Global',
  provider: {
    '@type': 'Organization',
    name: siteName,
    url: siteUrl,
  },
  offers: {
    '@type': 'Offer',
    availability: 'https://schema.org/InStock',
    price: '0',
    priceCurrency: 'USD',
    description: 'Instant insight in your portfolio with AI-driven analytics and reporting.',
  },
  keywords: primaryKeywords.join(', '),
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body className={`font-sans ${GeistSans.variable} ${GeistMono.variable}`}>
        {children}
        <SessionWatcher />
        <Analytics />
      </body>
    </html>
  )
}
