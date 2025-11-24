import * as tus from 'tus-js-client';

/**
 * Upload a file using the tus resumable upload protocol
 * 
 * @param {File} file - The file to upload
 * @param {Object} options - Upload options
 * @param {string} options.projectFolder - The project folder to upload to
 * @param {Function} options.onProgress - Progress callback (percentage, bytesUploaded, bytesTotal)
 * @param {Function} options.onError - Error callback
 * @param {Function} options.onSuccess - Success callback (uploadUrl)
 * @returns {tus.Upload} - The tus upload instance (for pause/resume/abort)
 */
export function uploadFileResumable(file, options = {}) {
    const {
        projectFolder,
        onProgress,
        onError,
        onSuccess
    } = options;

    if (!projectFolder) {
        const error = new Error('projectFolder is required for resumable upload');
        if (onError) onError(error);
        throw error;
    }

    const upload = new tus.Upload(file, {
        // Endpoint for tus uploads
        endpoint: '/api/uploads/tus/files',

        // Retry configuration (exponential backoff)
        retryDelays: [0, 1000, 3000, 5000, 10000],

        // Chunk size: 5MB (Cloudflare-friendly)
        chunkSize: 5 * 1024 * 1024,

        // Metadata to send with upload
        metadata: {
            filename: file.name,
            filetype: file.type,
            projectFolder: projectFolder,
        },

        // Store upload URL in localStorage for resumability across page reloads
        storeFingerprintForResuming: true,

        // Remove fingerprint after successful upload
        removeFingerprintOnSuccess: true,

        // Callbacks
        onError: (error) => {
            console.error('[tus] Upload failed:', error);
            if (onError) {
                onError(error);
            }
        },

        onProgress: (bytesUploaded, bytesTotal) => {
            const percentage = ((bytesUploaded / bytesTotal) * 100).toFixed(2);
            if (onProgress) {
                onProgress(parseFloat(percentage), bytesUploaded, bytesTotal);
            }
        },

        onSuccess: () => {
            console.log('[tus] Upload finished:', upload.url);
            if (onSuccess) {
                onSuccess(upload.url);
            }
        },

        // Called before upload starts (useful for logging)
        onBeforeRequest: (req) => {
            // Add any custom headers if needed
            // req.setHeader('X-Custom-Header', 'value');
        },

        // Called after each chunk is uploaded
        onAfterResponse: (req, res) => {
            // Useful for debugging
            // console.log('[tus] Chunk uploaded, status:', res.getStatus());
        }
    });

    return upload;
}

/**
 * Resume an upload from localStorage
 * 
 * @param {string} uploadUrl - The tus upload URL to resume
 * @param {File} file - The original file object
 * @param {Object} options - Same options as uploadFileResumable
 * @returns {tus.Upload} - The resumed upload instance
 */
export function resumeUpload(uploadUrl, file, options = {}) {
    const upload = uploadFileResumable(file, options);

    // Set the upload URL to resume from
    upload.url = uploadUrl;

    return upload;
}

/**
 * Get all saved upload URLs from localStorage
 * This can be used to resume uploads after page reload
 * 
 * @returns {Array<{url: string, fingerprint: string}>}
 */
export function getSavedUploads() {
    const uploads = [];

    // tus-js-client stores fingerprints in localStorage with keys like:
    // tus::fingerprint::<fingerprint>
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('tus::')) {
            try {
                const value = localStorage.getItem(key);
                if (value) {
                    const data = JSON.parse(value);
                    uploads.push({
                        fingerprint: key.replace('tus::', ''),
                        url: data.uploadUrl || data.url,
                        size: data.size,
                        offset: data.offset
                    });
                }
            } catch (err) {
                console.warn('[tus] Failed to parse saved upload:', key, err);
            }
        }
    }

    return uploads;
}

/**
 * Clear a saved upload from localStorage
 * 
 * @param {string} fingerprint - The upload fingerprint
 */
export function clearSavedUpload(fingerprint) {
    const key = `tus::${fingerprint}`;
    localStorage.removeItem(key);
}

/**
 * Clear all saved uploads from localStorage
 */
export function clearAllSavedUploads() {
    const uploads = getSavedUploads();
    uploads.forEach(upload => {
        clearSavedUpload(upload.fingerprint);
    });
}
