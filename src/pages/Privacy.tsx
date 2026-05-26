import { Link } from 'react-router-dom';
import { WarrantCanary } from '@/components/legal/WarrantCanary';

// NOTE: Content here is from the pre-Tor era and references obsolete things
// (3-strike system, peer-to-peer, X handles). A full content rewrite is
// scheduled for a later phase; this file is a mechanical port to React
// Router so the route compiles.

export default function Privacy() {
  const lastUpdated = '2024-12-02';

  return (
    <div className="h-screen overflow-y-auto bg-gray-900 text-gray-100">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="mb-8">
          <Link to="/" className="text-purple-400 hover:text-purple-300 transition-colors">
            &larr; Back to Void Chat
          </Link>
        </div>
        <h1 className="text-4xl font-bold text-white mb-2">Privacy Policy</h1>
        <p className="text-gray-400 mb-8">Last updated: {lastUpdated}</p>
        <WarrantCanary />
        <div className="bg-gradient-to-r from-purple-900/50 to-pink-900/50 border border-purple-500/30 rounded-lg p-6 mb-8">
          <h2 className="text-xl font-semibold text-white mb-2">Our Privacy Philosophy</h2>
          <p className="text-gray-300">
            Void Chat is built on the principle of minimal data collection. We believe your
            conversations are yours alone. We use end to end encryption, collect only what is
            technically necessary, and we will never sell or share your data with third parties.
          </p>
        </div>
        <div className="prose prose-invert prose-purple max-w-none space-y-8">
          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">
              1. Introduction
            </h2>
            <p className="text-gray-300 leading-relaxed">
              This Privacy Policy explains how Void Chat (&quot;Void Chat,&quot; &quot;we,&quot;
              &quot;our,&quot; or &quot;us&quot;) collects, uses, and protects your information
              when you use our decentralized messaging platform.
            </p>
          </section>
          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">
              2. Information We DO NOT Collect
            </h2>
            <ul className="list-disc list-inside text-gray-300 space-y-2 ml-4">
              <li>
                <strong>Message Content:</strong> All messages are end-to-end encrypted. We cannot
                read, access, or decrypt your messages. Ever.
              </li>
              <li>
                <strong>Private Keys:</strong> We never have access to your private keys.
              </li>
              <li>
                <strong>Email Addresses, Phone Numbers, Real Names, Location Data, Device IDs:</strong>{' '}
                None collected.
              </li>
            </ul>
          </section>
          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">
              3. End-to-End Encryption
            </h2>
            <p className="text-gray-300 leading-relaxed">
              Void Chat implements strong end-to-end encryption using TweetNaCl. We have no
              technical capability to decrypt messages, even if compelled by law enforcement.
            </p>
          </section>
          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">
              4. Children&apos;s Privacy
            </h2>
            <p className="text-gray-300 leading-relaxed">
              Void Chat is not intended for users under 18 years of age.
            </p>
          </section>
          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">
              5. Changes
            </h2>
            <p className="text-gray-300 leading-relaxed">
              We may update this Privacy Policy from time to time. Continued use of the Platform
              constitutes acceptance.
            </p>
          </section>
        </div>
        <div className="mt-12 pt-8 border-t border-gray-700 flex flex-wrap gap-4">
          <Link to="/terms" className="text-purple-400 hover:text-purple-300 transition-colors">
            Terms of Service
          </Link>
          <Link to="/" className="text-purple-400 hover:text-purple-300 transition-colors">
            Return to Void Chat
          </Link>
        </div>
      </div>
    </div>
  );
}
