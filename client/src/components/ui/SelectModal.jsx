import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function SelectModal({ title, options, value, onSelect, onClose }) {
  const panelRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const modalUi = (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-3">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" onMouseDown={() => onClose?.()}></div>
      {/* Panel */}
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={title} className="relative bg-white border border-gray-200 shadow-lg w-[92vw] sm:w-full h-auto max-h-[90vh] sm:h-auto rounded-md sm:rounded-md sm:max-w-[520px] overflow-hidden animate-fadeInScale flex flex-col">
        <div className="sticky top-0 z-10 bg-white border-b p-3">
          <div className="text-sm font-medium text-gray-800">{title}</div>
        </div>
        <div className="p-3 overflow-auto">
          <div className="flex flex-col">
            {options.map((opt) => {
              const selected = String(opt.value) === String(value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { onSelect?.(opt.value); onClose?.(); }}
                  className={`flex items-center justify-between text-left px-3 py-3 text-base sm:text-sm rounded-md border transition-colors mb-2 ${selected ? 'border-blue-400 bg-blue-50' : 'border-transparent hover:bg-gray-50'}`}
                >
                  <span className="text-gray-800">{opt.label}</span>
                  {selected && (
                    <svg className="h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

  // Render outside any parent stacking context to body
  return createPortal(modalUi, document.body);
}
