import React, { useState } from 'react';
import DualMonthRangePopover from './ui/DualMonthRangePopover';
import { filterTriggerClass } from './ui/controlClasses';

// Date taken filter component - only handles date_time_original field
const DateRangePicker = ({ 
  dateRange, 
  onDateRangeChange, 
  disabled = false,
  onOpenChange,
  availableDates = [],
}) => {
  const [open, setOpen] = useState(false);
  

  // derived label only; range rendering handled in popover

  const label = () => {
    const { start, end } = dateRange;
    if (!start && !end) return 'Select dates';
    if (start && end) return `${new Date(start).toLocaleDateString()} – ${new Date(end).toLocaleDateString()}`;
    if (start) return `From ${new Date(start).toLocaleDateString()}`;
    return `Until ${new Date(end).toLocaleDateString()}`;
  };

  

  return (
    <div className="relative w-full">
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          const next = !open;
          setOpen(next);
          if (typeof onOpenChange === 'function') onOpenChange(next);
        }}
        disabled={disabled}
        className={`w-full ${filterTriggerClass} justify-between ${disabled ? 'text-gray-400 border-gray-200 cursor-not-allowed' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open ? 'true' : 'false'}
      >
        <span className="inline-flex items-center gap-2 min-w-0">
          <svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          <span className="truncate">{label()}</span>
        </span>
        <svg className={`h-4 w-4 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && (
        <DualMonthRangePopover
          value={dateRange}
          onChange={onDateRangeChange}
          onClose={() => { setOpen(false); if (typeof onOpenChange === 'function') onOpenChange(false); }}
          availableDates={availableDates}
        />
      )}
    </div>
  );
};

export default DateRangePicker;
