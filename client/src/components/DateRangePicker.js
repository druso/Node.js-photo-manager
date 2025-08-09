import React, { useMemo, useState } from 'react';

// Date taken filter component - only handles date_time_original field
const DateRangePicker = ({ 
  dateRange, 
  onDateRangeChange, 
  disabled = false 
}) => {
  const [showPresets, setShowPresets] = useState(false);
  const [month, setMonth] = useState(() => new Date().getMonth()); // 0-11
  const [year, setYear] = useState(() => new Date().getFullYear());

  const datePresets = [
    {
      label: 'Today',
      getValue: () => {
        const today = new Date();
        return {
          start: today.toISOString().slice(0, 10),
          end: today.toISOString().slice(0, 10)
        };
      }
    },
    {
      label: 'Yesterday',
      getValue: () => {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        return {
          start: yesterday.toISOString().slice(0, 10),
          end: yesterday.toISOString().slice(0, 10)
        };
      }
    },
    {
      label: 'Last 7 days',
      getValue: () => {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 7);
        return {
          start: start.toISOString().slice(0, 10),
          end: end.toISOString().slice(0, 10)
        };
      }
    },
    {
      label: 'Last 30 days',
      getValue: () => {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 30);
        return {
          start: start.toISOString().slice(0, 10),
          end: end.toISOString().slice(0, 10)
        };
      }
    },
    {
      label: 'This month',
      getValue: () => {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return {
          start: start.toISOString().slice(0, 10),
          end: end.toISOString().slice(0, 10)
        };
      }
    },
    {
      label: 'Last month',
      getValue: () => {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const end = new Date(now.getFullYear(), now.getMonth(), 0);
        return {
          start: start.toISOString().slice(0, 10),
          end: end.toISOString().slice(0, 10)
        };
      }
    }
  ];

  const handlePresetClick = (preset) => {
    const range = preset.getValue();
    onDateRangeChange(range);
    setShowPresets(false);
  };

  const clearDateRange = () => {
    onDateRangeChange({ start: '', end: '' });
  };

  const hasDateRange = dateRange.start || dateRange.end;

  // Ensure start <= end if both provided
  const onStartChange = (val) => {
    const next = { ...dateRange, start: val };
    if (next.end && val && val > next.end) {
      // If start goes past end, move end to start
      next.end = val;
    }
    onDateRangeChange(next);
  };

  const onEndChange = (val) => {
    const next = { ...dateRange, end: val };
    if (next.start && val && val < next.start) {
      // If end goes before start, move start to end
      next.start = val;
    }
    onDateRangeChange(next);
  };

  // Build Month/Year lists
  const monthNames = useMemo(() => (
    ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  ), []);

  const years = useMemo(() => {
    const current = new Date().getFullYear();
    const arr = [];
    for (let y = current; y >= current - 15; y--) arr.push(y);
    return arr;
  }, []);

  const applyMonthYear = () => {
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0);
    onDateRangeChange({
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10)
    });
  };

  return (
    <div className="space-y-3">
        {/* Preset Buttons */}
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowPresets(!showPresets)}
              disabled={disabled}
              className={`px-3 py-1 text-sm border rounded-md transition-colors ${
                disabled 
                  ? 'text-gray-400 border-gray-200 cursor-not-allowed'
                  : 'text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              Quick select
              <svg className={`inline-block ml-1 h-4 w-4 transition-transform ${showPresets ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showPresets && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-md shadow-lg z-50 min-w-40">
                {datePresets.map((preset, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => handlePresetClick(preset)}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 focus:bg-gray-100 focus:outline-none first:rounded-t-md last:rounded-b-md"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {hasDateRange && (
            <button
              type="button"
              onClick={clearDateRange}
              disabled={disabled}
              className={`px-3 py-1 text-sm border rounded-md transition-colors ${
                disabled 
                  ? 'text-gray-400 border-gray-200 cursor-not-allowed'
                  : 'text-red-600 border-red-300 hover:bg-red-50'
              }`}
            >
              Clear dates
            </button>
          )}
          {/* Month/Year quick range */}
          <div className="flex items-center gap-2">
            <select
              value={month}
              onChange={(e) => setMonth(parseInt(e.target.value, 10))}
              disabled={disabled}
              className="px-2 py-1 text-sm border rounded-md"
            >
              {monthNames.map((m, idx) => (
                <option key={idx} value={idx}>{m}</option>
              ))}
            </select>
            <select
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value, 10))}
              disabled={disabled}
              className="px-2 py-1 text-sm border rounded-md"
            >
              {years.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={applyMonthYear}
              disabled={disabled}
              className={`px-3 py-1 text-sm border rounded-md transition-colors ${
                disabled
                  ? 'text-gray-400 border-gray-200 cursor-not-allowed'
                  : 'text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              Set month
            </button>
          </div>
        </div>

        {/* Custom Date Range */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="dateStart" className="block text-sm font-medium text-gray-700 mb-1">
              From
            </label>
            <input
              id="dateStart"
              type="date"
              value={dateRange.start}
              onChange={(e) => onStartChange(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              disabled={disabled}
            />
          </div>

          <div>
            <label htmlFor="dateEnd" className="block text-sm font-medium text-gray-700 mb-1">
              To
            </label>
            <input
              id="dateEnd"
              type="date"
              value={dateRange.end}
              onChange={(e) => onEndChange(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              disabled={disabled}
            />
          </div>
        </div>

        {/* Date Range Summary */}
        {hasDateRange && (
          <div className="text-sm text-gray-600 bg-blue-50 px-3 py-2 rounded-md">
            {dateRange.start && dateRange.end ? (
              <>
                <strong>Range:</strong> {new Date(dateRange.start).toLocaleDateString()} to {new Date(dateRange.end).toLocaleDateString()}
              </>
            ) : dateRange.start ? (
              <>
                <strong>From:</strong> {new Date(dateRange.start).toLocaleDateString()}
              </>
            ) : (
              <>
                <strong>Until:</strong> {new Date(dateRange.end).toLocaleDateString()}
              </>
            )}
          </div>
        )}
    </div>
  );
};

export default DateRangePicker;
