'use client';

import React, { useState, useRef, useCallback, KeyboardEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Hash, Plus, Settings, ChevronDown, ArrowLeft, X, Users, Globe } from 'lucide-react';
import { useHarmonicTyping } from '@/hooks/useHarmonicTyping';

const DEMO_MESSAGES = [
  { id: '1', sender: 'CryptoWhale', wallet: '7xKX...9mPq', content: 'Hey everyone! Welcome to the Clawed community!', time: '2:30 PM', isOwn: false },
  { id: '2', sender: 'SolanaBuilder', wallet: '4nFz...2kLp', content: 'This E2E encryption is really solid. Love that messages are encrypted with TweetNaCl.', time: '2:31 PM', isOwn: false },
  { id: '3', sender: 'You', wallet: 'Demo...User', content: 'The 432Hz typing sounds are so relaxing! Try typing in the input below.', time: '2:32 PM', isOwn: true },
  { id: '4', sender: 'TokenHolder', wallet: '9pQr...5vXw', content: 'Just verified my $CLAWED holdings. Token-gated access is working perfectly.', time: '2:33 PM', isOwn: false },
  { id: '5', sender: 'Web3Dev', wallet: '2mNk...8jYt', content: 'The P2P messaging is blazing fast. No middleman, pure Web3.', time: '2:34 PM', isOwn: false },
];

const DEMO_CHANNELS = [
  { id: '1', name: 'general', unread: 0 },
  { id: '2', name: 'announcements', unread: 2 },
  { id: '3', name: 'trading', unread: 0 },
  { id: '4', name: 'dev-talk', unread: 5 },
];

const INITIAL_COMMUNITIES = [
  { id: '1', name: 'Clawed Official', icon: null },
  { id: '2', name: 'SOL Traders', icon: null },
  { id: '3', name: 'NFT Collectors', icon: null },
];

function CreateCommunityModal({ isOpen, onClose, onCreateCommunity }: { isOpen: boolean; onClose: () => void; onCreateCommunity: (name: string, description: string) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsCreating(true);
    await new Promise(resolve => setTimeout(resolve, 500));
    onCreateCommunity(name.trim(), description.trim());
    setName('');
    setDescription('');
    setIsCreating(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#313338] rounded-lg shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-700">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-white">Create a Community</h2>
            <button onClick={onClose} className="p-1 text-zinc-400 hover:text-white transition-colors rounded"><X className="w-5 h-5" /></button>
          </div>
          <p className="text-sm text-zinc-400 mt-1">Demo mode - no token requirements!</p>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Community Name <span className="text-red-400">*</span></label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Awesome Community" maxLength={50} className="w-full px-4 py-2.5 bg-zinc-900 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors" />
            <p className="text-xs text-zinc-500 mt-1">{name.length}/50 characters</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's your community about?" maxLength={200} rows={3} className="w-full px-4 py-2.5 bg-zinc-900 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors resize-none" />
            <p className="text-xs text-zinc-500 mt-1">{description.length}/200 characters</p>
          </div>
          <div className="p-3 bg-indigo-900/30 border border-indigo-500/30 rounded-lg">
            <div className="flex items-start gap-2">
              <Globe className="w-5 h-5 text-indigo-400 flex-shrink-0 mt-0.5" />
              <div><p className="text-sm text-indigo-300 font-medium">Demo Mode</p><p className="text-xs text-zinc-400 mt-0.5">In the real app, you can set token requirements for your community. This demo creates a public community with no restrictions.</p></div>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg font-medium transition-colors">Cancel</button>
            <button type="submit" disabled={!name.trim() || isCreating} className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-600/50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2">
              {isCreating ? (<><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>Creating...</>) : (<><Users className="w-4 h-4" />Create Community</>)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DemoMessage({ message }: { message: typeof DEMO_MESSAGES[0] }) {
  return (
    <div className={`flex gap-3 px-4 py-2 hover:bg-zinc-800/30 ${message.isOwn ? 'flex-row-reverse' : ''}`}>
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0">
        <span className="text-white text-sm font-medium">{message.sender.slice(0, 2).toUpperCase()}</span>
      </div>
      <div className={`flex flex-col ${message.isOwn ? 'items-end' : ''}`}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">{message.sender}</span>
          <span className="text-xs text-zinc-500">{message.wallet}</span>
          <span className="text-xs text-zinc-600">{message.time}</span>
        </div>
        <div className={`mt-1 px-3 py-2 rounded-lg max-w-md ${message.isOwn ? 'bg-indigo-600 text-white' : 'bg-zinc-700 text-zinc-100'}`}>{message.content}</div>
      </div>
    </div>
  );
}

function DemoMessageInput() {
  const [message, setMessage] = useState('');
  const [sentMessages, setSentMessages] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { playNote, isEnabled: soundEnabled, toggleSound } = useHarmonicTyping({ enabled: true, volume: 0.15, noteDuration: 120 });

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) { playNote(event.key); }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (message.trim()) { setSentMessages(prev => [...prev, message]); setMessage(''); }
    }
  }, [message, playNote]);

  return (
    <div className="px-4 py-3 bg-zinc-800/50">
      {sentMessages.length > 0 && (<div className="mb-3 space-y-2">{sentMessages.map((msg, i) => (<div key={i} className="flex justify-end"><div className="px-3 py-2 rounded-lg bg-indigo-600 text-white max-w-md">{msg}</div></div>))}</div>)}
      <div className="flex items-end gap-3 bg-zinc-700/50 rounded-lg px-4 py-2">
        <button type="button" onClick={toggleSound} className={`p-1 transition-colors flex-shrink-0 ${soundEnabled ? 'text-indigo-400 hover:text-indigo-300' : 'text-zinc-500 hover:text-zinc-400'}`} title={soundEnabled ? '432Hz typing sounds ON (click to mute)' : '432Hz typing sounds OFF (click to enable)'}>
          {soundEnabled ? (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>) : (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg>)}
        </button>
        <textarea ref={textareaRef} value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={handleKeyDown} placeholder="Type here to hear 432Hz harmonic sounds..." rows={1} className="flex-1 bg-transparent text-white placeholder-zinc-500 resize-none focus:outline-none min-h-[24px] max-h-[200px]" />
        <div className="flex items-center gap-1 text-xs text-emerald-400" title="End-to-end encrypted"><svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg></div>
        <button className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors" onClick={() => { if (message.trim()) { setSentMessages(prev => [...prev, message]); setMessage(''); } }}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
        </button>
      </div>
      <div className="mt-2 text-center"><span className="text-xs text-indigo-400">Try typing to hear the 432Hz harmonic tones - each key plays a different note!</span></div>
    </div>
  );
}

export default function DemoPage() {
  const [activeChannel, setActiveChannel] = useState('1');
  const [activeCommunity, setActiveCommunity] = useState('1');
  const [communities, setCommunities] = useState(INITIAL_COMMUNITIES);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const handleCreateCommunity = useCallback((name: string, _description: string) => {
    const newCommunity = { id: `${Date.now()}`, name, icon: null };
    setCommunities(prev => [...prev, newCommunity]);
    setActiveCommunity(newCommunity.id);
  }, []);

  const activeCommunityData = communities.find(c => c.id === activeCommunity);

  return (
    <div className="h-screen flex bg-[#1e1f22]">
      <div className="w-[72px] bg-[#1e1f22] flex flex-col items-center py-3 gap-2">
        <div className="relative group">
          <div className="w-12 h-12 rounded-2xl hover:rounded-xl transition-all duration-200 overflow-hidden bg-indigo-600 flex items-center justify-center cursor-pointer">
            <Image src="/images/logo.png" alt="Clawed" width={48} height={48} className="w-full h-full object-cover" />
          </div>
          <span className="absolute left-0 w-1 h-5 bg-white rounded-r-full -translate-x-1 top-1/2 -translate-y-1/2" />
        </div>
        <div className="w-8 h-0.5 bg-zinc-700 rounded-full my-1" />
        {communities.map((community) => (
          <div key={community.id} className="relative group">
            <div onClick={() => setActiveCommunity(community.id)} className={`w-12 h-12 rounded-full hover:rounded-xl transition-all duration-200 flex items-center justify-center cursor-pointer ${activeCommunity === community.id ? 'bg-indigo-600' : 'bg-zinc-700'}`}>
              <span className="text-white text-sm font-medium">{community.name.slice(0, 2).toUpperCase()}</span>
            </div>
            {activeCommunity === community.id && (<span className="absolute left-0 w-1 h-10 bg-white rounded-r-full -translate-x-1 top-1/2 -translate-y-1/2" />)}
            <div className="absolute left-full ml-4 px-3 py-2 bg-zinc-900 text-white text-sm rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 shadow-lg">{community.name}</div>
          </div>
        ))}
        <div onClick={() => setShowCreateModal(true)} className="w-12 h-12 rounded-full hover:rounded-xl transition-all duration-200 bg-zinc-700 hover:bg-emerald-500 flex items-center justify-center cursor-pointer group">
          <Plus className="w-6 h-6 text-emerald-500 group-hover:text-white transition-colors" />
        </div>
      </div>

      <CreateCommunityModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} onCreateCommunity={handleCreateCommunity} />

      <div className="w-60 bg-[#2b2d31] flex flex-col">
        <div className="h-12 px-4 flex items-center justify-between border-b border-zinc-900 shadow-sm">
          <h2 className="font-semibold text-white truncate">{activeCommunityData?.name || 'Community'}</h2>
          <ChevronDown className="w-5 h-5 text-zinc-400" />
        </div>
        <div className="flex-1 overflow-y-auto pt-4 px-2">
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-xs font-semibold text-zinc-500 uppercase">Text Channels</span>
            <Plus className="w-4 h-4 text-zinc-500 hover:text-white cursor-pointer" />
          </div>
          {DEMO_CHANNELS.map(channel => (
            <div key={channel.id} onClick={() => setActiveChannel(channel.id)} className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer ${activeChannel === channel.id ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50'}`}>
              <Hash className="w-5 h-5 opacity-60" />
              <span className="flex-1 truncate">{channel.name}</span>
              {channel.unread > 0 && (<span className="px-1.5 py-0.5 text-xs font-bold bg-red-500 text-white rounded-full">{channel.unread}</span>)}
            </div>
          ))}
        </div>
        <div className="h-[52px] bg-[#232428] flex items-center px-2 gap-2">
          <div className="flex items-center gap-2 flex-1 p-1 rounded hover:bg-zinc-700 cursor-pointer">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center"><span className="text-white text-xs font-medium">DE</span></div>
            <div className="flex-1 min-w-0"><p className="text-sm font-medium text-white truncate">DemoUser</p><p className="text-xs text-zinc-400">Online</p></div>
          </div>
          <Settings className="w-5 h-5 text-zinc-400 hover:text-white cursor-pointer" />
        </div>
      </div>

      <div className="flex-1 flex flex-col bg-[#313338]">
        <div className="h-12 px-4 flex items-center gap-3 border-b border-zinc-900 shadow-sm">
          <Link href="/" className="text-zinc-400 hover:text-white transition-colors"><ArrowLeft className="w-5 h-5" /></Link>
          <Hash className="w-6 h-6 text-zinc-400" />
          <h3 className="font-semibold text-white">general</h3>
          <span className="text-zinc-500 text-sm ml-2">Welcome to Clawed - Demo Mode</span>
        </div>
        <div className="flex-1 overflow-y-auto relative">
          <div className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-10 pointer-events-none" style={{ backgroundImage: 'url(/images/chat-background.jpg)' }} />
          <div className="relative py-4">
            <div className="px-4 py-6 mb-4">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mb-4"><Hash className="w-8 h-8 text-white" /></div>
              <h2 className="text-2xl font-bold text-white mb-1">Welcome to #general!</h2>
              <p className="text-zinc-400">This is the start of the #general channel. All messages are end-to-end encrypted.</p>
            </div>
            <div className="border-t border-zinc-700 my-4" />
            {DEMO_MESSAGES.map(msg => (<DemoMessage key={msg.id} message={msg} />))}
          </div>
        </div>
        <DemoMessageInput />
      </div>

      <div className="w-60 bg-[#2b2d31] p-4 hidden lg:block">
        <h3 className="font-semibold text-white mb-4">Demo Features</h3>
        <div className="space-y-4">
          <div className="p-3 bg-zinc-800 rounded-lg">
            <div className="flex items-center gap-2 text-indigo-400 mb-1"><svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" /></svg><span className="text-sm font-medium">432Hz Typing</span></div>
            <p className="text-xs text-zinc-400">Type in the input to hear harmonic tones tuned to 432Hz</p>
          </div>
          <div className="p-3 bg-zinc-800 rounded-lg">
            <div className="flex items-center gap-2 text-emerald-400 mb-1"><svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg><span className="text-sm font-medium">E2E Encrypted</span></div>
            <p className="text-xs text-zinc-400">All messages encrypted with TweetNaCl</p>
          </div>
          <div className="p-3 bg-zinc-800 rounded-lg">
            <div className="flex items-center gap-2 text-purple-400 mb-1"><Image src="/images/logo.png" alt="Logo" width={16} height={16} className="rounded" /><span className="text-sm font-medium">Clawed Branding</span></div>
            <p className="text-xs text-zinc-400">Custom logo and cosmic chat background</p>
          </div>
          <div className="p-3 bg-zinc-800 rounded-lg">
            <div className="flex items-center gap-2 text-amber-400 mb-1"><svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" /><path fillRule="evenodd" d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" clipRule="evenodd" /></svg><span className="text-sm font-medium">$CLAWED Token</span></div>
            <p className="text-xs text-zinc-400">Token-gated access for communities</p>
          </div>
        </div>
        <Link href="/" className="mt-6 block w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-center rounded-lg font-medium transition-colors">Connect Wallet</Link>
      </div>
    </div>
  );
}
