'use client';

import Link from 'next/link';
import { WarrantCanary } from '@/components/legal/WarrantCanary';

export default function TermsOfServicePage() {
  const lastUpdated = '2024-12-02';

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="mb-8">
          <Link href="/" className="text-purple-400 hover:text-purple-300 transition-colors">&larr; Back to Clawed</Link>
        </div>

        <h1 className="text-4xl font-bold text-white mb-2">Terms of Service</h1>
        <p className="text-gray-400 mb-8">Last updated: {lastUpdated}</p>

        <WarrantCanary />

        <div className="prose prose-invert prose-purple max-w-none space-y-8">
          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">1. Introduction</h2>
            <p className="text-gray-300 leading-relaxed">Welcome to Clawed Messenger (&quot;Clawed,&quot; &quot;we,&quot; &quot;our,&quot; or &quot;the Platform&quot;). Clawed is a decentralized, peer-to-peer messaging platform built on the Solana blockchain. By accessing or using Clawed, you agree to be bound by these Terms of Service (&quot;Terms&quot;). If you do not agree to these Terms, do not use the Platform.</p>
            <p className="text-gray-300 leading-relaxed">Clawed operates as a community-governed platform where users are responsible for maintaining community standards through a decentralized moderation system.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">2. Eligibility</h2>
            <p className="text-gray-300 leading-relaxed">To use Clawed, you must:</p>
            <ul className="list-disc list-inside text-gray-300 space-y-2 ml-4">
              <li>Be at least 18 years of age or the age of majority in your jurisdiction</li>
              <li>Have the legal capacity to enter into a binding agreement</li>
              <li>Own or have authorized access to a Solana-compatible wallet</li>
              <li>Not be prohibited from using the Platform under applicable laws</li>
              <li>Not have been previously banned from the Platform</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">3. Account & Wallet Authentication</h2>
            <p className="text-gray-300 leading-relaxed">Clawed uses Solana wallet-based authentication. Your wallet address serves as your unique identifier on the Platform.</p>
            <ul className="list-disc list-inside text-gray-300 space-y-2 ml-4">
              <li><strong>No Account Recovery:</strong> We do not store passwords or recovery phrases. If you lose access to your wallet, you lose access to your Clawed identity.</li>
              <li><strong>Wallet Security:</strong> You are solely responsible for maintaining the security of your wallet and private keys.</li>
              <li><strong>Optional X/Twitter Linking:</strong> You may optionally link your X (Twitter) account for identity verification. This is voluntary and can be unlinked at any time.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">4. $CLAWED Token & Access</h2>
            <p className="text-gray-300 leading-relaxed">Certain features of Clawed may require holding $CLAWED tokens:</p>
            <ul className="list-disc list-inside text-gray-300 space-y-2 ml-4">
              <li>Community owners may set minimum token requirements for membership</li>
              <li>Token balances are verified on-chain at the time of access</li>
              <li>The Platform does not guarantee the value or liquidity of $CLAWED tokens</li>
              <li>Token requirements are set by community owners, not the Platform</li>
            </ul>
            <p className="text-gray-300 leading-relaxed mt-4"><strong>Disclaimer:</strong> $CLAWED tokens are not investment vehicles. We make no representations about their value, utility beyond the Platform, or future development.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">5. User Conduct & Prohibited Activities</h2>
            <p className="text-gray-300 leading-relaxed">You agree not to use Clawed to:</p>
            <ul className="list-disc list-inside text-gray-300 space-y-2 ml-4">
              <li>Violate any applicable laws or regulations</li>
              <li>Harass, abuse, threaten, or intimidate other users</li>
              <li>Distribute spam, malware, or phishing attempts</li>
              <li>Engage in fraud, scams, or deceptive practices</li>
              <li>Share illegal content including but not limited to CSAM, terrorism content, or content that violates intellectual property rights</li>
              <li>Attempt to circumvent the moderation or strike system</li>
              <li>Create multiple accounts to evade bans</li>
              <li>Interfere with the Platform&apos;s operation or security</li>
              <li>Impersonate other users or entities</li>
              <li>Collect or harvest user data without consent</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">6. Community-Based Moderation</h2>
            <p className="text-gray-300 leading-relaxed">Clawed operates on a decentralized, community-policed moderation model:</p>
            <h3 className="text-xl font-medium text-white mt-6 mb-3">6.1 Reporting System</h3>
            <ul className="list-disc list-inside text-gray-300 space-y-2 ml-4">
              <li>Any user may report content or behavior that violates these Terms</li>
              <li>Reports are reviewed by community owners and designated moderators</li>
              <li>There is no central support team or email contact for reports</li>
              <li>All moderation is handled within the community structure</li>
            </ul>
            <h3 className="text-xl font-medium text-white mt-6 mb-3">6.2 Strike System</h3>
            <ul className="list-disc list-inside text-gray-300 space-y-2 ml-4">
              <li><strong>First Strike:</strong> Warning and temporary timeout</li>
              <li><strong>Second Strike:</strong> Extended timeout period</li>
              <li><strong>Third Strike:</strong> Permanent ban from the Platform</li>
            </ul>
            <p className="text-gray-300 leading-relaxed mt-4">Strikes are issued by community moderators and are recorded on your wallet address. Permanent bans apply to the wallet address and cannot be appealed through the Platform.</p>
            <h3 className="text-xl font-medium text-white mt-6 mb-3">6.3 No Central Authority</h3>
            <p className="text-gray-300 leading-relaxed">Clawed does not maintain a support team, customer service, or centralized moderation authority. All content moderation is performed by community owners and their designated moderators. We do not intervene in community-level moderation decisions.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">7. Encryption & Message Privacy</h2>
            <p className="text-gray-300 leading-relaxed">Clawed implements end-to-end encryption for all messages:</p>
            <ul className="list-disc list-inside text-gray-300 space-y-2 ml-4">
              <li>Messages are encrypted using TweetNaCl cryptography</li>
              <li>Encryption keys are derived from your wallet signature</li>
              <li>We cannot read, access, or decrypt your messages</li>
              <li>Message content is only accessible to intended recipients</li>
              <li>Peer-to-peer messages bypass our servers entirely when possible</li>
            </ul>
            <p className="text-gray-300 leading-relaxed mt-4"><strong>Important:</strong> While we cannot access message content, metadata (such as sender/recipient wallet addresses, timestamps, and community membership) may be visible to the system for routing and moderation purposes.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">8. Intellectual Property</h2>
            <p className="text-gray-300 leading-relaxed">You retain ownership of content you create and share on Clawed. By using the Platform, you grant other users a limited license to view and interact with your content as intended by the Platform&apos;s features.</p>
            <p className="text-gray-300 leading-relaxed">The Clawed name, logo, and Platform code are proprietary. You may not copy, modify, or distribute Platform assets without permission.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">9. Disclaimers & Limitation of Liability</h2>
            <p className="text-gray-300 leading-relaxed">THE PLATFORM IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED.</p>
            <ul className="list-disc list-inside text-gray-300 space-y-2 ml-4">
              <li>We do not guarantee uninterrupted or error-free service</li>
              <li>We are not responsible for user-generated content</li>
              <li>We are not liable for any losses related to cryptocurrency or tokens</li>
              <li>We are not responsible for actions of community moderators</li>
              <li>We do not guarantee the security of third-party services or wallets</li>
            </ul>
            <p className="text-gray-300 leading-relaxed mt-4">TO THE MAXIMUM EXTENT PERMITTED BY LAW, CLAWED SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF THE PLATFORM.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">10. Termination</h2>
            <p className="text-gray-300 leading-relaxed">You may stop using Clawed at any time. We may terminate or suspend your access if:</p>
            <ul className="list-disc list-inside text-gray-300 space-y-2 ml-4">
              <li>You violate these Terms</li>
              <li>You accumulate three strikes through the moderation system</li>
              <li>Your conduct poses a risk to other users or the Platform</li>
              <li>Required by law</li>
            </ul>
            <p className="text-gray-300 leading-relaxed mt-4">Due to the decentralized nature of the Platform, some content may persist on peer nodes after account termination.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">11. Changes to These Terms</h2>
            <p className="text-gray-300 leading-relaxed">We may update these Terms from time to time. Changes will be posted on this page with an updated &quot;Last updated&quot; date. Continued use of the Platform after changes constitutes acceptance of the new Terms.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">12. Governing Law & Disputes</h2>
            <p className="text-gray-300 leading-relaxed">These Terms are governed by the laws of the jurisdiction in which the Platform operators are located, without regard to conflict of law principles. Any disputes shall be resolved through binding arbitration, except where prohibited by law.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">13. Severability</h2>
            <p className="text-gray-300 leading-relaxed">If any provision of these Terms is found to be unenforceable, the remaining provisions will continue in full force and effect.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white border-b border-gray-700 pb-2">14. Community Governance</h2>
            <p className="text-gray-300 leading-relaxed">Clawed is a community-governed platform. There is no central support team, email contact, or customer service department. All issues, reports, and moderation are handled through the community structure:</p>
            <ul className="list-disc list-inside text-gray-300 space-y-2 ml-4">
              <li>Content reports are submitted through the in-app reporting system</li>
              <li>Community owners and moderators review and act on reports</li>
              <li>Platform governance is decentralized among community stakeholders</li>
            </ul>
            <p className="text-gray-300 leading-relaxed mt-4">By using Clawed, you acknowledge and accept this community-based governance model.</p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-gray-700 flex flex-wrap gap-4">
          <Link href="/privacy" className="text-purple-400 hover:text-purple-300 transition-colors">Privacy Policy</Link>
          <Link href="/" className="text-purple-400 hover:text-purple-300 transition-colors">Return to Clawed</Link>
        </div>
      </div>
    </div>
  );
}
