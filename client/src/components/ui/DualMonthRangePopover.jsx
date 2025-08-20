import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function DualMonthRangePopover({
  value, // { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }
  onChange,
  onClose,
  availableDates = [],
}) {
  const popRef = useRef(null);
  const [baseMonth, setBaseMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  const monthNames = useMemo(() => ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], []);
  const availableSet = useMemo(() => new Set(availableDates || []), [availableDates]);
  const weekdays = ['Mo','Tu','We','Th','Fr','Sa','Su'];
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const toISO = (d) => d.toISOString().slice(0, 10);
  const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
  const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
  const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

  const buildWeeks = (monthDate) => {
    const first = startOfMonth(monthDate);
    const last = endOfMonth(monthDate);
    const weeks = [];
    const startOffset = (first.getDay() + 6) % 7; // Monday=0
    let cur = new Date(first);
    cur.setDate(first.getDate() - startOffset);
    while (true) {
      const w = [];
      for (let i = 0; i < 7; i++) { w.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
      weeks.push(w);
      if (w[6] >= last && cur.getDate() <= 7) break;
      if (weeks.length > 6) break;
    }
    return weeks;
  };

  const inRange = (d) => {
    const { start, end } = value || {}; if (!start || !end) return false; const x = toISO(d); return x >= start && x <= end;
  };
  const isStart = (d) => value?.start && toISO(d) === value.start;
  const isEnd = (d) => value?.end && toISO(d) === value.end;

  const onDayClick = (d) => {
    const iso = toISO(d);
    const { start, end } = value || {};
    if (!start || (start && end)) { onChange({ start: iso, end: '' }); return; }
    if (iso < start) onChange({ start: iso, end: start }); else onChange({ start, end: iso });
  };

  // Close on outside / Esc
  useEffect(() => {
    const onDoc = (e) => { if (popRef.current && !popRef.current.contains(e.target)) onClose?.(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const left = baseMonth;
  const right = addMonths(baseMonth, 1);
  const leftWeeks = buildWeeks(left);
  const rightWeeks = buildWeeks(right);

  const presets = [
    {
      label: 'Today',
      run: () => { const t = new Date(); const v = toISO(t); onChange({ start: v, end: v }); onClose?.(); },
    },
    {
      label: 'Last 7 days',
      run: () => { const end = new Date(); const start = new Date(); start.setDate(start.getDate() - 7); onChange({ start: toISO(start), end: toISO(end) }); onClose?.(); },
    },
    {
      label: 'This month',
      run: () => { const now = new Date(); const s = new Date(now.getFullYear(), now.getMonth(), 1); const e = new Date(now.getFullYear(), now.getMonth()+1, 0); onChange({ start: toISO(s), end: toISO(e) }); onClose?.(); },
    },
  ];

  const modalUi = (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center p-0 sm:p-3">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" onMouseDown={() => onClose?.()}></div>
      {/* Panel */}
      <div ref={popRef} role="dialog" aria-modal="true" aria-label="Select date range" className="relative bg-white border border-gray-200 shadow-lg w-full h-full sm:h-auto sm:p-3 p-4 sm:rounded-md rounded-none sm:max-w-[900px] sm:max-h-[90vh] overflow-auto animate-fadeInScale">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Presets */}
        <div className="col-span-1 sm:border-r sm:pr-3 border-b sm:border-b-0 pb-3 sm:pb-0">
          <div className="text-xs font-semibold text-gray-500 mb-2">Quick select</div>
          <div className="flex flex-wrap gap-2">
            {presets.map((p, i) => (
              <button
                key={i}
                type="button"
                onClick={p.run}
                className="inline-flex items-center px-3 py-1.5 text-sm rounded-full border border-gray-300 hover:bg-gray-50"
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onChange({ start: '', end: '' })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full border border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400"
            >
              Clear dates
            </button>
          </div>
        </div>
        {/* Calendars */}
        <div className="col-span-1 sm:col-span-2">
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => setBaseMonth(addMonths(baseMonth, -1))} className="px-2 py-1 text-sm rounded-md border border-gray-300 hover:bg-gray-50">◀</button>
            <div className="text-sm font-medium text-gray-700">{monthNames[left.getMonth()]} {left.getFullYear()} · {monthNames[right.getMonth()]} {right.getFullYear()}</div>
            <button type="button" onClick={() => setBaseMonth(addMonths(baseMonth, 1))} className="px-2 py-1 text-sm rounded-md border border-gray-300 hover:bg-gray-50">▶</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[{weeks:leftWeeks, m:left}, {weeks:rightWeeks, m:right}].map((cal, idx) => (
              <div
                key={idx}
                className={idx === 1 ? 'border-t-0 pt-4 sm:border-t-0 sm:pt-0 sm:border-l sm:pl-4' : ''}
              >
                <div className="grid grid-cols-7 text-xs sm:text-[11px] text-gray-500 mb-1">{weekdays.map((w) => <div key={w} className="text-center">{w}</div>)}</div>
                <div className="grid grid-cols-7 gap-2 sm:gap-1">
                  {cal.weeks.flat().map((d, i2) => {
                    const inMonth = d.getMonth() === cal.m.getMonth();
                    const sel = inRange(d);
                    const start = isStart(d);
                    const end = isEnd(d);
                    const iso = toISO(d);
                    const isAvailable = inMonth && availableSet.has(iso);
                    const isToday = iso === todayIso;
                    const cls = [
                      'text-base sm:text-sm px-2 py-2 sm:px-1.5 sm:py-1 rounded-md text-center',
                      inMonth ? 'text-gray-800' : 'text-gray-300',
                      // Selection styles take precedence
                      sel ? 'bg-blue-100' : '',
                      start || end ? 'ring-2 ring-blue-500 bg-blue-100' : '',
                      // Available-day accent when not selected
                      !sel && !start && !end && isAvailable ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : '',
                      // Today indicator when not a selected endpoint
                      !start && !end && isToday ? 'ring-1 ring-gray-300' : '',
                      'hover:bg-blue-50'
                    ].join(' ');
                    return (
                      <button
                        key={i2}
                        type="button"
                        onClick={() => onDayClick(d)}
                        className={cls}
                      >
                        {d.getDate()}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm rounded-md bg-gray-200 text-gray-800 hover:bg-gray-300">Close</button>
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700">Apply</button>
          </div>
        </div>
        </div>
      </div>
    </div>
  );

  // Render as a portal to ensure it's above and outside the filter modal on mobile
  return createPortal(modalUi, document.body);
}
