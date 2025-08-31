import React, { useState, useRef } from 'react';
import { analyzeFiles as apiAnalyzeFiles, processPerImage as apiProcessPerImage } from '../api/uploadsApi';

const PhotoUpload = ({ projectFolder, onPhotosUploaded }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState([]);
  const [uploadPhase, setUploadPhase] = useState('idle'); // 'idle', 'preparation', 'loading', 'post-processing'
  const [analysisResult, setAnalysisResult] = useState(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [expandedDetails, setExpandedDetails] = useState(false);
  const [skipDuplicates, setSkipDuplicates] = useState(true); // Default to skip duplicates
  // Upload conflict handling flags (wired to backend multipart fields)
  // Overwrite is now implied when skipping duplicates is OFF.
  const [reloadConflictsIntoThisProject, setReloadConflictsIntoThisProject] = useState(false);
  const fileInputRef = useRef(null);

  // Helper function to analyze files and group by base name
  const analyzeFiles = async (files) => {
    setUploadPhase('preparation');
    
    // Prepare file list for backend analysis
    const fileList = files.map(file => ({
      name: file.name,
      size: file.size,
      type: file.type
    }));
    
    // Sending file list to backend for analysis
    
    try {
      // Send file list to backend for authoritative analysis
      const analysisResult = await apiAnalyzeFiles(projectFolder, fileList);
      // Backend analysis result received
      
      // Add file objects back to the groups for upload
      Object.values(analysisResult.imageGroups).forEach(group => {
        group.files.forEach(fileInfo => {
          const originalFile = files.find(f => f.name === fileInfo.name);
          if (originalFile) {
            fileInfo.file = originalFile;
          }
        });
      });
      
      return {
        imageGroups: analysisResult.imageGroups,
        summary: analysisResult.summary,
        conflicts: Array.isArray(analysisResult.conflicts) ? analysisResult.conflicts : [],
        completion_conflicts: Array.isArray(analysisResult.completion_conflicts) ? analysisResult.completion_conflicts : []
      };
      
    } catch (error) {
      // File analysis failed
      throw new Error(`File analysis failed: ${error.message}`);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    handleFiles(files);
  };

  const handleFiles = async (files) => {
    if (files.length === 0) return;

    // Phase 1: Preparation - Analyze files
    setUploadPhase('preparation');
    setUploadProgress([{ 
      name: 'Analyzing files...', 
      progress: 0, 
      status: 'uploading'
    }]);

    try {
      const analysis = await analyzeFiles(files);
      console.log('Analysis result:', analysis); // Debug log
      console.log('Analysis conflicts check:', {
        hasConflicts: Array.isArray(analysis?.conflicts),
        conflictsLength: analysis?.conflicts?.length,
        conflicts: analysis?.conflicts
      }); // Debug log
      setAnalysisResult(analysis);
      // Initialize conflict flags based on analysis
      try {
        const hasCrossConflicts = Array.isArray(analysis?.conflicts) && analysis.conflicts.length > 0;
        console.log('Cross conflicts detected:', hasCrossConflicts, 'conflicts:', analysis?.conflicts); // Debug log
        setReloadConflictsIntoThisProject(hasCrossConflicts);
      } catch {}

      // Backend now handles file validation, so no rejectedFiles array
      // File validation is done server-side in the analyze-files endpoint
      
      if (analysis.summary.totalFiles === 0) {
        setUploadPhase('idle');
        setUploadProgress([]);
        alert('No valid image files found to upload.');
        return;
      }

      // Show confirmation UI
      setShowConfirmation(true);
      setUploadProgress([]);
      setUploadPhase('idle');
    } catch (error) {
      console.error('File analysis failed:', error);
      alert('Failed to analyze files. Please try again.');
      setUploadPhase('idle');
      setUploadProgress([]);
    }
  };

  const proceedWithUpload = async () => {
    if (!analysisResult) return;

    // Filter files based on skip/overwrite setting and cross-project conflicts
    let filesToUpload;
    let imagesToProcess;
    const conflictArray = Array.isArray(analysisResult.conflicts)
      ? analysisResult.conflicts.map(c => c.filename)
      : [];
    const conflictNames = new Set(conflictArray);
    
    console.log('Conflict filtering setup:', {
      conflictArray,
      conflictNames: Array.from(conflictNames),
      reloadConflictsIntoThisProject,
      shouldExcludeConflicts: !reloadConflictsIntoThisProject
    });
    
    console.log('Filtering debug:', {
      conflictArray,
      conflictNames: Array.from(conflictNames),
      imageGroups: Object.keys(analysisResult.imageGroups),
      imageGroupDetails: analysisResult.imageGroups,
      reloadConflictsIntoThisProject
    });
    
    if (skipDuplicates) {
      // Skip true duplicates, include new images and format completions
      // Exclude cross-project conflicts unless user chose to reload them
      const allowedGroups = Object.values(analysisResult.imageGroups).filter(group => {
        const isCrossProjectConflict = conflictNames.has(group.baseName);
        const shouldExcludeConflict = isCrossProjectConflict && !reloadConflictsIntoThisProject;
        const allowed = (group.isNew || group.conflictType === 'completion') && !shouldExcludeConflict;
        console.log(`Group ${group.baseName}: isNew=${group.isNew}, conflictType=${group.conflictType}, isCrossProjectConflict=${isCrossProjectConflict}, shouldExcludeConflict=${shouldExcludeConflict}, allowed=${allowed}`);
        return allowed;
      });
      filesToUpload = allowedGroups.flatMap(group => group.files.map(f => f.file));
      imagesToProcess = allowedGroups.length;
    } else {
      // Overwrite duplicates within this project, but NEVER upload cross-project conflicts.
      // Cross-project conflicts are handled via move scheduling when selected.
      const allowedGroups = Object.values(analysisResult.imageGroups).filter(group => {
        const isCrossProjectConflict = conflictNames.has(group.baseName);
        const allowed = !isCrossProjectConflict;
        console.log(`Group ${group.baseName}: isCrossProjectConflict=${isCrossProjectConflict}, allowed=${allowed}`);
        return allowed;
      });
      filesToUpload = allowedGroups.flatMap(group => group.files.map(f => f.file));
      imagesToProcess = allowedGroups.length;
    }

    const moveOnly = reloadConflictsIntoThisProject && conflictArray.length > 0 && filesToUpload.length === 0;
    if (!moveOnly && filesToUpload.length === 0) {
      alert('No files to upload after filtering.');
      return;
    }

    // Keep overwrite flag visually aligned: overwrite = !skipDuplicates unless user changed it explicitly
    // We do not force it here to respect any manual toggle the user made; default was synced with skipDuplicates in UI
    setShowConfirmation(false);
    setUploading(true);
    setUploadPhase('loading');

    // Phase 2: Loading - Upload files
    setUploadProgress([{ 
      name: moveOnly
        ? `Consolidating ${conflictArray.length} conflicted item${conflictArray.length > 1 ? 's' : ''}`
        : `Uploading ${filesToUpload.length} file${filesToUpload.length > 1 ? 's' : ''}`,
      progress: 0, 
      status: 'uploading',
      totalFiles: moveOnly ? 0 : filesToUpload.length,
      totalImages: moveOnly ? 0 : imagesToProcess
    }]);

    const formData = new FormData();
    if (!moveOnly) {
      filesToUpload.forEach(file => {
        formData.append('photos', file);
      });
    }
    // Wire flags expected by backend (string booleans, lowercase)
    // Overwrite is implied when not skipping duplicates
    const effectiveOverwrite = !skipDuplicates;
    formData.append('overwriteInThisProject', String(!!effectiveOverwrite).toLowerCase());
    formData.append('reloadConflictsIntoThisProject', String(!!reloadConflictsIntoThisProject).toLowerCase());
    if (reloadConflictsIntoThisProject && conflictArray.length > 0) {
      try { formData.append('conflictItems', JSON.stringify(conflictArray)); } catch (_) {}
    }

    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentCompleted = Math.round((event.loaded * 100) / event.total);
        setUploadProgress(prevProgress =>
          prevProgress.map(p => ({ 
            ...p, 
            progress: percentCompleted,
            name: `Uploading ${p.totalFiles} file${p.totalFiles > 1 ? 's' : ''} (${percentCompleted}%)`
          }))
        );
      }
    };

    xhr.onload = async function() {
      if (xhr.status >= 200 && xhr.status < 300) {
        let result = {};
        try { result = JSON.parse(xhr.responseText); } catch {}
        // Treat 202 and consolidation-only responses as move-only, even if files were included in the request
        const treatAsMoveOnly = (
          moveOnly ||
          xhr.status === 202 ||
          (result && result.flags && result.flags.reloadConflictsIntoThisProject && Array.isArray(result.files) && result.files.length === 0)
        );

        // Phase 3: Post-processing - Generate derivatives per image (only when not consolidation-only)
        setUploadProgress(prevProgress => 
          prevProgress.map(p => ({
          ...p, 
          progress: 100, 
          status: 'post-processing',
          name: treatAsMoveOnly
            ? `Consolidation scheduled for ${conflictArray.length} conflicted item${conflictArray.length > 1 ? 's' : ''}.`
            : `Processing ${p.totalImages} image${p.totalImages > 1 ? 's' : ''} (generating derivatives...)`
        }))
      );
      
      try {
        // Derive basenames for subset processing when not consolidation-only
        const basenames = treatAsMoveOnly
          ? []
          : Array.from(new Set(filesToUpload.map(f => {
              const dot = f.name.lastIndexOf('.');
              return dot > 0 ? f.name.substring(0, dot) : f.name;
            })));

        if (!treatAsMoveOnly) {
          const processResult = await apiProcessPerImage(projectFolder, { force: false, filenames: basenames });
          console.log('Derivatives job enqueued:', processResult);
        }

        const successMsg = treatAsMoveOnly
          ? `Consolidation scheduled for ${conflictArray.length} conflicted item${conflictArray.length > 1 ? 's' : ''}.`
          : `Upload completed successfully. Derivatives generation started for ${imagesToProcess} image${imagesToProcess > 1 ? 's' : ''}.`;
        alert(successMsg);
        setUploadProgress(
          prevProgress => prevProgress.map(p => ({ 
            ...p, 
            status: 'completed',
            name: (treatAsMoveOnly)
              ? `Scheduled consolidation for ${conflictArray.length} conflicted item${conflictArray.length > 1 ? 's' : ''}.`
              : `Successfully uploaded ${p.totalImages} image${p.totalImages > 1 ? 's' : ''} (${p.totalFiles} files)! Derivatives job enqueued.`
          }))
        );
      } catch (err) {
        console.warn('Derivatives processing enqueue failed:', err);
        setUploadProgress(
          prevProgress => prevProgress.map(p => ({ 
            ...p, 
            status: 'completed',
            name: `Successfully uploaded ${p.totalImages} image${p.totalImages > 1 ? 's' : ''} (${p.totalFiles} files)! (Derivatives enqueue failed)`
          }))
        );
      }
      
      // Reset state after showing success
      setTimeout(() => {
        setUploading(false);
        setUploadPhase('idle');
        setUploadProgress([]);
        setAnalysisResult(null);
        setShowConfirmation(false);
        onPhotosUploaded();
      }, 3000);
      } else {
        let errorMsg = `Upload failed: ${xhr.statusText}`;
        try {
          const error = JSON.parse(xhr.responseText);
          if (error.error) {
            errorMsg = `Upload failed: ${error.error}`;
          }
        } catch (e) {
          // Ignore if response is not JSON
        }
        setUploading(false);
        setUploadPhase('idle');
        setUploadProgress(prevProgress =>
          prevProgress.map(p => ({ 
            ...p, 
            progress: 0, 
            status: 'error',
            name: `Upload failed for ${analysisResult?.summary.totalImages || 0} image${(analysisResult?.summary.totalImages || 0) > 1 ? 's' : ''}`
          }))
        );
        setAnalysisResult(null);
        alert(errorMsg);
      }
    };

    xhr.onerror = () => {
      console.error('Upload error:', xhr.statusText);
      setUploading(false);
      setUploadPhase('idle');
      setUploadProgress(prevProgress =>
        prevProgress.map(p => ({ ...p, progress: 0, status: 'error' }))
      );
      setAnalysisResult(null);
      alert('Upload failed due to network error. Please try again.');
    };

    xhr.open('POST', `/api/projects/${projectFolder}/upload`);
    xhr.send(formData);
  };

  const cancelUpload = () => {
    setShowConfirmation(false);
    setAnalysisResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6">
      {/* Upload Area */}
      <div
        className={`relative border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
          isDragOver
            ? 'border-blue-400 bg-blue-50'
            : uploading
            ? 'border-gray-300 bg-gray-50'
            : 'border-gray-300 hover:border-gray-400'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.raw,.cr2,.nef,.arw,.dng,.tiff,.tif"
          onChange={handleFileSelect}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          disabled={uploading}
        />
        
        <div className="space-y-4">
          <div className="text-6xl">
            {uploading ? '⏳' : isDragOver ? '📥' : '📸'}
          </div>
          
          <div>
            <h3 className="text-lg font-medium text-gray-900">
              {uploading ? 'Uploading photos...' : 'Upload Photos'}
            </h3>
            <p className="text-gray-600 mt-2">
              {uploading
                ? 'Please wait while your photos are being processed'
                : isDragOver
                ? 'Drop your photos here'
                : 'Drag and drop photos here, or click to select files'
              }
            </p>
          </div>
          
          {!uploading && (
            <div className="text-sm text-gray-500">
              <p>Supported formats: JPEG, PNG, TIFF, RAW (CR2, NEF, ARW, DNG)</p>
              <p>Maximum file size: 100MB per file</p>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Panel */}
      {showConfirmation && analysisResult && (
        <div className="bg-white rounded-lg shadow-sm border-2 border-blue-200 p-6">
          <h4 className="text-lg font-medium text-gray-900 mb-4">Upload Confirmation</h4>
          <div className="space-y-4">
            {/* Summary */}
            <div className="bg-blue-50 rounded-lg p-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium text-blue-900">Images to process:</span>
                  <span className="ml-2 text-blue-700">{analysisResult.summary.totalImages}</span>
                </div>
                <div>
                  <span className="font-medium text-blue-900">Total files:</span>
                  <span className="ml-2 text-blue-700">{analysisResult.summary.totalFiles}</span>
                </div>
                <div>
                  <span className="font-medium text-green-900">New images:</span>
                  <span className="ml-2 text-green-700">{analysisResult.summary.newImages}</span>
                </div>
                <div>
                  <span className="font-medium text-green-900">Format completions:</span>
                  <span className="ml-2 text-green-700">{analysisResult.summary.completionImages}</span>
                </div>
                <div>
                  <span className="font-medium text-orange-900">True duplicates:</span>
                  <span className="ml-2 text-orange-700">{analysisResult.summary.duplicateImages}</span>
                </div>
              </div>
            </div>

            {/* Cross-project conflicts - Force show for debugging */}
            {analysisResult && analysisResult.conflicts && analysisResult.conflicts.length > 0 && (
              <div className="border border-purple-200 rounded-lg p-4">
                <h5 className="font-medium text-purple-900 mb-2">Cross-project conflicts ({analysisResult.conflicts.length})</h5>
                <p className="text-sm text-purple-700 mb-2">Items with the same base name exist in other projects. You can reload them into this project now.</p>
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={reloadConflictsIntoThisProject}
                    onChange={(e) => setReloadConflictsIntoThisProject(e.target.checked)}
                    className="mr-2"
                  />
                  <span className="text-sm font-medium text-purple-900">Move conflicting items into this project</span>
                </label>
              </div>
            )}

            {/* Duplicate handling */}
            {analysisResult.summary.duplicateImages > 0 && (
              <div className="border border-orange-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h5 className="font-medium text-orange-900">True duplicates ({analysisResult.summary.duplicateImages})</h5>
                  <button onClick={() => setExpandedDetails(!expandedDetails)} className="text-sm text-orange-700 hover:text-orange-900">
                    {expandedDetails ? 'Hide details' : 'Show details'}
                  </button>
                </div>
                <div className="mb-3 p-3 bg-orange-50 rounded">
                  <label className="flex items-center cursor-pointer">
                    <input type="checkbox" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} className="mr-2" />
                    <span className="text-sm font-medium text-orange-900">Skip project duplicates</span>
                  </label>
                  <p className="text-xs text-orange-700 mt-1">
                    {skipDuplicates
                      ? `Will upload ${analysisResult.summary.newImages + analysisResult.summary.completionImages} images (${analysisResult.summary.newImages} new + ${analysisResult.summary.completionImages} completions). Duplicates will be skipped.`
                      : `Will overwrite ${analysisResult.summary.duplicateImages} duplicate images and upload ${analysisResult.summary.newImages + analysisResult.summary.completionImages} others.`}
                  </p>
                </div>
                {expandedDetails && (
                  <div className="space-y-2 text-sm">
                    {Object.values(analysisResult.imageGroups)
                      .filter(group => group.conflictType === 'duplicate')
                      .map((group, index) => (
                        <div key={index} className="bg-orange-50 rounded p-2">
                          <div className="font-medium text-orange-900">{group.baseName}</div>
                          <div className="text-orange-700 text-xs">Duplicate files: {group.files.map(f => f.name).join(', ')}</div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* Format completions */}
            {analysisResult.summary.completionImages > 0 && (
              <div className="border border-green-200 rounded-lg p-4">
                <h5 className="font-medium text-green-900 mb-2">Format Completions ({analysisResult.summary.completionImages})</h5>
                <p className="text-sm text-green-700 mb-2">These files will add new formats to existing images.</p>
                {expandedDetails && (
                  <div className="space-y-2 text-sm">
                    {Object.values(analysisResult.imageGroups)
                      .filter(group => group.conflictType === 'completion')
                      .map((group, index) => (
                        <div key={index} className="bg-green-50 rounded p-2">
                          <div className="font-medium text-green-900">{group.baseName}</div>
                          <div className="text-green-700 text-xs">Adding: {group.files.map(f => f.name).join(', ')}</div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex space-x-3 pt-2">
              <button onClick={proceedWithUpload} className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">Proceed with Upload</button>
              <button onClick={cancelUpload} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Progress */}
      {uploadProgress.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h4 className="text-lg font-medium text-gray-900 mb-4">Upload Progress</h4>
          <div className="space-y-3">
            {uploadProgress.map((file, index) => (
              <div key={index} className="flex items-center space-x-3">
                <div className="flex-1">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm font-medium text-gray-700 truncate">
                      {file.name}
                    </span>
                    <span className="text-sm text-gray-500">
                      {file.status === 'completed' ? '✅' : 
                       file.status === 'error' ? '❌' : 
                       file.status === 'post-processing' ? '🔄' : '⏳'}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all duration-300 ${
                        file.status === 'completed'
                          ? 'bg-green-500'
                          : file.status === 'error'
                          ? 'bg-red-500'
                          : file.status === 'post-processing'
                          ? 'bg-orange-500'
                          : 'bg-blue-500'
                      }`}
                      style={{ width: `${file.progress}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload Tips */}
      <div className="bg-blue-50 rounded-lg p-6">
        <h4 className="text-lg font-medium text-blue-900 mb-3">📝 Upload Tips</h4>
        <ul className="space-y-2 text-sm text-blue-800">
          <li>• Photos with the same base filename will be grouped together (e.g., IMG_001.jpg and IMG_001.raw)</li>
          <li>• Thumbnails are automatically generated for supported formats</li>
          <li>• RAW files are supported but thumbnails may not be generated for all formats</li>
          <li>• Large files may take longer to upload and process</li>
          <li>• You can upload multiple files at once by selecting them or dragging a folder</li>
        </ul>
      </div>
    </div>
  );
};

export default PhotoUpload;
