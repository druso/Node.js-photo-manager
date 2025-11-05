import { useCallback, useState } from 'react';
import { updatePhotosVisibility } from '../api/photosApi';
import { useToast } from '../ui/toast/ToastContext';

/**
 * Bulk visibility mutation hook.
 */
export default function useVisibilityMutation({ onMutate, onSettled } = {}) {
  const toast = useToast();
  const [state, setState] = useState({ status: 'idle', error: null });

  const reset = useCallback(() => {
    setState({ status: 'idle', error: null });
  }, []);

  const buildPayload = useCallback((items, visibility) => {
    return items
      .filter((item) => Number.isFinite(item?.id))
      .map((item) => ({ photo_id: Number(item.id), visibility }));
  }, []);

  const apply = useCallback(async (items, visibility) => {
    const payload = buildPayload(items, visibility);
    if (!payload.length) {
      const err = new Error('No valid photo IDs supplied');
      toast?.show?.({
        emoji: '⚠️',
        message: 'Select photos with known IDs before applying visibility changes.',
        variant: 'warning',
      });
      throw err;
    }

    setState((prev) => ({ ...prev, status: 'applying', error: null }));
    try {
      onMutate?.();
      const res = await updatePhotosVisibility(payload);
      const changedItems = items
        .filter((item) => (item.visibility || 'private') !== visibility)
        .map((item) => ({ ...item, visibility }));
      const result = { raw: res, changedItems, visibility };
      setState({ status: 'success', error: null });
      onSettled?.(result);
      toast?.show?.({
        emoji: '✅',
        message: `Visibility set to ${visibility} for ${res?.updated ?? changedItems.length} photo(s).`,
        variant: 'success',
      });
      return result;
    } catch (err) {
      const message = err?.message || 'Failed to update visibility';
      setState({ status: 'error', error: message });
      toast?.show?.({ emoji: '⚠️', message, variant: 'error' });
      throw err;
    }
  }, [buildPayload, onMutate, onSettled, toast]);

  return {
    state,
    apply,
    reset,
  };
}
