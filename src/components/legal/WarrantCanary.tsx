'use client';

import { useState } from 'react';

/**
 * Warrant Canary Component
 *
 * Displays the warrant canary status for Void Chat.
 * The canary is "alive" (shown) unless it needs to be removed.
 *
 * A warrant canary is a method by which a service provider can inform
 * users that they have NOT received certain types of legal requests.
 * If the canary disappears, it may indicate that such a request has been received.
 *
 * To disable the canary, set NEXT_PUBLIC_WARRANT_CANARY_ACTIVE=false in .env
 */

// The canary is active by default - only disable if legally required
const CANARY_ACTIVE = process.env.NEXT_PUBLIC_WARRANT_CANARY_ACTIVE !== 'false';

// Last verified date - update this when you review/renew the canary
const LAST_VERIFIED = '2024-12-02';

interface WarrantCanaryProps {
  /** Show compact version (icon only with tooltip) */
  compact?: boolean;
  /** Additional CSS classes */
  className?: string;
}

export function WarrantCanary({ compact = false, className = '' }: WarrantCanaryProps) {
  const [showDetails, setShowDetails] = useState(false);

  // If canary is disabled, don't render anything
  if (!CANARY_ACTIVE) {
    return null;
  }

  // Compact version - just the icon with hover state
  if (compact) {
    return (
      <div className={`relative inline-block ${className}`}>
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-green-400 hover:text-green-300 transition-colors p-1 rounded-full hover:bg-green-900/30"
          title="Warrant Canary Active"
          aria-label="Warrant Canary Status"
        >
          <CanaryIcon className="w-5 h-5" />
        </button>

        {showDetails && (
          <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-64 p-3 bg-gray-800 border border-green-500/30 rounded-lg shadow-xl z-50">
            <div className="flex items-center gap-2 mb-2">
              <CanaryIcon className="w-4 h-4 text-green-400" />
              <span className="text-green-400 font-medium text-sm">Canary Active</span>
            </div>
            <p className="text-gray-300 text-xs leading-relaxed">
              As of {LAST_VERIFIED}, Void Chat has not received any secret court orders,
              national security letters, or gag orders.
            </p>
            <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-1/2 rotate-45 w-2 h-2 bg-gray-800 border-r border-b border-green-500/30"></div>
          </div>
        )}
      </div>
    );
  }

  // Full version - detailed canary statement
  return (
    <div
      id="warrant-canary"
      className={`bg-green-900/20 border border-green-500/30 rounded-lg p-6 mb-8 ${className}`}
    >
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0">
          <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center">
            <CanaryIcon className="w-7 h-7 text-green-400" />
          </div>
        </div>

        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-lg font-semibold text-green-400">Warrant Canary</h3>
            <span className="px-2 py-0.5 bg-green-500/20 text-green-300 text-xs font-medium rounded-full">
              ACTIVE
            </span>
          </div>

          <p className="text-gray-300 text-sm leading-relaxed mb-4">
            As of <strong>{LAST_VERIFIED}</strong>, Void Chat has:
          </p>

          <ul className="space-y-2 text-sm text-gray-300">
            <li className="flex items-start gap-2">
              <CheckIcon className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
              <span>NOT received any National Security Letters or FISA orders</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckIcon className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
              <span>NOT received any gag orders preventing disclosure of government requests</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckIcon className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
              <span>NOT been required to install any backdoors or surveillance capabilities</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckIcon className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
              <span>NOT provided any user encryption keys to third parties</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckIcon className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
              <span>NOT been subject to any secret court orders</span>
            </li>
          </ul>

          <div className="mt-4 pt-4 border-t border-green-500/20">
            <p className="text-gray-400 text-xs">
              <strong>What is a warrant canary?</strong> A warrant canary is a transparency mechanism.
              If this notice disappears or is not updated, it may indicate that we have received
              a legal request that we cannot disclose. Due to our end-to-end encryption, we cannot
              provide message content even if compelled.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Canary bird icon
 */
function CanaryIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Bird body */}
      <ellipse cx="12" cy="13" rx="6" ry="5" />
      {/* Head */}
      <circle cx="14" cy="8" r="3" />
      {/* Beak */}
      <path d="M17 8 L20 7 L17 9" />
      {/* Eye */}
      <circle cx="15" cy="7.5" r="0.5" fill="currentColor" />
      {/* Tail */}
      <path d="M6 14 L2 16 M6 13 L3 14 M6 15 L3 18" />
      {/* Wing */}
      <path d="M9 11 Q12 9 15 12" />
      {/* Legs */}
      <path d="M10 18 L10 21 M14 18 L14 21" />
      {/* Feet */}
      <path d="M8 21 L12 21 M12 21 L16 21" />
    </svg>
  );
}

/**
 * Checkmark icon
 */
function CheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/**
 * Compact canary indicator for headers/footers
 */
export function WarrantCanaryBadge({ className = '' }: { className?: string }) {
  if (!CANARY_ACTIVE) {
    return null;
  }

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-1 bg-green-900/30 border border-green-500/30 rounded-full ${className}`}
      title={`Warrant Canary Active - Last verified: ${LAST_VERIFIED}`}
    >
      <CanaryIcon className="w-3.5 h-3.5 text-green-400" />
      <span className="text-green-400 text-xs font-medium">Canary Active</span>
    </div>
  );
}

export default WarrantCanary;
