import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X,
  Search,
  User,
  Users,
  Hash,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { Avatar } from './Avatar';
import type {
  SearchResult,
  SearchResultType,
  SearchUserResult,
  SearchCommunityResult,
  SearchChannelResult,
} from '@/types/api';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectUser?: (result: SearchUserResult) => void;
  onSelectCommunity?: (result: SearchCommunityResult) => void;
  onSelectChannel?: (result: SearchChannelResult) => void;
  authToken?: string;
  defaultTypes?: SearchResultType[];
  communityId?: string;
}

function debounce<T extends (...args: Parameters<T>) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export function SearchModal({
  isOpen,
  onClose,
  onSelectUser,
  onSelectCommunity,
  onSelectChannel,
  authToken,
  defaultTypes = ['user', 'community', 'channel'],
  communityId,
}: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<SearchResultType[]>(defaultTypes);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Clear state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setResults([]);
      setError(null);
    }
  }, [isOpen]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
      // Cmd/Ctrl + K to open search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (!isOpen) {
          // Would need to lift this up
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const performSearch = useCallback(async (searchQuery: string) => {
    if (!authToken || searchQuery.length < 2) {
      setResults([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        q: searchQuery,
        types: selectedTypes.join(','),
        limit: '15',
      });

      if (communityId) {
        params.set('communityId', communityId);
      }

      const response = await fetch(`/api/search?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Search failed');
      }

      const data = await response.json();
      setResults(data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [authToken, selectedTypes, communityId]);

  // Debounced search
  const debouncedSearch = useCallback(
    debounce((q: string) => performSearch(q), 300),
    [performSearch]
  );

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    debouncedSearch(value);
  };

  const handleTypeToggle = (type: SearchResultType) => {
    setSelectedTypes((prev) => {
      if (prev.includes(type)) {
        // Don't allow removing all types
        if (prev.length === 1) return prev;
        return prev.filter((t) => t !== type);
      }
      return [...prev, type];
    });
  };

  const handleResultClick = (result: SearchResult) => {
    switch (result.type) {
      case 'user':
        onSelectUser?.(result);
        break;
      case 'community':
        onSelectCommunity?.(result);
        break;
      case 'channel':
        onSelectChannel?.(result);
        break;
    }
    onClose();
  };

  const renderResult = (result: SearchResult) => {
    switch (result.type) {
      case 'user':
        return (
          <div className="flex items-center gap-3">
            <Avatar
              publicId={result.publicId}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-[var(--text-primary)] truncate">
                {result.publicId.slice(0, 8)}...{result.publicId.slice(-6)}
              </div>
            </div>
            <User size={16} className="text-[var(--text-muted)] flex-shrink-0" />
          </div>
        );

      case 'community':
        return (
          <div className="flex items-center gap-3">
            {result.avatar ? (
              <img
                src={result.avatar}
                alt={result.name}
                className="w-9 h-9 rounded-full object-cover"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-[var(--discord-darker)] flex items-center justify-center">
                <Users size={16} className="text-[var(--text-muted)]" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="font-medium text-[var(--text-primary)] truncate">
                {result.name}
              </div>
              <div className="text-xs text-[var(--text-muted)]">
                {result.memberCount} member{result.memberCount !== 1 ? 's' : ''}
                {result.isPublic ? '' : ' - Private'}
              </div>
            </div>
            <Users size={16} className="text-[var(--text-muted)] flex-shrink-0" />
          </div>
        );

      case 'channel':
        return (
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[var(--discord-darker)] flex items-center justify-center">
              <Hash size={16} className="text-[var(--text-muted)]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-[var(--text-primary)] truncate">
                #{result.name}
              </div>
              <div className="text-xs text-[var(--text-muted)] truncate">
                {result.communityName}
              </div>
            </div>
            <Hash size={16} className="text-[var(--text-muted)] flex-shrink-0" />
          </div>
        );

      default:
        return null;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg mx-4 bg-[var(--discord-darker)] rounded-lg shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--discord-dark)]">
          <Search size={20} className="text-[var(--text-muted)] flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleQueryChange}
            placeholder="Search users, communities, channels..."
            className="flex-1 bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none text-base"
          />
          {loading && (
            <Loader2 size={18} className="text-[var(--text-muted)] animate-spin" />
          )}
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--discord-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Type filters */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--discord-dark)]">
          {[
            { type: 'user' as const, icon: User, label: 'Users' },
            { type: 'community' as const, icon: Users, label: 'Communities' },
            { type: 'channel' as const, icon: Hash, label: 'Channels' },
          ].map(({ type, icon: Icon, label }) => (
            <button
              key={type}
              onClick={() => handleTypeToggle(type)}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full transition-colors ${
                selectedTypes.includes(type)
                  ? 'bg-[var(--accent-primary)] text-white'
                  : 'bg-[var(--discord-dark)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon size={12} />
              {label}
            </button>
          ))}
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {error ? (
            <div className="flex flex-col items-center justify-center py-8 text-center px-4">
              <AlertTriangle size={24} className="text-[var(--accent-danger)] mb-2" />
              <p className="text-sm text-[var(--text-muted)]">{error}</p>
            </div>
          ) : query.length > 0 && query.length < 2 ? (
            <div className="flex items-center justify-center py-8">
              <p className="text-sm text-[var(--text-muted)]">Type at least 2 characters...</p>
            </div>
          ) : results.length === 0 && query.length >= 2 && !loading ? (
            <div className="flex flex-col items-center justify-center py-8 text-center px-4">
              <Search size={24} className="text-[var(--text-muted)] mb-2" />
              <p className="text-sm text-[var(--text-muted)]">No results found for &quot;{query}&quot;</p>
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center px-4">
              <Search size={24} className="text-[var(--text-muted)] mb-2" />
              <p className="text-sm text-[var(--text-muted)]">Start typing to search...</p>
            </div>
          ) : (
            <ul>
              {results.map((result) => (
                <li key={`${result.type}-${result.id}`}>
                  <button
                    onClick={() => handleResultClick(result)}
                    className="w-full px-4 py-3 text-left hover:bg-[var(--discord-hover)] transition-colors"
                  >
                    {renderResult(result)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-[var(--discord-dark)] flex items-center justify-between text-xs text-[var(--text-muted)]">
          <span>Press ESC to close</span>
          <span>Cmd + K to search</span>
        </div>
      </div>
    </div>
  );
}

export default SearchModal;
