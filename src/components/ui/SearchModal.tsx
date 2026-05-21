'use client';

/**
 * SearchModal — STUB for the ephemeral pivot.
 *
 * The search endpoint (/api/search) has been deleted along with the user
 * table. Returns null until search is reimplemented against the
 * community/channel directory.
 */

import type {
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
}

export function SearchModal(_props: SearchModalProps): null {
  return null;
}

export default SearchModal;
