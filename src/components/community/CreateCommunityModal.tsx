'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { z } from 'zod';

const createCommunityFormSchema = z.object({
  name: z.string().min(2).max(64).regex(/^[a-zA-Z0-9 _-]+$/),
  description: z.string().max(500).optional(),
  isPrivate: z.boolean().optional(),
});

export interface CreateCommunityFormData {
  name: string;
  description: string;
  icon?: File | null;
  iconPreview?: string | null;
  isPrivate: boolean;
}

export interface CreateCommunityModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateCommunityFormData) => Promise<void>;
  isSubmitting?: boolean;
  error?: string | null;
}

const VALIDATION = {
  icon: {
    maxSize: 2 * 1024 * 1024,
    allowedTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
  },
};

/**
 * Modal backdrop component
 */
function Backdrop({
  onClick,
  children,
}: {
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClick}
    >
      {children}
    </div>
  );
}

/**
 * Form field wrapper
 */
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
      {hint && !error && (
        <p className="text-xs text-zinc-500">{hint}</p>
      )}
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

/**
 * Icon upload component
 */
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
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] || null;

      if (file) {
        // Validate file
        if (!VALIDATION.icon.allowedTypes.includes(file.type)) {
          return;
        }
        if (file.size > VALIDATION.icon.maxSize) {
          return;
        }

        // Create preview
        const reader = new FileReader();
        reader.onloadend = () => {
          onChange(file, reader.result as string);
        };
        reader.readAsDataURL(file);
      } else {
        onChange(null, null);
      }
    },
    [onChange]
  );

  const handleRemove = useCallback(() => {
    onChange(null, null);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  }, [onChange]);

  return (
    <div className="flex items-center gap-4">
      {/* Preview/Placeholder */}
      <div
        className={`w-20 h-20 rounded-xl overflow-hidden flex items-center justify-center ${
          preview ? '' : 'bg-zinc-700 border-2 border-dashed border-zinc-600'
        }`}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="Community icon preview"
            className="w-full h-full object-cover"
          />
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

      {/* Upload/Remove buttons */}
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
        <p className="text-xs text-zinc-500">
          PNG, JPG, GIF, or WebP. Max 2MB.
        </p>
      </div>
    </div>
  );
}

/**
 * Toggle switch component
 */
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

/**
 * Create community modal component for Void Chat
 *
 * Features:
 * - Community name input with validation
 * - Description textarea
 * - Icon upload with preview
 * - Public/private toggle
 * - Form validation
 * - Loading state
 * - Error display
 */
export function CreateCommunityModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting = false,
  error,
}: CreateCommunityModalProps) {
  const [formData, setFormData] = useState<CreateCommunityFormData>({
    name: '',
    description: '',
    icon: null,
    iconPreview: null,
    isPrivate: false,
  });

  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const modalRef = useRef<HTMLDivElement>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setFormData({
        name: '',
        description: '',
        icon: null,
        iconPreview: null,
        isPrivate: false,
      });
      setValidationErrors({});
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSubmitting) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  // Validate form
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

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }, [formData]);

  // Handle form submission
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!validate()) return;
      if (isSubmitting) return;

      await onSubmit(formData);
    },
    [formData, validate, isSubmitting, onSubmit]
  );

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && !isSubmitting) {
        onClose();
      }
    },
    [isSubmitting, onClose]
  );

  // Handle input changes
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
    setFormData((prev) => ({ ...prev, isPrivate: checked }));
  }, []);

  if (!isOpen) return null;

  return (
    <Backdrop onClick={handleBackdropClick}>
      <div
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-gradient-to-br from-zinc-950 via-zinc-900 to-black rounded-xl shadow-2xl border border-zinc-800/50"
      >
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between px-6 py-4 border-b border-zinc-800/50 bg-gradient-to-r from-black/80 to-zinc-900/80 backdrop-blur-sm">
          <h2 className="text-xl font-semibold text-white">Create Community</h2>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-2 text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Error banner */}
          {error && (
            <div className="p-4 bg-red-900/30 border border-red-800 rounded-lg">
              <div className="flex items-center gap-2 text-red-400">
                <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-sm">{error}</span>
              </div>
            </div>
          )}

          {/* Icon upload */}
          <FormField label="Community Icon">
            <IconUpload
              value={formData.icon}
              preview={formData.iconPreview}
              onChange={handleIconChange}
            />
          </FormField>

          {/* Name input */}
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

          {/* Description textarea */}
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

          {/* Private toggle */}
          <div className="pt-2">
            <Toggle
              checked={formData.isPrivate}
              onChange={handlePrivateChange}
              label="Private Community"
              description="Only users with an invite can join."
            />
          </div>

          {/* Submit button */}
          <div className="pt-4">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 px-4 bg-gradient-to-r from-zinc-700 via-zinc-600 to-zinc-500 hover:from-zinc-600 hover:via-zinc-500 hover:to-zinc-400 disabled:opacity-50 text-white font-medium rounded-lg transition-all flex items-center justify-center gap-2 border border-zinc-500/30 shadow-lg"
            >
              {isSubmitting ? (
                <>
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
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
                </>
              ) : (
                'Create Community'
              )}
            </button>
          </div>
        </form>
      </div>
    </Backdrop>
  );
}

export default CreateCommunityModal;
