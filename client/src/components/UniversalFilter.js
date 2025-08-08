import React, { useState, useEffect, useMemo } from 'react';
import DateRangePicker from './DateRangePicker';

const UniversalFilter = ({ 
  projectData, 
  filters = {
    textSearch: '',
    dateRange: { start: '', end: '' }, // Only date_time_original field is used
    rawAvailable: false,
    orientation: 'any'
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
      rawAvailable: false,
      orientation: 'any'
    });
  };

  const hasActiveFilters = filters.textSearch || 
    filters.dateRange.start || 
    filters.dateRange.end || 
    filters.rawAvailable === true || 
    filters.orientation !== 'any';

  return (
    <div className={`${disabled ? 'bg-gray-50' : 'bg-white'}`}>
      <div className="max-w-7xl mx-auto p-4 space-y-6">
        {/* Clear All Button */}
        {hasActiveFilters && (
          <div className="flex justify-end">
            <button
              onClick={clearAllFilters}
              disabled={disabled}
              className={`text-sm ${
                disabled 
                  ? 'text-gray-400 cursor-not-allowed'
                  : 'text-red-600 hover:text-red-800'
              }`}
            >
              Clear all filters
            </button>
          </div>
        )}

        {/* All Filters in organized layout */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Text Search with Suggestions */}
          <div className="relative lg:col-span-2">
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
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
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

          {/* RAW Available Switch */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Only photos with RAW
            </label>
            <div className="flex items-center space-x-3 py-2">
              <span className={`text-sm ${filters.rawAvailable === false ? 'text-gray-900 font-medium' : 'text-gray-500'}`}>No</span>
              <button
                type="button"
                onClick={() => updateFilters({ 
                  ...filters, 
                  rawAvailable: !filters.rawAvailable 
                })}
                disabled={disabled}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                  filters.rawAvailable === true 
                    ? 'bg-blue-600' 
                    : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    filters.rawAvailable === true 
                      ? 'translate-x-6' 
                      : 'translate-x-1'
                  }`}
                />
              </button>
              <span className={`text-sm ${filters.rawAvailable === true ? 'text-gray-900 font-medium' : 'text-gray-500'}`}>Yes</span>
            </div>
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
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
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
