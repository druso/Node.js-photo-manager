import { useCallback, useState } from 'react';
import { dryRunPhotosVisibility, updatePhotosVisibility } from '../api/photosApi';
import { useToast } from '../ui/toast/ToastContext';

/**
 * Bulk visibility mutation hook with dry-run support.
 */
export default function useVisibilityMutation({ onMutate, onSettled } = {}) {
  const toast = useToast();
  const [state, setState] = useState({ status: 'idle', lastPreview: null, error: null });

  const reset = useCallback(() => {
    setState({ status: 'idle', lastPreview: null, error: null });
  }, []);

  const buildPayload = useCallback((items, visibility) => {
    return items
      .filter((item) => Number.isFinite(item?.id))
      .map((item) => ({ photo_id: Number(item.id), visibility }));
  }, []);

  const preview = useCallback(async (items, visibility) => {
    const payload = buildPayload(items, visibility);
    if (!payload.length) {
      const err = new Error('No valid photo IDs supplied');
      toast?.show?.({
        emoji: '⚠️',
        message: 'Select photos with known IDs to preview visibility changes.',
        variant: 'warning',
      });
      throw err;
    }

    setState((prev) => ({ ...prev, status: 'previewing', error: null }));
    try {
      const res = await dryRunPhotosVisibility(payload);
      const perItem = Array.isArray(res?.dry_run?.per_item) ? res.dry_run.per_item : [];
      const changedIdSet = new Set(perItem.map((entry) => entry.photo_id));
      const changedItems = items
        .filter((item) => changedIdSet.has(item.id))
        .map((item) => ({ ...item, visibility }));
      setState({ status: 'previewed', lastPreview: res, error: null });
      return { raw: res, changedItems, visibility };
    } catch (err) {
      const message = err?.message || 'Visibility preview failed';
      setState({ status: 'error', lastPreview: null, error: message });
      toast?.show?.({ emoji: '⚠️', message, variant: 'error' });
      throw err;
    }
  }, [buildPayload, toast]);

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
      setState({ status: 'success', lastPreview: null, error: null });
      onSettled?.(result);
      toast?.show?.({
        emoji: '✅',
        message: `Visibility set to ${visibility} for ${res?.updated ?? changedItems.length} photo(s).`,
        variant: 'success',
      });
      return result;
    } catch (err) {
      const message = err?.message || 'Failed to update visibility';
      setState({ status: 'error', lastPreview: null, error: message });
      toast?.show?.({ emoji: '⚠️', message, variant: 'error' });
      throw err;
    }
  }, [buildPayload, onMutate, onSettled, toast]);

  return {
    state,
    preview,
    apply,
    reset,
  };
}
