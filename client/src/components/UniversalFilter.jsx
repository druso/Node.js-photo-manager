import React, { useState, useEffect, useMemo, useRef } from 'react';
import DateRangePicker from './DateRangePicker';
import { filterTriggerClass } from './ui/controlClasses';
import SelectModal from './ui/SelectModal';

const UniversalFilter = ({ 
  projectData, 
  filters = {
    textSearch: '',
    dateRange: { start: '', end: '' }, // Only date_time_original field is used
    fileType: 'any', // any | jpg_only | raw_only | both
    orientation: 'any',
    keepType: 'any', // any | none | jpg_only | raw_jpg
    visibility: 'any', // any | public | private
  },
  onFilterChange, 
  disabled = false,
  isAllMode = false,
  onClose
}) => {

  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [openSelect, setOpenSelect] = useState(null); // 'orientation' | 'fileType' | 'keepType' | 'visibility' | null
  const [isDateOpen, setIsDateOpen] = useState(false);
  const panelRef = useRef(null);

  // In All Photos mode, deactivate specific controls per product request
  const disableTextSearch = !!isAllMode;
  const disableKeepType = !!isAllMode;

  const orientationOptions = [
    { value: 'any', label: 'Any' },
    { value: 'vertical', label: 'Vertical' },
    { value: 'horizontal', label: 'Horizontal' },
  ];
  const fileTypeOptions = [
    { value: 'any', label: 'Any (no filter)' },
    { value: 'jpg_only', label: 'JPG only' },
    { value: 'raw_only', label: 'RAW only' },
    { value: 'both', label: 'Both' },
  ];
  const keepTypeOptions = [
    { value: 'any', label: 'Show all (no filter)' },
    { value: 'any_kept', label: 'Any kept (JPG only or RAW+JPG)' },
    { value: 'jpg_only', label: 'Keep JPG only' },
    { value: 'raw_jpg', label: 'Keep RAW + JPG' },
    { value: 'none', label: 'Keep none (planned delete)' },
  ];
  const visibilityOptions = [
    { value: 'any', label: 'Any visibility' },
    { value: 'public', label: 'Public only' },
    { value: 'private', label: 'Private only' },
  ];

  // Generate suggestions from manifest data
  const allSuggestions = useMemo(() => {
    if (!projectData?.photos) return [];
    
    const suggestions = new Set();
    
    projectData.photos.forEach(photo => {
      // Add filename
      if (photo.filename) {
        suggestions.add(photo.filename);
      }
      
      // Add tags
      if (photo.tags && Array.isArray(photo.tags)) {
        photo.tags.forEach(tag => suggestions.add(tag));
      }
      
      // Add metadata fields
      if (photo.metadata) {
        // Camera make/model
        if (photo.metadata.Make) suggestions.add(photo.metadata.Make);
        if (photo.metadata.Model) suggestions.add(photo.metadata.Model);
        
        // Any other string metadata
        Object.values(photo.metadata).forEach(value => {
          if (typeof value === 'string' && value.trim()) {
            suggestions.add(value.trim());
          }
        });
      }
    });
    
    return Array.from(suggestions).sort();
  }, [projectData]);

  // Filter suggestions based on current input
  useEffect(() => {
    if (!filters.textSearch.trim()) {
      setSuggestions([]);
      return;
    }
    
    const filtered = allSuggestions.filter(suggestion =>
      suggestion.toLowerCase().includes(filters.textSearch.toLowerCase())
    ).slice(0, 10); // Limit to 10 suggestions
    
    setSuggestions(filtered);
  }, [filters.textSearch, allSuggestions]);

  // Helper function to update filters
  const updateFilters = (newFilters) => {
    onFilterChange(newFilters);
  };

  const handleTextSearchChange = (e) => {
    const value = e.target.value;
    updateFilters({ ...filters, textSearch: value });
    setShowSuggestions(value.length > 0);
  };

  const handleSuggestionClick = (suggestion) => {
    updateFilters({ ...filters, textSearch: suggestion });
    setShowSuggestions(false);
  };

  const clearAllFilters = () => {
    updateFilters({
      textSearch: '',
      dateRange: { start: '', end: '' },
      fileType: 'any',
      orientation: 'any',
      keepType: 'any',
      visibility: 'any'
    });
  };

  const hasActiveFilters = filters.textSearch || 
    filters.dateRange.start || 
    filters.dateRange.end || 
    (filters.fileType && filters.fileType !== 'any') || 
    (filters.keepType && filters.keepType !== 'any') ||
    filters.orientation !== 'any' ||
    (filters.visibility && filters.visibility !== 'any');
  const resetEnabled = hasActiveFilters && !disabled;

  // Derive available dates (YYYY-MM-DD) from photos to highlight in date picker
  const availableDates = useMemo(() => {
    const set = new Set();
    const photos = projectData?.photos || [];
    for (const p of photos) {
      const dt = p?.date_time_original || p?.metadata?.date_time_original;
      if (!dt) continue;
      const isoDay = new Date(dt).toISOString().slice(0, 10);
      if (isoDay) set.add(isoDay);
    }
    return Array.from(set);
  }, [projectData]);

  // Close filter panel on outside click when no sub-modals are open
  useEffect(() => {
    const handleDown = (e) => {
      if (!panelRef.current) return;
      const clickedInside = panelRef.current.contains(e.target);
      const anyModalOpen = !!openSelect || isDateOpen;
      if (!clickedInside && !anyModalOpen) {
        if (typeof onClose === 'function') onClose();
      }
    };
    document.addEventListener('mousedown', handleDown);
    return () => document.removeEventListener('mousedown', handleDown);
  }, [openSelect, isDateOpen, onClose]);

  return (
    <div ref={panelRef} className={`${disabled ? 'bg-gray-50' : 'bg-white'}`}>
      <div className="w-full p-4 space-y-6">
        {/* Text Search */}
        <div className="grid grid-cols-2 gap-4">
          {/* Text Search with Suggestions (full width) */}
          <div className="relative col-span-2">
            <label htmlFor="textSearch" className="block text-sm font-medium text-gray-700 mb-1">
              Filter by filename or tag
            </label>
            <input
              id="textSearch"
              name="textSearch"
              type="text"
              value={filters.textSearch}
              onChange={handleTextSearchChange}
              onFocus={() => setShowSuggestions(filters.textSearch.length > 0)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              placeholder="Type to search filenames, tags, or metadata..."
              className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${disableTextSearch ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : ''}`}
              disabled={disabled || disableTextSearch}
              aria-disabled={disabled || disableTextSearch ? 'true' : 'false'}
              title={disableTextSearch ? 'Disabled in All Photos view' : undefined}
            />
            
            {/* Suggestions Dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                {suggestions.map((suggestion, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => handleSuggestionClick(suggestion)}
                    className="w-full px-3 py-2 text-left hover:bg-gray-100 focus:bg-gray-100 focus:outline-none first:rounded-t-md last:rounded-b-md"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Date taken (left) */}
          <div>
            <label id="dateTakenLabel" className="block text-sm font-medium text-gray-700 mb-1">
              Date taken
            </label>
            <DateRangePicker
              dateRange={filters.dateRange}
              onDateRangeChange={(range) => updateFilters({ ...filters, dateRange: range })}
              disabled={disabled}
              onOpenChange={setIsDateOpen}
              availableDates={availableDates}
              ariaLabelledBy="dateTakenLabel"
            />
          </div>

          {/* Orientation (right of Date taken) */}
          <div>
            <label id="orientation-label" className="block text-sm font-medium text-gray-700 mb-1">
              Orientation
            </label>
            <button
              type="button"
              onClick={() => !disabled && setOpenSelect('orientation')}
              disabled={disabled}
              className={`w-full ${filterTriggerClass} justify-between ${disabled ? 'text-gray-400 border-gray-200 cursor-not-allowed' : ''}`}
              name="orientation"
              aria-labelledby="orientation-label"
            >
              <span className="truncate">
                {orientationOptions.find(o => o.value === filters.orientation)?.label || 'Any'}
              </span>
              <svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
          </div>

          {/* File types available (left on second row) */}
          <div>
            <label id="fileType-label" className="block text-sm font-medium text-gray-700 mb-1">
              File types available
            </label>
            <button
              type="button"
              onClick={() => !disabled && setOpenSelect('fileType')}
              disabled={disabled}
              className={`w-full ${filterTriggerClass} justify-between ${disabled ? 'text-gray-400 border-gray-200 cursor-not-allowed' : ''}`}
              name="fileType"
              aria-labelledby="fileType-label"
            >
              <span className="truncate">
                {fileTypeOptions.find(o => o.value === filters.fileType)?.label || 'Any (no filter)'}
              </span>
              <svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
          </div>

          {/* File types to keep (center on second row) */}
          <div>
            <label id="keepType-label" className="block text-sm font-medium text-gray-700 mb-1">
              File types to keep
            </label>
            <button
              type="button"
              onClick={() => !disabled && !disableKeepType && setOpenSelect('keepType')}
              disabled={disabled || disableKeepType}
              className={`w-full ${filterTriggerClass} justify-between ${(disabled || disableKeepType) ? 'text-gray-400 border-gray-200 cursor-not-allowed' : ''}`}
              name="keepType"
              aria-labelledby="keepType-label"
              aria-disabled={(disabled || disableKeepType) ? 'true' : 'false'}
              title={disableKeepType ? 'Disabled in All Photos view' : undefined}
            >
              <span className="truncate">
                {keepTypeOptions.find(o => o.value === filters.keepType)?.label || 'Show all (no filter)'}
              </span>
              <svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
          </div>

          {/* Visibility (right on second row) */}
          <div>
            <label id="visibility-label" className="block text-sm font-medium text-gray-700 mb-1">
              Visibility
            </label>
            <button
              type="button"
              onClick={() => !disabled && setOpenSelect('visibility')}
              disabled={disabled}
              className={`w-full ${filterTriggerClass} justify-between ${disabled ? 'text-gray-400 border-gray-200 cursor-not-allowed' : ''}`}
              name="visibility"
              aria-labelledby="visibility-label"
            >
              <span className="truncate">
                {visibilityOptions.find(o => o.value === filters.visibility)?.label || 'Any visibility'}
              </span>
              <svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
          </div>
        </div>

      </div>
      {/* Footer actions */}
      <div className="border-t-0 px-4 py-3">
        <div className="grid grid-cols-2 gap-3">
          {/* Reset on the left - red outline when enabled, toned down when disabled */}
          <button
            type="button"
            className={`w-full px-4 py-2 rounded-md border transition-colors ${
              resetEnabled
                ? 'border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400'
                : 'border-gray-200 text-gray-300 cursor-not-allowed bg-white'
            }`}
            onClick={clearAllFilters}
            disabled={!resetEnabled}
            aria-disabled={!resetEnabled ? 'true' : 'false'}
            aria-label="Reset filters"
          >
            Reset
          </button>
          {/* Close on the right - gray filled */}
          <button
            type="button"
            className="w-full px-4 py-2 rounded-md bg-gray-200 text-gray-800 hover:bg-gray-300 disabled:opacity-50"
            onClick={() => { if (typeof onClose === 'function') onClose(); }}
            aria-label="Close filters"
          >
            Close
          </button>
        </div>
      </div>

      {/* Modal selects */}
      {openSelect === 'orientation' && (
        <SelectModal
          title="Orientation"
          options={orientationOptions}
          value={filters.orientation}
          onSelect={(val) => updateFilters({ ...filters, orientation: val })}
          onClose={() => setOpenSelect(null)}
        />
      )}
      {openSelect === 'fileType' && (
        <SelectModal
          title="File types available"
          options={fileTypeOptions}
          value={filters.fileType}
          onSelect={(val) => updateFilters({ ...filters, fileType: val })}
          onClose={() => setOpenSelect(null)}
        />
      )}
      {openSelect === 'keepType' && (
        <SelectModal
          title="File types to keep"
          options={keepTypeOptions}
          value={filters.keepType}
          onSelect={(val) => updateFilters({ ...filters, keepType: val })}
          onClose={() => setOpenSelect(null)}
        />
      )}
      {openSelect === 'visibility' && (
        <SelectModal
          title="Visibility"
          options={visibilityOptions}
          value={filters.visibility}
          onSelect={(val) => updateFilters({ ...filters, visibility: val })}
          onClose={() => setOpenSelect(null)}
        />
      )}
    </div>
  );
};

export default UniversalFilter;
