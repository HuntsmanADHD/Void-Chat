import { Link } from 'react-router-dom';
import { WarrantCanary } from '@/components/legal/WarrantCanary';

// NOTE: Content here is from the pre-Tor era (refers to 3-strike system,
// central moderation, etc.). A full content rewrite is scheduled for a
// later phase; this file is a mechanical port to React Router.

export default function Terms() {
  const lastUpdated = '2024-12-02';

  return (
    <div className="h-screen overflow-y-auto bg-gray-900 text-gray-100">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="mb-8">
          <Link to="/" className="text-purple-400 hover:text-purple-300 transition-colors">
            &larr; Back to Void Chat
          </Link>
        </div>

        <h1 className="text-4xl font-bold text-white mb-2">Terms of Service</h1>
        <p className="text-gray-400 mb-8">Last updated: {lastUpdated}</p>

        <WarrantCanary />

        <div className="prose prose-invert prose-purple max-w-none space-y-8">
          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">
              1. Introduction
            </h2>
            <p className="text-gray-300 leading-relaxed">
              Welcome to Void Chat. By accessing or using Void Chat, you agree to be bound by
              these Terms of Service.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">
              2. Eligibility
            </h2>
            <p className="text-gray-300 leading-relaxed">
              To use Void Chat, you must be at least 18 years of age or the age of majority in
              your jurisdiction.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">
              3. No Account Recovery
            </h2>
            <p className="text-gray-300 leading-relaxed">
              Void Chat uses ephemeral cryptographic keys. We do not store passwords or recovery
              phrases. You are solely responsible for maintaining the security of your private
              keys.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">
              4. Prohibited Activities
            </h2>
            <p className="text-gray-300 leading-relaxed">You agree not to use Void Chat to:</p>
            <ul className="list-disc list-inside text-gray-300 space-y-2 ml-4">
              <li>Violate any applicable laws or regulations</li>
              <li>Harass, abuse, threaten, or intimidate other users</li>
              <li>Distribute spam, malware, or phishing attempts</li>
              <li>Share illegal content</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">
              5. Disclaimers
            </h2>
            <p className="text-gray-300 leading-relaxed">
              THE PLATFORM IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT
              WARRANTIES OF ANY KIND.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">
              6. Changes
            </h2>
            <p className="text-gray-300 leading-relaxed">
              We may update these Terms from time to time. Continued use of the Platform after
              changes constitutes acceptance.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-gray-700 flex flex-wrap gap-4">
          <Link to="/privacy" className="text-purple-400 hover:text-purple-300 transition-colors">
            Privacy Policy
          </Link>
          <Link to="/" className="text-purple-400 hover:text-purple-300 transition-colors">
            Return to Void Chat
          </Link>
        </div>
      </div>
    </div>
  );
}
