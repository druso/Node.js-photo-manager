import React from 'react';
import { variantPresets, getPositionClasses } from './toastPresets';

export default function ToastContainer({ toasts, position, topOffset = 0, bottomOffset = 0, onClose, onPause, onResume }) {
  const pos = getPositionClasses(position);
  const isBottom = position.startsWith('bottom');
  const containerStyle = isBottom
    ? { bottom: Math.max(0, bottomOffset) + 8 }
    : { top: Math.max(0, topOffset) + 8 };
  return (
    <div className={`pointer-events-none fixed z-50 ${pos} space-y-2`}
         style={containerStyle}
         aria-live="polite"
         aria-atomic="false">
      {toasts.map(t => {
        const preset = variantPresets[t.variant] || variantPresets.notification;
        const inClass = position.endsWith('right') ? 'animate-toastInRight' : 'animate-toastInLeft';
        const outClass = 'animate-toastOutUp';
        return (
          <div key={t.id}
               role={preset.ariaRole}
               aria-live={preset.ariaLive}
               className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm shadow-lg ${preset.borderClass} ${preset.containerClass} ${t._leaving ? outClass : inClass} transition-opacity pointer-events-auto`}
               onMouseEnter={() => onPause && onPause(t.id)}
               onMouseLeave={() => onResume && onResume(t.id)}
          >
            {t.emoji ? <span className="text-lg leading-none select-none">{t.emoji}</span> : null}
            <div className="whitespace-pre-wrap flex-1">{t.message}</div>
            <button
              aria-label="Close"
              className="ml-2 text-white/70 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/60 rounded"
              onClick={(e) => { e.stopPropagation(); onClose && onClose(t.id); }}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
