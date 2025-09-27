import React, { useEffect } from 'react';
import { useUpload } from '../upload/UploadContext';

// Component that bridges between App state and upload context
const UploadHandler = ({ selectedProject, pendingUpload, onUploadStarted }) => {
  const { actions } = useUpload();

  // Handle pending upload files when project context is ready
  useEffect(() => {
    if (pendingUpload?.files && pendingUpload?.targetProject && selectedProject?.folder === pendingUpload.targetProject.folder) {
      if (typeof actions.startAnalyze === 'function') {
        actions.startAnalyze(pendingUpload.files);
        onUploadStarted(); // Clear pending files
      }
    }
  }, [actions, selectedProject, pendingUpload, onUploadStarted]);

  return null; // This component doesn't render anything
};

export default UploadHandler;
