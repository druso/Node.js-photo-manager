import React from 'react';
import { useUpload } from '../upload/UploadContext';

const UploadConfirmModal = () => {
  const { state, actions } = useUpload();
  const { operation, analysisResult, summary, skipDuplicates } = state;

  const isPreparing = operation && operation.type === 'upload' && operation.phase === 'preparation';
  const showConfirm = operation && operation.type === 'upload' && operation.phase === 'idle' && analysisResult;
  const visible = isPreparing || showConfirm;

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={() => actions.cancel()} />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4">
        <div className="p-6">
          {isPreparing && (
            <div className="text-center py-8">
              <div className="text-5xl mb-4">⏳</div>
              <h3 className="text-lg font-semibold text-gray-900">Preparing the import…</h3>
              <p className="text-gray-600 mt-2">Analyzing dropped files</p>
            </div>
          )}

          {showConfirm && (
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Upload Confirmation</h3>

              {/* Summary */}
              <div className="bg-blue-50 rounded-lg p-4 mb-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="font-medium text-blue-900">Images to process:</span>
                    <span className="ml-2 text-blue-700">{summary?.totalImages ?? 0}</span>
                  </div>
                  <div>
                    <span className="font-medium text-blue-900">Total files:</span>
                    <span className="ml-2 text-blue-700">{summary?.totalFiles ?? 0}</span>
                  </div>
                  <div>
                    <span className="font-medium text-green-900">New images:</span>
                    <span className="ml-2 text-green-700">{summary?.newImages ?? 0}</span>
                  </div>
                  <div>
                    <span className="font-medium text-green-900">Format completions:</span>
                    <span className="ml-2 text-green-700">{summary?.completionImages ?? 0}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="font-medium text-orange-900">True duplicates:</span>
                    <span className="ml-2 text-orange-700">{summary?.duplicateImages ?? 0}</span>
                  </div>
                </div>
              </div>

              {/* Options */}
              <div className="flex items-center justify-between mb-4">
                <label className="flex items-center gap-2 text-sm text-gray-800">
                  <input
                    type="checkbox"
                    checked={!!skipDuplicates}
                    onChange={(e) => actions.setSkipDuplicates(e.target.checked)}
                  />
                  Skip duplicates (default)
                </label>
                <div className="text-xs text-gray-500">
                  Uncheck to overwrite duplicates
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 mt-6">
                <button
                  onClick={() => actions.cancel()}
                  className="px-4 py-2 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={() => actions.confirmUpload({ skip: skipDuplicates })}
                  className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700"
                >
                  Confirm & Upload
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default UploadConfirmModal;
