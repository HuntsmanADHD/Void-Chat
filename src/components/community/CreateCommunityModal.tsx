'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { useBackdropClose } from '@/components/ui/useBackdropClose';

const createCommunityFormSchema = z.object({
  name: z.string().min(2).max(64).regex(/^[a-zA-Z0-9 _-]+$/),
  description: z.string().max(500).optional(),
  isPrivate: z.boolean().optional(),
  password: z.string().optional(),
});

export interface CreateCommunityFormData {
  name: string;
  description: string;
  icon?: File | null;
  iconPreview?: string | null;
  isPrivate: boolean;
  /** Password gate for private communities. Empty when isPrivate is false. */
  password: string;
}

export interface JoinCommunityFormData {
  /** Invite code (community id) the recipient pasted. */
  inviteCode: string;
  /** Optional password — required if the community turns out to be private. */
  password: string;
}

export interface CreateCommunityModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Submit handler for the Create tab. */
  onSubmit: (data: CreateCommunityFormData) => Promise<void>;
  /** Submit handler for the Join tab. Should return `null` on success or an
   *  error string to display under the form on failure. */
  onJoin?: (data: JoinCommunityFormData) => Promise<string | null>;
  isSubmitting?: boolean;
  error?: string | null;
}

type ActiveTab = 'create' | 'join';

const VALIDATION = {
  icon: {
    maxSize: 2 * 1024 * 1024,
    allowedTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
  },
};

/**
 * Downscale the picked image to a 256x256 JPEG in-browser before turning it
 * into a data URL. Without this, a typical phone-camera PNG is 3-6 MB which
 * exceeds both the server's avatar size limit and any sane GET payload.
 */
async function downscaleToDataUrl(file: File, maxDim = 256, quality = 0.85): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d unavailable');
    ctx.drawImage(bitmap, 0, 0, w, h);
    // JPEG keeps the data URL smallest. The 0.85 quality is visually
    // indistinguishable from the source at this size.
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    bitmap.close();
  }
}

function Backdrop({
  handlers,
  children,
}: {
  handlers: { onMouseDown: (e: React.MouseEvent) => void; onClick: (e: React.MouseEvent) => void };
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      {...handlers}
    >
      {children}
    </div>
  );
}

function FormField({
  label,
  required,
  error,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-zinc-300">
        {label}
        {required && <span className="text-red-400 ml-1">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-zinc-500">{hint}</p>}
      {error && (
        <p className="text-xs text-red-400 flex items-center gap-1">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          {error}
        </p>
      )}
    </div>
  );
}

function IconUpload({
  preview,
  onChange,
}: {
  value: File | null | undefined;
  preview: string | null | undefined;
  onChange: (file: File | null, preview: string | null) => void;
  error?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] || null;
      if (!file) {
        onChange(null, null);
        return;
      }
      if (!VALIDATION.icon.allowedTypes.includes(file.type)) return;
      if (file.size > VALIDATION.icon.maxSize) return;
      try {
        const preview = await downscaleToDataUrl(file);
        onChange(file, preview);
      } catch (err) {
        console.error('icon downscale failed', err);
      }
    },
    [onChange],
  );

  const handleRemove = useCallback(() => {
    onChange(null, null);
    if (inputRef.current) inputRef.current.value = '';
  }, [onChange]);

  return (
    <div className="flex items-center gap-4">
      <div
        className={`w-20 h-20 rounded-xl overflow-hidden flex items-center justify-center ${
          preview ? '' : 'bg-zinc-700 border-2 border-dashed border-zinc-600'
        }`}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Community icon preview" className="w-full h-full object-cover" />
        ) : (
          <svg className="w-8 h-8 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        )}
      </div>
      <div className="space-y-2">
        <input
          ref={inputRef}
          type="file"
          accept={VALIDATION.icon.allowedTypes.join(',')}
          onChange={handleFileChange}
          className="hidden"
          id="icon-upload"
        />
        <label
          htmlFor="icon-upload"
          className="inline-block px-4 py-2 text-sm font-medium text-white bg-zinc-700 hover:bg-zinc-600 rounded-lg cursor-pointer transition-colors"
        >
          {preview ? 'Change icon' : 'Upload icon'}
        </label>
        {preview && (
          <button
            type="button"
            onClick={handleRemove}
            className="block text-sm text-red-400 hover:text-red-300 transition-colors"
          >
            Remove
          </button>
        )}
        <p className="text-xs text-zinc-500">PNG, JPG, GIF, or WebP. Max 2MB.</p>
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-start gap-3 w-full text-left"
    >
      <div
        className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors ${
          checked ? 'bg-gradient-to-r from-zinc-500 to-zinc-400' : 'bg-zinc-700'
        }`}
      >
        <span
          className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </div>
      <div>
        <span className="block text-sm font-medium text-white">{label}</span>
        {description && (
          <span className="block text-xs text-zinc-400 mt-0.5">{description}</span>
        )}
      </div>
    </button>
  );
}

export function CreateCommunityModal({
  isOpen,
  onClose,
  onSubmit,
  onJoin,
  isSubmitting = false,
  error,
}: CreateCommunityModalProps) {
  const [tab, setTab] = useState<ActiveTab>('create');

  // ── Create tab state ──
  const [formData, setFormData] = useState<CreateCommunityFormData>({
    name: '',
    description: '',
    icon: null,
    iconPreview: null,
    isPrivate: false,
    password: '',
  });
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // ── Join tab state ──
  const [inviteCode, setInviteCode] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);

  // Reset everything on open. Caller is expected to remount via `isOpen`.
  useEffect(() => {
    if (isOpen) {
      setTab('create');
      setFormData({
        name: '',
        description: '',
        icon: null,
        iconPreview: null,
        isPrivate: false,
        password: '',
      });
      setValidationErrors({});
      setInviteCode('');
      setJoinPassword('');
      setJoinError(null);
      setIsJoining(false);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSubmitting && !isJoining) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, isJoining, onClose]);

  // ── Create handlers ──
  const validate = useCallback((): boolean => {
    const errors: Record<string, string> = {};
    const result = createCommunityFormSchema.safeParse({
      name: formData.name,
      description: formData.description || undefined,
      isPrivate: formData.isPrivate,
    });
    if (!result.success) {
      result.error.errors.forEach((err) => {
        const field = err.path[0] as string;
        errors[field] = err.message;
      });
    }
    if (formData.isPrivate) {
      const p = formData.password;
      if (p.length < 4) errors.password = 'Password must be at least 4 characters';
      else if (p.length > 128) errors.password = 'Password must be 128 characters or fewer';
    }
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }, [formData]);

  const handleCreateSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!validate() || isSubmitting) return;
      await onSubmit(formData);
    },
    [formData, validate, isSubmitting, onSubmit],
  );

  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, name: e.target.value }));
    setValidationErrors((prev) => ({ ...prev, name: '' }));
  }, []);
  const handleDescriptionChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setFormData((prev) => ({ ...prev, description: e.target.value }));
    setValidationErrors((prev) => ({ ...prev, description: '' }));
  }, []);
  const handleIconChange = useCallback((file: File | null, preview: string | null) => {
    setFormData((prev) => ({ ...prev, icon: file, iconPreview: preview }));
  }, []);
  const handlePrivateChange = useCallback((checked: boolean) => {
    setFormData((prev) => ({ ...prev, isPrivate: checked, password: checked ? prev.password : '' }));
    setValidationErrors((prev) => ({ ...prev, password: '' }));
  }, []);
  const handlePasswordChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, password: e.target.value }));
    setValidationErrors((prev) => ({ ...prev, password: '' }));
  }, []);

  // ── Join handlers ──
  const handleJoinSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!onJoin || isJoining) return;
      const code = inviteCode.trim();
      if (!code) {
        setJoinError('Paste an invite code');
        return;
      }
      setIsJoining(true);
      setJoinError(null);
      const result = await onJoin({ inviteCode: code, password: joinPassword });
      if (result !== null) {
        setJoinError(result);
        setIsJoining(false);
      }
      // On success, caller closes the modal — no need to flip isJoining.
    },
    [inviteCode, joinPassword, onJoin, isJoining],
  );

  const backdrop = useBackdropClose(onClose, isOpen && !isSubmitting && !isJoining);

  if (!isOpen) return null;

  return (
    <Backdrop handlers={backdrop}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-gradient-to-br from-zinc-950 via-zinc-900 to-black rounded-xl shadow-2xl border border-zinc-800/50"
      >
        {/* Header with tabs */}
        <div className="sticky top-0 z-10 bg-gradient-to-r from-black/90 to-zinc-900/90 backdrop-blur-sm border-b border-zinc-800/50">
          <div className="flex items-center justify-between px-6 py-3">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setTab('create')}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  tab === 'create'
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Create new
              </button>
              <button
                onClick={() => setTab('join')}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  tab === 'join'
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Join with code
              </button>
            </div>
            <button
              onClick={onClose}
              disabled={isSubmitting || isJoining}
              className="p-2 text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {tab === 'create' ? (
          <form onSubmit={handleCreateSubmit} className="p-6 space-y-6">
            {error && (
              <div className="p-4 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-400">
                {error}
              </div>
            )}

            <FormField label="Community Icon">
              <IconUpload
                value={formData.icon}
                preview={formData.iconPreview}
                onChange={handleIconChange}
              />
            </FormField>

            <FormField
              label="Community Name"
              required
              error={validationErrors.name}
              hint={`${formData.name.length}/50 characters`}
            >
              <input
                type="text"
                value={formData.name}
                onChange={handleNameChange}
                placeholder="Enter community name"
                maxLength={50}
                className={`w-full px-4 py-2 bg-zinc-900/80 border rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 transition-colors ${
                  validationErrors.name
                    ? 'border-red-500 focus:ring-red-500'
                    : 'border-zinc-700 focus:ring-zinc-500 focus:border-zinc-500'
                }`}
              />
            </FormField>

            <FormField
              label="Description"
              error={validationErrors.description}
              hint={`${formData.description.length}/500 characters`}
            >
              <textarea
                value={formData.description}
                onChange={handleDescriptionChange}
                placeholder="What is your community about?"
                rows={3}
                maxLength={500}
                className={`w-full px-4 py-2 bg-zinc-900/80 border rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 resize-none transition-colors ${
                  validationErrors.description
                    ? 'border-red-500 focus:ring-red-500'
                    : 'border-zinc-700 focus:ring-zinc-500 focus:border-zinc-500'
                }`}
              />
            </FormField>

            <div className="pt-2">
              <Toggle
                checked={formData.isPrivate}
                onChange={handlePrivateChange}
                label="Private Community"
                description="Anyone joining must enter the password below. Hashed with scrypt — no recovery."
              />
            </div>

            {formData.isPrivate && (
              <FormField
                label="Community Password"
                required
                error={validationErrors.password}
                hint="Share this out-of-band (signal, in person). Anyone with it can join."
              >
                <input
                  type="password"
                  value={formData.password}
                  onChange={handlePasswordChange}
                  autoComplete="new-password"
                  placeholder="4–128 characters"
                  className={`w-full px-4 py-2 bg-zinc-900/80 border rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 transition-colors ${
                    validationErrors.password
                      ? 'border-red-500 focus:ring-red-500'
                      : 'border-zinc-700 focus:ring-zinc-500 focus:border-zinc-500'
                  }`}
                />
              </FormField>
            )}

            <div className="pt-4">
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 px-4 bg-gradient-to-r from-zinc-700 via-zinc-600 to-zinc-500 hover:from-zinc-600 hover:via-zinc-500 hover:to-zinc-400 disabled:opacity-50 text-white font-medium rounded-lg transition-all border border-zinc-500/30 shadow-lg"
              >
                {isSubmitting ? 'Creating…' : 'Create Community'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleJoinSubmit} className="p-6 space-y-6">
            <p className="text-sm text-zinc-400">
              Paste the invite code someone shared with you. If the community is private,
              you&apos;ll also need its password.
            </p>

            <FormField label="Invite code" required>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => {
                  setInviteCode(e.target.value);
                  setJoinError(null);
                }}
                placeholder="Paste the code here"
                autoComplete="off"
                spellCheck={false}
                className="w-full px-4 py-2 bg-zinc-900/80 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 font-mono focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:border-zinc-500 transition-colors"
              />
            </FormField>

            <FormField label="Password (if private)" hint="Leave blank if the community is public.">
              <input
                type="password"
                value={joinPassword}
                onChange={(e) => {
                  setJoinPassword(e.target.value);
                  setJoinError(null);
                }}
                autoComplete="off"
                placeholder="Password"
                className="w-full px-4 py-2 bg-zinc-900/80 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:border-zinc-500 transition-colors"
              />
            </FormField>

            {joinError && (
              <div className="p-3 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-400">
                {joinError}
              </div>
            )}

            <div className="pt-2">
              <button
                type="submit"
                disabled={isJoining || !inviteCode.trim()}
                className="w-full py-3 px-4 bg-gradient-to-r from-zinc-700 via-zinc-600 to-zinc-500 hover:from-zinc-600 hover:via-zinc-500 hover:to-zinc-400 disabled:opacity-50 text-white font-medium rounded-lg transition-all border border-zinc-500/30 shadow-lg"
              >
                {isJoining ? 'Joining…' : 'Join Community'}
              </button>
            </div>
          </form>
        )}
      </div>
    </Backdrop>
  );
}

export default CreateCommunityModal;
