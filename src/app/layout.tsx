import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { AppProviders } from '@/components/providers/AppProviders';

// Geist isn't in next/font/google for Next 14. Inter + JetBrains Mono are
// close visual matches and have been stable since Next 13.
const geistSans = Inter({
  subsets: ['latin'],
  variable: '--font-geist-sans',
});

const geistMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
});

export const metadata: Metadata = {
  title: 'Void Chat',
  description: 'Self-hosted ephemeral messaging. What\'s said in the void stays in the void.',
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
