// Shared Tailwind class strings for filter controls
export const filterControlBase = 'w-full px-3 py-2 text-sm border rounded-md transition-colors text-gray-700 border-gray-300 hover:bg-gray-50 disabled:text-gray-400 disabled:border-gray-200 disabled:cursor-not-allowed focus:outline-none focus:ring-blue-500 focus:border-blue-500';

// For native selects with custom caret overlay
export const filterSelectClass = `${filterControlBase} appearance-none pr-8`;

// For button-like triggers (e.g., date range)
export const filterTriggerClass = `${filterControlBase} inline-flex justify-between items-center gap-2`;
