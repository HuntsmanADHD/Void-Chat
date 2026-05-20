import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { AppProviders } from '@/components/providers/AppProviders';

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
  weight: '100 900',
});

const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
  weight: '100 900',
});

export const metadata: Metadata = {
  title: 'Void Chat - Private Messaging',
  description:
    'Privacy-first messenger with end-to-end encryption, communities, and P2P messaging. Zero-knowledge architecture.',
  keywords: [
    'messenger',
    'encrypted',
    'private',
    'p2p',
    'zero-knowledge',
    'void-chat',
  ],
  authors: [{ name: 'Void Chat Team' }],
  creator: 'Void Chat',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://voidchat.app',
    title: 'Void Chat - Private Messaging',
    description:
      'Privacy-first messenger with end-to-end encryption, communities, and P2P messaging.',
    siteName: 'Void Chat',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Void Chat - Private Messaging',
    description:
      'Privacy-first messenger with end-to-end encryption, communities, and P2P messaging.',
    creator: '@voidchatapp',
  },
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon-16x16.png',
    apple: '/apple-touch-icon.png',
  },
  manifest: '/site.webmanifest',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[var(--discord-bg)] text-white min-h-screen`}
      >
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
