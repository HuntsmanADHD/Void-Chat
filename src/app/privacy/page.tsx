'use client';

import Link from 'next/link';
import { WarrantCanary } from '@/components/legal/WarrantCanary';

export default function PrivacyPolicyPage() {
  const lastUpdated = '2024-12-02';

  return (
    <div className="h-screen overflow-y-auto bg-gray-900 text-gray-100">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="mb-8"><Link href="/" className="text-purple-400 hover:text-purple-300 transition-colors">&larr; Back to Void Chat</Link></div>
        <h1 className="text-4xl font-bold text-white mb-2">Privacy Policy</h1>
        <p className="text-gray-400 mb-8">Last updated: {lastUpdated}</p>
        <WarrantCanary />
        <div className="bg-gradient-to-r from-purple-900/50 to-pink-900/50 border border-purple-500/30 rounded-lg p-6 mb-8">
          <h2 className="text-xl font-semibold text-white mb-2">Our Privacy Philosophy</h2>
          <p className="text-gray-300">Void Chat is built on the principle of minimal data collection. We believe your conversations are yours alone. We use end to end encryption, collect only what & and is technically necessary, and we will never sell or share your data with third parties.</p>
        </div>
        <div className="prose prose-invert prose-purple max-w-none space-y-8">
          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">1. Introduction</h2>
            <p className="text-gray-300 leading-relaxed">This Privacy Policy explains how Void Chat (&quot;Void Chat,&quot; &quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) collects, uses, and protects your information when you use our decentralized messaging platform. We are committed to protecting your privacy and being transparent about our data practices.</p>
          </section>
          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">2. Information We Collect</h2>
            <h3 className="text-xl font-medium text-white mt-6 mb-3">2.1 Information You Provide</h3>
            <ul className="list-disc list-inside text-gray-300 space-y-2 ml-4">
              <li><strong>Public ID:</strong> Your human-readable public identifier, used as your unique identifier on the platform.</li>
              <li><strong>Encryption Public Key:</strong> Your TweetNaCl public key for end-to-end encryption. This is shared with other users to enable secure messaging.</li>
              <li><strong>Community Memberships:</strong> Records of which communities you join.</li>
            </ul>
            <h3 className="text-xl font-medium text-white mt-6 mb-3">2.2 Information We DO NOT Collect</h3>
            <ul className="list-disc list-inside text-gray-300 space-y-2 ml-4">
              <li><strong>Message Content:</strong> All messages are end-to-end encrypted. We cannot read, access, or decrypt your messages. Ever.</li>
              <li><strong>Private Keys:</strong> We never have access to your private keys or encryption secret keys.</li>
              <li><strong>Email Addresses:</strong> We do not collect or require email addresses.</li>
              <li><strong>Phone Numbers:</strong> We do not collect or require phone numbers.</li>
              <li><strong>Real Names:</strong> We do not require or collect your legal name.</li>
              <li><strong>Location Data:</strong> We do not collect GPS or precise location data.</li>
              <li><strong>Device Identifiers:</strong> We do not collect IMEI, advertising IDs, or device fingerprints.</li>
            </ul>
            <h3 className="text-xl font-medium text-white mt-6 mb-3">2.3 Automatically Collected Data</h3>
            <ul className="list-disc list-inside text-gray-300 space-y-2 ml-4">
              <li><strong>Message Metadata:</strong> Timestamps, sender/recipient public IDs, and community/channel identifiers needed for message routing.</li>
              <li><strong>Moderation Records:</strong> Strike counts and moderation actions for platform safety.</li>
            </ul>
          </section>
          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">3. End-to-End Encryption</h2>
            <p className="text-gray-300 leading-relaxed">Void Chat implements strong end-to-end encryption using TweetNaCl (Networking and Cryptography library):</p>
            <ul className="list-disc list-inside text-gray-300 space-y-2 ml-4">
              <li><strong>Key Generation:</strong> Encryption keys are generated locally on your device from your NaCl keypair.</li>
              <li><strong>Message Encryption:</strong> Messages are encrypted before leaving your device and can only be decrypted by the intended recipient.</li>
              <li><strong>No Backdoors:</strong> We have no technical capability to decrypt messages, even if compelled by law enforcement.</li>
              <li><strong>Peer-to-Peer:</strong> When possible, messages are sent directly between users without touching our servers.</li>
            </ul>
            <div className="bg-green-900/30 border border-green-500/30 rounded-lg p-4 mt-4">
              <p className="text-green-300 text-sm"><strong>Technical Note:</strong> We use X25519 for key exchange and XSalsa20-Poly1305 for authenticated encryption, providing both confidentiality and integrity protection.</p>
            </div>
          </section>
          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">4. How We Use Your Information</h2>
            <p className="text-gray-300 leading-relaxed">We use collected information solely for:</p>
            <ul className="list-disc list-inside text-gray-300 space-y-2 ml-4">
              <li>Authenticating your keypair and verifying your identity</li>
              <li>Routing encrypted messages to intended recipients</li>
              <li>Enabling the community moderation and strike system</li>
              <li>Maintaining platform security and preventing abuse</li>
            </ul>
            <h3 className="text-xl font-medium text-white mt-6 mb-3">We DO NOT:</h3>
            <ul className="list-disc list-inside text-gray-300 space-y-2 ml-4">
              <li>Sell your data to third parties</li>
              <li>Use your data for advertising or marketing</li>
              <li>Share your data with data brokers</li>
              <li>Build behavioral profiles or track you across the web</li>
              <li>Use your data for AI/ML training without consent</li>
            </ul>
          </section>
          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">5. Data Storage & Security</h2>
            <h3 className="text-xl font-medium text-white mt-6 mb-3">5.1 What&apos;s Stored Where</h3>
            <ul className="list-disc list-inside text-gray-300 space-y-2 ml-4">
              <li><strong>On Your Device:</strong> Encryption keys, message cache, and local preferences.</li>
              <li><strong>On Our Servers:</strong> Public IDs, public keys, community memberships, encrypted message blobs (unreadable to us), and moderation records.</li>
            </ul>
            <h3 className="text-xl font-medium text-white mt-6 mb-3">5.2 Security Measures</h3>
            <ul className="list-disc list-inside text-gray-300 space-y-2 ml-4">
              <li>All data in transit is encrypted using TLS 1.3</li>
              <li>Message content is end-to-end encrypted</li>
              <li>Database access is restricted and audited</li>
              <li>No plaintext secrets are stored in code or logs</li>
            </ul>
          </section>
          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">6. Data Retention</h2>
            <ul className="list-disc list-inside text-gray-300 space-y-2 ml-4">
              <li><strong>Account Data:</strong> Retained while your account is active on the platform.</li>
              <li><strong>Messages:</strong> Encrypted messages are retained for delivery and may be deleted after successful delivery in P2P mode.</li>
              <li><strong>Moderation Records:</strong> Strike history is retained permanently to enforce platform safety.</li>
              <li><strong>Blacklist:</strong> Permanently banned public IDs are retained indefinitely to prevent ban evasion.</li>
            </ul>
          </section>
          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">7. Third-Party Services</h2>
            <p className="text-gray-300 leading-relaxed">Void Chat minimizes third-party dependencies. We do not integrate with analytics services, advertising networks, social tracking pixels, or blockchain services.</p>
          </section>
          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">8. Your Rights & Choices</h2>
            <ul className="list-disc list-inside text-gray-300 space-y-2 ml-4">
              <li><strong>Access:</strong> You can view your stored data through the platform interface.</li>
              <li><strong>Deletion:</strong> You can request deletion of your account data, though moderation history may persist.</li>
              <li><strong>Export:</strong> Due to end-to-end encryption, you control your own message history on your device.</li>
              <li><strong>Opt-out:</strong> You can stop using the platform at any time by signing out.</li>
            </ul>
          </section>
          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">9. Law Enforcement & Legal Requests</h2>
            <p className="text-gray-300 leading-relaxed">Due to our privacy-first architecture:</p>
            <ul className="list-disc list-inside text-gray-300 space-y-2 ml-4">
              <li><strong>Message Content:</strong> We cannot provide message content as it is end-to-end encrypted and we do not hold decryption keys.</li>
              <li><strong>Metadata:</strong> We may be compelled to provide metadata (public IDs, timestamps, community memberships) in response to valid legal process.</li>
              <li><strong>No Mass Surveillance:</strong> We do not participate in mass surveillance programs or provide bulk data access.</li>
            </ul>
            <p className="text-gray-300 leading-relaxed mt-4">See our <Link href="#warrant-canary" className="text-purple-400 hover:text-purple-300">Warrant Canary</Link> for transparency about legal requests we have NOT received.</p>
          </section>
          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">10. Children&apos;s Privacy</h2>
            <p className="text-gray-300 leading-relaxed">Void Chat is not intended for users under 18 years of age. We do not knowingly collect information from children. If you believe a child has provided us with information, please report this through the community moderation system.</p>
          </section>
          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">11. International Users</h2>
            <p className="text-gray-300 leading-relaxed">Void Chat is a global, decentralized platform. By using Void Chat, you consent to the transfer of your information to servers that may be located in different jurisdictions. We strive to comply with applicable data protection laws including GDPR for EU users.</p>
          </section>
          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">12. Changes to This Policy</h2>
            <p className="text-gray-300 leading-relaxed">We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated date. Significant changes may be announced through the platform. Your continued use constitutes acceptance of the updated policy.</p>
          </section>
          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">13. Community Governance</h2>
            <p className="text-gray-300 leading-relaxed">Void Chat operates as a community-governed platform. There is no central support team, email contact, or customer service department for privacy inquiries. Privacy-related concerns should be addressed through:</p>
            <ul className="list-disc list-inside text-gray-300 space-y-2 ml-4">
              <li>Community moderators for content-related issues</li>
              <li>Platform settings for managing your own data</li>
              <li>Signing out to cease data collection</li>
            </ul>
            <p className="text-gray-300 leading-relaxed mt-4">This community-based approach is fundamental to our decentralized design and ensures no single point of control over user data.</p>
          </section>
        </div>
        <div className="mt-12 pt-8 border-t border-gray-700 flex flex-wrap gap-4">
          <Link href="/terms" className="text-purple-400 hover:text-purple-300 transition-colors">Terms of Service</Link>
          <Link href="/" className="text-purple-400 hover:text-purple-300 transition-colors">Return to Void Chat</Link>
        </div>
      </div>
    </div>
  );
}
