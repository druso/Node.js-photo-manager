import React, { useState, useRef } from 'react';
import { analyzeFiles as apiAnalyzeFiles, generateThumbnails as apiGenerateThumbnails } from '../api/uploadsApi';

const PhotoUpload = ({ projectFolder, onPhotosUploaded }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState([]);
  const [uploadPhase, setUploadPhase] = useState('idle'); // 'idle', 'preparation', 'loading', 'post-processing'
  const [analysisResult, setAnalysisResult] = useState(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [expandedDetails, setExpandedDetails] = useState(false);
  const [skipDuplicates, setSkipDuplicates] = useState(true); // Default to skip duplicates
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
    
    console.log('Sending file list to backend for analysis:', fileList);
    
    try {
      // Send file list to backend for authoritative analysis
      const analysisResult = await apiAnalyzeFiles(projectFolder, fileList);
      console.log('Backend analysis result:', analysisResult);
      
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
        summary: analysisResult.summary
      };
      
    } catch (error) {
      console.error('File analysis failed:', error);
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
      setAnalysisResult(analysis);

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

    // Filter files based on skip/overwrite setting
    let filesToUpload;
    let imagesToProcess;
    
    if (skipDuplicates) {
      // Skip true duplicates, but include new images and format completions
      const allowedGroups = Object.values(analysisResult.imageGroups).filter(group => 
        group.isNew || group.conflictType === 'completion'
      );
      filesToUpload = allowedGroups.flatMap(group => group.files.map(f => f.file));
      imagesToProcess = allowedGroups.length;
    } else {
      // Upload all files (overwrite duplicates)
      filesToUpload = Object.values(analysisResult.imageGroups)
        .flatMap(group => group.files.map(f => f.file));
      imagesToProcess = analysisResult.summary.totalImages;
    }

    if (filesToUpload.length === 0) {
      alert('No files to upload after filtering.');
      return;
    }

    setShowConfirmation(false);
    setUploading(true);
    setUploadPhase('loading');

    // Phase 2: Loading - Upload files
    setUploadProgress([{ 
      name: `Uploading ${filesToUpload.length} file${filesToUpload.length > 1 ? 's' : ''}`, 
      progress: 0, 
      status: 'uploading',
      totalFiles: filesToUpload.length,
      totalImages: imagesToProcess
    }]);

    const formData = new FormData();
    filesToUpload.forEach(file => {
      formData.append('photos', file);
    });

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
        const result = JSON.parse(xhr.responseText);
        
        // Phase 3: Post-processing - Generate thumbnails
        setUploadProgress(prevProgress => 
          prevProgress.map(p => ({
          ...p, 
          progress: 100, 
          status: 'post-processing',
          name: `Processing ${p.totalImages} image${p.totalImages > 1 ? 's' : ''} (generating thumbnails...)`
        }))
      );
      
      // Call thumbnail generation endpoint
      try {
        const thumbnailResult = await apiGenerateThumbnails(projectFolder);
        console.log('Thumbnail generation result:', thumbnailResult);
        
        setUploadProgress(
          prevProgress => prevProgress.map(p => ({ 
            ...p, 
            status: 'completed',
            name: `Successfully uploaded ${p.totalImages} image${p.totalImages > 1 ? 's' : ''} (${p.totalFiles} files)! Generated ${thumbnailResult.processed} thumbnails.`
          }))
        );
      } catch (err) {
        console.warn('Thumbnail generation failed:', err);
        setUploadProgress(
          prevProgress => prevProgress.map(p => ({ 
            ...p, 
            status: 'completed',
            name: `Successfully uploaded ${p.totalImages} image${p.totalImages > 1 ? 's' : ''} (${p.totalFiles} files)! (Thumbnail generation failed)`
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

      {/* Confirmation UI */}
      {showConfirmation && analysisResult && (
        <div className="bg-white rounded-lg shadow-sm border-2 border-blue-200 p-6">
          <h4 className="text-lg font-medium text-gray-900 mb-4">📋 Upload Confirmation</h4>
          
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

            {/* Format Completions Info */}
            {analysisResult.summary.completionImages > 0 && (
              <div className="border border-green-200 rounded-lg p-4 mb-4">
                <h5 className="font-medium text-green-900 mb-2">✅ Format Completions ({analysisResult.summary.completionImages})</h5>
                <p className="text-sm text-green-700 mb-2">
                  These files will add new formats to existing images (e.g., adding JPG to RAW-only images).
                </p>
                {expandedDetails && (
                  <div className="space-y-2 text-sm">
                    {Object.values(analysisResult.imageGroups)
                      .filter(group => group.conflictType === 'completion')
                      .map((group, index) => (
                        <div key={index} className="bg-green-50 rounded p-2">
                          <div className="font-medium text-green-900">{group.baseName}</div>
                          <div className="text-green-700 text-xs">
                            Adding: {group.files.map(f => f.name).join(', ')}
                          </div>
                        </div>
                      ))
                    }
                  </div>
                )}
              </div>
            )}
            
            {/* Conflict Details */}
            {analysisResult.summary.conflictImages > 0 && (
              <div className="border border-orange-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h5 className="font-medium text-orange-900">⚠️ True duplicates ({analysisResult.summary.duplicateImages})</h5>
                  <button
                    onClick={() => setExpandedDetails(!expandedDetails)}
                    className="text-sm text-orange-700 hover:text-orange-900"
                  >
                    {expandedDetails ? 'Hide details' : 'Show details'}
                  </button>
                </div>
                
                {/* Skip/Overwrite Switch */}
                <div className="mb-3 p-3 bg-orange-50 rounded">
                  <div className="flex items-center space-x-3">
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={skipDuplicates}
                        onChange={(e) => setSkipDuplicates(e.target.checked)}
                        className="mr-2"
                      />
                      <span className="text-sm font-medium text-orange-900">
                        Skip duplicate files (recommended)
                      </span>
                    </label>
                  </div>
                  <p className="text-xs text-orange-700 mt-1">
                    {skipDuplicates 
                      ? `Will upload ${analysisResult.summary.newImages + analysisResult.summary.completionImages} images (${analysisResult.summary.newImages} new + ${analysisResult.summary.completionImages} completions)` 
                      : `Will overwrite ${analysisResult.summary.duplicateImages} duplicate images and upload ${analysisResult.summary.newImages + analysisResult.summary.completionImages} others`}
                  </p>
                </div>
                
                {expandedDetails && (
                  <div className="space-y-2 text-sm">
                    {Object.values(analysisResult.imageGroups)
                      .filter(group => group.conflictType === 'duplicate')
                      .map((group, index) => (
                        <div key={index} className="bg-orange-50 rounded p-2">
                          <div className="font-medium text-orange-900">{group.baseName}</div>
                          <div className="text-orange-700 text-xs">
                            Duplicate files: {group.files.map(f => f.name).join(', ')}
                          </div>
                        </div>
                      ))
                    }
                  </div>
                )}
                
                <p className="text-sm text-orange-700 mt-2">
                  {skipDuplicates 
                    ? 'These duplicate files will be skipped during upload.' 
                    : 'These duplicate files will overwrite existing files with the same format.'}
                </p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex space-x-3 pt-4">
              <button
                onClick={proceedWithUpload}
                className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Proceed with Upload
              </button>
              <button
                onClick={cancelUpload}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                Cancel
              </button>
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
