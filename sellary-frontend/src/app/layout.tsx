import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { QueryProvider } from '@/components/QueryProvider'
import { ServerHealthProvider } from '@/providers/ServerHealthProvider'
import { Toaster } from 'react-hot-toast'

// The UI is Russian throughout, so the cyrillic face is the one that must be
// preloaded — 'latin' alone left every visible string in the OS fallback until
// the CSS-discovered font arrived.
const inter = Inter({
  subsets: ['cyrillic', 'latin'],
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
})

export const metadata: Metadata = {
  title: 'Sellary',
  description: 'Автоматизация торговли',
}

// viewport-fit=cover is what makes env(safe-area-inset-*) resolve to anything
// other than 0. Without it every safe-area rule in the app is dead code and
// the register is letterboxed on a notched iPhone.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#ffffff',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ru">
      <body className={inter.className}>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[100] focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-bold focus:outline focus:outline-2 focus:outline-[var(--erp-accent)]"
        >
          К содержимому
        </a>
        <QueryProvider>
          <ServerHealthProvider>
            {children}
            <Toaster position="top-right" />
          </ServerHealthProvider>
        </QueryProvider>
      </body>
    </html>
  )
}
