'use client';

import { useCallback, useRef } from 'react';

/**
 * Returns `{onMouseDown, onClick}` to spread onto a modal backdrop element.
 * Only closes when BOTH the mousedown AND the click landed on the backdrop
 * itself — prevents the common React-modal bug where dragging to select
 * text inside the modal and releasing the mouse over the backdrop fires
 * the click handler and dismisses the modal mid-selection.
 */
export function useBackdropClose(onClose: () => void, enabled = true) {
  const downOnBackdrop = useRef(false);
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    downOnBackdrop.current = e.target === e.currentTarget;
  }, []);
  const onClick = useCallback(
    (e: React.MouseEvent) => {
      if (enabled && e.target === e.currentTarget && downOnBackdrop.current) {
        onClose();
      }
    },
    [enabled, onClose],
  );
  return { onMouseDown, onClick };
}
