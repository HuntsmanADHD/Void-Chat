'use client';

import React, { useState, useCallback } from 'react';
import { X, Hash } from 'lucide-react';

export interface CreateChannelFormData {
  name: string;
  description: string;
}

export interface CreateChannelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateChannelFormData) => void;
  isSubmitting?: boolean;
  error?: string | null;
}

/**
 * Modal for creating a new text channel
 * Void aesthetic styling
 */
export function CreateChannelModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting = false,
  error = null,
}: CreateChannelModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setValidationError(null);

      // Validate name
      const trimmedName = name.trim().toLowerCase();
      if (!trimmedName) {
        setValidationError('Channel name is required');
        return;
      }

      // Validate format (lowercase, alphanumeric, hyphens)
      const channelNameRegex = /^[a-z0-9-]{1,50}$/;
      if (!channelNameRegex.test(trimmedName)) {
        setValidationError(
          'Channel name must be 1-50 characters, lowercase letters, numbers, and hyphens only'
        );
        return;
      }

      onSubmit({
        name: trimmedName,
        description: description.trim(),
      });
    },
    [name, description, onSubmit]
  );

  const handleClose = useCallback(() => {
    setName('');
    setDescription('');
    setValidationError(null);
    onClose();
  }, [onClose]);

  // Handle name input - auto-format to channel name style
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Replace spaces with hyphens, remove invalid characters
    const value = e.target.value
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    setName(value);
    setValidationError(null);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-950 rounded-xl shadow-2xl border border-zinc-800/50">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800/50">
          <h2 className="text-xl font-semibold text-zinc-100">Create Text Channel</h2>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Channel name */}
          <div>
            <label
              htmlFor="channel-name"
              className="block text-sm font-medium text-zinc-300 mb-2"
            >
              Channel Name
            </label>
            <div className="relative">
              <Hash
                size={18}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
              />
              <input
                id="channel-name"
                type="text"
                value={name}
                onChange={handleNameChange}
                placeholder="new-channel"
                maxLength={50}
                className="w-full pl-10 pr-4 py-2.5 bg-zinc-950 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 transition-colors"
                disabled={isSubmitting}
                autoFocus
              />
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Lowercase letters, numbers, and hyphens only
            </p>
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="channel-description"
              className="block text-sm font-medium text-zinc-300 mb-2"
            >
              Description{' '}
              <span className="text-zinc-500 font-normal">(optional)</span>
            </label>
            <input
              id="channel-description"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this channel about?"
              maxLength={200}
              className="w-full px-4 py-2.5 bg-zinc-950 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 transition-colors"
              disabled={isSubmitting}
            />
          </div>

          {/* Error message */}
          {(validationError || error) && (
            <div className="p-3 bg-red-900/20 border border-red-800/50 rounded-lg">
              <p className="text-sm text-red-400">{validationError || error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="flex-1 py-2.5 px-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium rounded-lg transition-colors border border-zinc-700/50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="flex-1 py-2.5 px-4 bg-gradient-to-r from-zinc-700 via-zinc-600 to-zinc-500 hover:from-zinc-600 hover:via-zinc-500 hover:to-zinc-400 text-white font-medium rounded-lg transition-all border border-zinc-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <svg
                    className="w-4 h-4 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Creating...
                </span>
              ) : (
                'Create Channel'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CreateChannelModal;
