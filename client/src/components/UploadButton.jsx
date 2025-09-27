import React, { useRef } from 'react';
import { useUpload } from '../upload/UploadContext';

function UploadButton({
  disabled = false,
  isAllMode,
  selectedProject,
  allProjectFolder,
  openProjectSelection,
}) {
  const { actions } = useUpload();
  const inputRef = useRef(null);

  const handlePick = () => {
    if (disabled) return;
    if (inputRef.current) inputRef.current.click();
  };

  const handleChange = (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) {
      if (isAllMode) {
        openProjectSelection(files);
      } else if (selectedProject?.folder && selectedProject.folder !== allProjectFolder) {
        openProjectSelection(files, selectedProject);
      } else {
        actions.startAnalyze(files);
      }
    }
    event.target.value = '';
  };

  const isDisabled = disabled || (!isAllMode && (!selectedProject || selectedProject.folder === allProjectFolder));

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,.raw,.cr2,.nef,.arw,.dng,.tiff,.tif"
        className="hidden"
        onChange={handleChange}
      />
      <button
        onClick={handlePick}
        disabled={isDisabled}
        className={`inline-flex items-center justify-center px-3 py-2 rounded-md ${isDisabled ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
        title={isDisabled ? 'Select a project to enable uploads' : 'Upload photos'}
        aria-label="Upload photos"
        type="button"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
          <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
        </svg>
      </button>
    </>
  );
}

export default UploadButton;
