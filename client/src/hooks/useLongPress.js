import { useRef, useCallback } from 'react';

/**
 * useLongPress - Detect long-press gestures on touch and pointer devices
 * 
 * @param {Function} onLongPress - Callback fired when long-press is detected
 * @param {Object} options - Configuration options
 * @param {number} options.threshold - Time in ms to trigger long-press (default: 400)
 * @param {Function} options.onStart - Optional callback when press starts
 * @param {Function} options.onFinish - Optional callback when press ends (before threshold)
 * @param {Function} options.onCancel - Optional callback when press is canceled
 * 
 * @returns {Object} Event handlers to spread on target element
 * 
 * @example
 * const longPressHandlers = useLongPress(() => {
 *   console.log('Long press detected!');
 * }, { threshold: 350 });
 * 
 * return <div {...longPressHandlers}>Press and hold me</div>;
 */
export function useLongPress(
  onLongPress,
  {
    threshold = 400,
    onStart = null,
    onFinish = null,
    onCancel = null,
  } = {}
) {
  const timerRef = useRef(null);
  const isLongPressRef = useRef(false);
  const startPosRef = useRef({ x: 0, y: 0 });

  // Clear any active timer
  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Start the long-press timer
  const start = useCallback((event) => {
    // Prevent default to avoid text selection on long-press
    if (event.type === 'touchstart') {
      event.preventDefault();
    }

    // Store starting position to detect movement
    const touch = event.touches ? event.touches[0] : event;
    startPosRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    };

    isLongPressRef.current = false;

    // Call onStart callback if provided
    if (onStart) {
      onStart(event);
    }

    // Set timer to trigger long-press
    clearTimer();
    timerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      if (onLongPress) {
        onLongPress(event);
      }
    }, threshold);
  }, [onLongPress, threshold, onStart, clearTimer]);

  // Cancel the long-press (movement detected)
  const cancel = useCallback((event) => {
    // Check if finger/pointer moved significantly (>10px)
    const touch = event.touches ? event.touches[0] : event;
    if (touch) {
      const deltaX = Math.abs(touch.clientX - startPosRef.current.x);
      const deltaY = Math.abs(touch.clientY - startPosRef.current.y);
      
      // If moved more than 10px, cancel the long-press
      if (deltaX > 10 || deltaY > 10) {
        clearTimer();
        if (onCancel) {
          onCancel(event);
        }
      }
    }
  }, [clearTimer, onCancel]);

  // End the press
  const end = useCallback((event) => {
    clearTimer();
    
    // If long-press was triggered, don't call onFinish
    if (isLongPressRef.current) {
      isLongPressRef.current = false;
      return;
    }

    // Call onFinish for short press
    if (onFinish) {
      onFinish(event);
    }
  }, [clearTimer, onFinish]);

  // Return event handlers
  return {
    onMouseDown: start,
    onMouseUp: end,
    onMouseLeave: end,
    onTouchStart: start,
    onTouchMove: cancel,
    onTouchEnd: end,
    onTouchCancel: end,
  };
}

export default useLongPress;
