import React, { useEffect } from 'react';
import { useUpload } from '../upload/UploadContext';

// Component that bridges between App state and upload context
const UploadHandler = ({ selectedProject, pendingUploadFiles, onUploadStarted }) => {
  const { actions } = useUpload();

  // Handle pending upload files when project context is ready
  useEffect(() => {
    if (pendingUploadFiles?.files && pendingUploadFiles?.targetProject && selectedProject?.folder === pendingUploadFiles.targetProject.folder) {
      console.log('Starting upload analysis for selected project:', selectedProject.folder);
      if (typeof actions.startAnalyze === 'function') {
        actions.startAnalyze(pendingUploadFiles.files);
        onUploadStarted(); // Clear pending files
      }
    }
  }, [actions, selectedProject, pendingUploadFiles, onUploadStarted]);

  return null; // This component doesn't render anything
};

export default UploadHandler;
