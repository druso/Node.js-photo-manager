import React, { useState, useEffect, useMemo } from 'react';
import DateRangePicker from './DateRangePicker';

const UniversalFilter = ({ 
  projectData, 
  filters = {
    textSearch: '',
    dateRange: { start: '', end: '' }, // Only date_time_original field is used
    fileType: 'any', // any | jpg_only | raw_only | both
    orientation: 'any',
    keepType: 'any' // any | none | jpg_only | raw_jpg
  },
  onFilterChange, 
  disabled = false
}) => {

  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState([]);

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
      keepType: 'any'
    });
  };

  const hasActiveFilters = filters.textSearch || 
    filters.dateRange.start || 
    filters.dateRange.end || 
    (filters.fileType && filters.fileType !== 'any') || 
    (filters.keepType && filters.keepType !== 'any') ||
    filters.orientation !== 'any';

  return (
    <div className={`${disabled ? 'bg-gray-50' : 'bg-white'}`}>
      <div className="w-full p-4 space-y-6">
        {/* All Filters in organized layout */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Text Search with Suggestions */}
          <div className="relative col-span-2 lg:col-span-2">
            <label htmlFor="textSearch" className="block text-sm font-medium text-gray-700 mb-1">
              Filter by filename or tag
            </label>
            <input
              id="textSearch"
              type="text"
              value={filters.textSearch}
              onChange={handleTextSearchChange}
              onFocus={() => setShowSuggestions(filters.textSearch.length > 0)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              placeholder="Type to search filenames, tags, or metadata..."
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              disabled={disabled}
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

          {/* File Types Available Dropdown */}
          <div>
            <label htmlFor="fileType" className="block text-sm font-medium text-gray-700 mb-1">
              File types available
            </label>
            <select
              id="fileType"
              value={filters.fileType}
              onChange={(e) => updateFilters({ ...filters, fileType: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              disabled={disabled}
            >
              <option value="any">Any (no filter)</option>
              <option value="jpg_only">JPG only</option>
              <option value="raw_only">RAW only</option>
              <option value="both">Both</option>
            </select>
          </div>

          {/* File Types To Keep Dropdown */}
          <div>
            <label htmlFor="keepType" className="block text-sm font-medium text-gray-700 mb-1">
              File types to keep
            </label>
            <select
              id="keepType"
              value={filters.keepType}
              onChange={(e) => updateFilters({ ...filters, keepType: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              disabled={disabled}
            >
              <option value="any">Show all (no filter)</option>
              <option value="any_kept">Any kept (JPG only or RAW+JPG)</option>
              <option value="jpg_only">Keep JPG only</option>
              <option value="raw_jpg">Keep RAW + JPG</option>
              <option value="none">Keep none (planned delete)</option>
            </select>
          </div>

          {/* Orientation */}
          <div>
            <label htmlFor="orientation" className="block text-sm font-medium text-gray-700 mb-1">
              Orientation
            </label>
            <select
              id="orientation"
              value={filters.orientation}
              onChange={(e) => updateFilters({ ...filters, orientation: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              disabled={disabled}
            >
              <option value="any">Any</option>
              <option value="vertical">Vertical</option>
              <option value="horizontal">Horizontal</option>
            </select>
          </div>
        </div>
        
        {/* Date Range Filter - Full Width Below */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Date taken
          </label>
          <DateRangePicker
            dateRange={filters.dateRange}
            onDateRangeChange={(range) => updateFilters({ ...filters, dateRange: range })}
            disabled={disabled}
          />
        </div>


      </div>
    </div>
  );
};

export default UniversalFilter;
