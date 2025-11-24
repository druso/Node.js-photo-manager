# Implement Resumable File Uploads with tus Protocol

## Priority
**Medium** - This will significantly improve upload reliability for large files and slow connections, especially when using Cloudflare Tunnel.

## Problem Statement

Currently, file uploads can fail when:
1. Network connection is interrupted during upload
2. Large files exceed Cloudflare Tunnel's 100-second timeout
3. Browser tab is closed or refreshed during upload
4. SSE connection drops causing UI confusion

When an upload fails, users must restart from the beginning, wasting bandwidth and time.

## Proposed Solution

Implement **resumable uploads** using the [tus protocol](https://tus.io/), an open protocol for resumable file uploads based on HTTP.

### Why tus?

- **Industry standard**: Used by Vimeo, Cloudflare, and many others
- **Resumable**: Uploads can resume from where they left off after interruption
- **Chunked**: Files are uploaded in small chunks, avoiding timeout issues
- **Reliable**: Handles network errors gracefully
- **Well-supported**: Mature libraries for both client and server

## Implementation Plan

### Phase 1: Backend Implementation

#### 1.1 Install tus-node-server

```bash
npm install tus-node-server
```

#### 1.2 Create tus Upload Endpoint

Create `server/routes/tusUploads.js`:

```javascript
const { Server } = require('tus-node-server');
const { FileStore } = require('tus-node-server');
const path = require('path');

// Configure tus server
const tusServer = new Server({
  path: '/api/uploads/tus',
  datastore: new FileStore({
    directory: path.join(__dirname, '../../.uploads-temp')
  }),
  // Cloudflare-friendly chunk size (5MB)
  maxSize: 100 * 1024 * 1024, // 100MB max file size
  respectForwardedHeaders: true,
  onUploadFinish: async (req, res, upload) => {
    // Move file to project directory
    // Extract metadata from upload
    // Create photo record in database
    // Trigger post-processing
  }
});
```

#### 1.3 Add tus Route to Express

In `server.js`:

```javascript
const tusUploadsRouter = require('./server/routes/tusUploads');
app.all('/api/uploads/tus/*', authenticateAdmin, tusUploadsRouter);
```

### Phase 2: Frontend Implementation

#### 2.1 Install tus-js-client

```bash
cd client
npm install tus-js-client
```

#### 2.2 Create Resumable Upload Service

Create `client/src/api/resumableUpload.js`:

```javascript
import * as tus from 'tus-js-client';

export function uploadFileResumable(file, options = {}) {
  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: '/api/uploads/tus',
      retryDelays: [0, 1000, 3000, 5000],
      chunkSize: 5 * 1024 * 1024, // 5MB chunks
      metadata: {
        filename: file.name,
        filetype: file.type,
        projectFolder: options.projectFolder,
      },
      onError: (error) => {
        console.error('Upload failed:', error);
        reject(error);
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        const percentage = ((bytesUploaded / bytesTotal) * 100).toFixed(2);
        if (options.onProgress) {
          options.onProgress(percentage, bytesUploaded, bytesTotal);
        }
      },
      onSuccess: () => {
        console.log('Upload finished:', upload.url);
        resolve(upload.url);
      }
    });

    // Start upload
    upload.start();

    // Return upload instance for pause/resume/abort
    return upload;
  });
}
```

#### 2.3 Update UploadContext.jsx

Replace XHR-based upload with tus-based upload:

```javascript
// Instead of FormData + XHR
const upload = uploadFileResumable(file, {
  projectFolder,
  onProgress: (pct, loaded, total) => {
    // Update progress UI
  }
});
```

### Phase 3: Enhanced Features

#### 3.1 Upload Persistence

Store upload state in localStorage to resume after browser restart:

```javascript
// Save upload state
localStorage.setItem(`upload_${fileId}`, JSON.stringify({
  url: upload.url,
  bytesUploaded: bytesUploaded,
  file: { name, size, type }
}));

// Resume on page load
const savedUploads = getSavedUploads();
savedUploads.forEach(state => resumeUpload(state));
```

#### 3.2 Pause/Resume UI

Add pause/resume buttons to upload progress bar:

```jsx
<button onClick={() => upload.abort()}>Pause</button>
<button onClick={() => upload.start()}>Resume</button>
```

#### 3.3 Background Uploads

Continue uploads even when user navigates away from upload page.

## Benefits

✅ **Reliability**: Uploads survive network interruptions  
✅ **Performance**: Chunked uploads avoid timeouts  
✅ **User Experience**: Resume instead of restart  
✅ **Bandwidth**: Don't re-upload already transferred data  
✅ **Cloudflare Compatible**: Small chunks work within limits  

## Estimated Effort

- **Backend**: 4-6 hours
- **Frontend**: 6-8 hours
- **Testing**: 2-4 hours
- **Total**: 12-18 hours

## Testing Strategy

1. **Unit tests**: Test tus endpoint with various file sizes
2. **Integration tests**: Test upload → processing pipeline
3. **Manual tests**:
   - Upload large file (>100MB)
   - Interrupt network mid-upload, resume
   - Close browser tab mid-upload, resume on reopen
   - Upload multiple files simultaneously

## Migration Strategy

1. **Parallel implementation**: Keep existing upload working
2. **Feature flag**: Enable tus uploads for testing
3. **Gradual rollout**: Enable for all users after testing
4. **Fallback**: Keep old upload as backup for 1-2 releases

## References

- [tus Protocol Specification](https://tus.io/protocols/resumable-upload.html)
- [tus-js-client Documentation](https://github.com/tus/tus-js-client)
- [tus-node-server Documentation](https://github.com/tus/tus-node-server)
- [Cloudflare + tus Best Practices](https://developers.cloudflare.com/workers/examples/upload-resumable/)

## Related Issues

- Current issue: Uploads fail with >4 files through Cloudflare Tunnel
- SSE connection drops during long uploads
- No way to resume failed uploads

## Acceptance Criteria

- [ ] Users can upload files >100MB reliably
- [ ] Uploads resume automatically after network interruption
- [ ] Upload progress persists across browser refresh
- [ ] Chunked uploads work within Cloudflare Tunnel limits
- [ ] Existing upload functionality remains working during rollout
- [ ] All tests pass
