const express = require('express');
require('./server/utils/logger');
const multer = require('multer');
const sharp = require('sharp');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const exifParser = require('exif-parser');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
// Production CORS allowlist (configurable via ALLOWED_ORIGINS comma-separated). Defaults to localhost:3000 for dev.
const rawAllowed = process.env.ALLOWED_ORIGINS || 'http://localhost:3000';
const allowedOrigins = rawAllowed.split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: function(origin, cb) {
    // Allow same-origin/non-browser (no Origin header)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('CORS: Origin not allowed'));
  },
  credentials: false
}));
app.use(express.json());
app.use(express.static('public'));

// Routers
const projectsRouter = require('./server/routes/projects');
app.use('/api/projects', projectsRouter);
const uploadsRouter = require('./server/routes/uploads');
app.use('/api/projects', uploadsRouter);
const assetsRouter = require('./server/routes/assets');
app.use('/api/projects', assetsRouter);
const tagsRouter = require('./server/routes/tags');
app.use('/api/projects', tagsRouter);
const keepRouter = require('./server/routes/keep');
app.use('/api/projects', keepRouter);
// Maintenance routes
const maintenanceRouter = require('./server/routes/maintenance');
app.use('/api/projects', maintenanceRouter);
// Jobs routes
const jobsRouter = require('./server/routes/jobs');
app.use('/api', jobsRouter);

// Ensure projects directory exists
const PROJECTS_DIR = path.join(__dirname, '.projects');
fs.ensureDirSync(PROJECTS_DIR);

// Config management (centralized in service)
const CONFIG_PATH = path.join(__dirname, 'config.json');
const { getConfig } = require('./server/services/config');
let config = getConfig();

// Fail fast if DOWNLOAD_SECRET is not set properly in production when signed downloads are required
const REQUIRE_SIGNED = process.env.REQUIRE_SIGNED_DOWNLOADS !== 'false';
const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET || 'dev-download-secret-change-me';
if (process.env.NODE_ENV === 'production' && REQUIRE_SIGNED && DOWNLOAD_SECRET === 'dev-download-secret-change-me') {
  console.error('[SECURITY] DOWNLOAD_SECRET is using the insecure default in production. Set a strong secret in the environment.');
  process.exit(1);
}

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|tiff|tif|raw|cr2|nef|arw|dng/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype) || file.mimetype.startsWith('image/');
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  }
});



// Utility functions
const getFileType = (filename) => {
  const ext = path.extname(filename).toLowerCase();
  if (['.jpg', '.jpeg'].includes(ext)) return 'jpg';
  if (['.raw', '.cr2', '.nef', '.arw', '.dng'].includes(ext)) return 'raw';
  return 'other';
};



// Routes

// Get all projects
// Projects routes moved to server/routes/projects.js

// Create new project
// Projects routes moved to server/routes/projects.js

// Get project details
// Projects routes moved to server/routes/projects.js

// Delete project
// Projects routes moved to server/routes/projects.js

// Upload routes moved to server/routes/uploads.js

// Analyze/upload routes moved to server/routes/uploads.js

// Phase 3: Generate thumbnails for uploaded photos
// Thumbnail generation moved to server/routes/uploads.js

// Tags routes moved to server/routes/tags.js

// Assets routes moved to server/routes/assets.js

// Get config (ensure merged defaults)
app.get('/api/config', (req, res) => {
  try {
    config = getConfig();
    res.json(config);
  } catch (e) {
    console.error('Error loading config:', e);
    res.status(500).json({ error: 'Failed to load config' });
  }
});

// Update config
app.post('/api/config', async (req, res) => {
  try {
    // Save received config verbatim, then re-load merged defaults for response
    await fs.writeJson(CONFIG_PATH, req.body, { spaces: 2 });
    config = getConfig();
    res.json(config);
  } catch (error) {
    console.error('Error saving config:', error);
    res.status(500).json({ error: 'Failed to save config' });
  }
});

// Restore default config
app.post('/api/config/restore', async (req, res) => {
  try {
    fs.copySync(DEFAULT_CONFIG_PATH, CONFIG_PATH);
    config = fs.readJsonSync(CONFIG_PATH);
    res.json(config);
  } catch (error) {
    console.error('Error restoring default config:', error);
    res.status(500).json({ error: 'Failed to restore default config' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Projects directory: ${PROJECTS_DIR}`);
  // Start background worker loop
  try {
    const { startWorkerLoop } = require('./server/services/workerLoop');
    startWorkerLoop();
    console.log('Worker loop started');
    // Start scheduler to enqueue periodic maintenance jobs
    try {
      const { startScheduler } = require('./server/services/scheduler');
      startScheduler();
      console.log('Scheduler started');
    } catch (e) {
      console.error('Failed to start scheduler:', e);
    }
  } catch (e) {
    console.error('Failed to start worker loop:', e);
  }
});
