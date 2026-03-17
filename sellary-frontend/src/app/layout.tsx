import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import QueryProvider from '@/components/QueryProvider'
import { ServerHealthProvider } from '@/providers/ServerHealthProvider'
import { Toaster } from 'react-hot-toast'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Sellary',
  description: 'Автоматизация торговли',
  manifest: '/manifest.json',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ru">
      <body className={inter.className}>
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
