'use client';

import Link from 'next/link';
import { WarrantCanaryBadge } from '@/components/legal/WarrantCanary';

/**
 * Footer Component
 *
 * Site-wide footer with legal links and warrant canary status.
 */
export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-gray-900/50 border-t border-gray-800">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          {/* Left side - Logo and copyright */}
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-white">Clawed</span>
            <span className="text-gray-500 text-sm">
              &copy; {currentYear} Clawed Messenger
            </span>
          </div>

          {/* Center - Legal links */}
          <div className="flex items-center gap-6">
            <Link
              href="/terms"
              className="text-gray-400 hover:text-white text-sm transition-colors"
            >
              Terms of Service
            </Link>
            <Link
              href="/privacy"
              className="text-gray-400 hover:text-white text-sm transition-colors"
            >
              Privacy Policy
            </Link>
          </div>

          {/* Right side - Warrant Canary */}
          <div className="flex items-center gap-3">
            <WarrantCanaryBadge />
          </div>
        </div>
      </div>
    </footer>
  );
}

/**
 * Minimal footer for app pages (less intrusive)
 */
export function AppFooter() {
  return (
    <footer className="flex items-center justify-center gap-4 py-3 text-xs text-gray-500">
      <Link href="/terms" className="hover:text-gray-300 transition-colors">
        Terms
      </Link>
      <span>&middot;</span>
      <Link href="/privacy" className="hover:text-gray-300 transition-colors">
        Privacy
      </Link>
      <span>&middot;</span>
      <WarrantCanaryBadge className="scale-90" />
    </footer>
  );
}

export default Footer;
