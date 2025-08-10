const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const exifParser = require('exif-parser');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
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

// Ensure projects directory exists
const PROJECTS_DIR = path.join(__dirname, '.projects');
fs.ensureDirSync(PROJECTS_DIR);

// Config management (centralized in service)
const CONFIG_PATH = path.join(__dirname, 'config.json');
const { getConfig } = require('./server/services/config');
let config = getConfig();

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

// SCHEMA_ENFORCEMENT: Import manifest schema for validation and default value generation
const {
  validateManifest,
  validatePhotoEntry,
  createDefaultManifest,
  createDefaultPhotoEntry,
  getCurrentTimestamp,
  migrateManifest
} = require('./schema/manifest-schema');

// Utility functions
const getFileType = (filename) => {
  const ext = path.extname(filename).toLowerCase();
  if (['.jpg', '.jpeg'].includes(ext)) return 'jpg';
  if (['.raw', '.cr2', '.nef', '.arw', '.dng'].includes(ext)) return 'raw';
  return 'other';
};

// SCHEMA_ENFORCEMENT: Use schema-compliant manifest creation
const createManifest = (projectName) => {
  const manifest = createDefaultManifest(projectName);
  
  // Validate the created manifest
  const validation = validateManifest(manifest);
  if (!validation.valid) {
    console.error('Created manifest failed validation:', validation.errors);
    throw new Error('Failed to create valid manifest: ' + validation.errors.join(', '));
  }
  
  return manifest;
};

// SCHEMA_ENFORCEMENT: Load manifest with validation and migration
const loadManifest = async (projectPath) => {
  const manifestPath = path.join(projectPath, 'manifest.json');
  try {
    const data = await fs.readFile(manifestPath, 'utf8');
    let manifest = JSON.parse(data);
    
    // Migrate manifest if needed (handles schema evolution)
    manifest = migrateManifest(manifest);
    
    // Validate the loaded manifest
    const validation = validateManifest(manifest);
    if (!validation.valid) {
      console.error(`Manifest validation failed for ${projectPath}:`, validation.errors);
      // Log but don't throw - allow app to continue with potentially corrupted data
      // In production, you might want to create a backup and attempt repair
    }
    
    return manifest;
  } catch (error) {
    console.error(`Failed to load manifest from ${projectPath}:`, error.message);
    return null;
  }
};

// SCHEMA_ENFORCEMENT: Save manifest with validation
const saveManifest = async (projectPath, manifest) => {
  const manifestPath = path.join(projectPath, 'manifest.json');
  
  // Update timestamp before validation
  manifest.updated_at = getCurrentTimestamp();
  
  // Validate manifest before saving
  const validation = validateManifest(manifest);
  if (!validation.valid) {
    console.error('Manifest validation failed before save:', validation.errors);
    throw new Error('Cannot save invalid manifest: ' + validation.errors.join(', '));
  }
  
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Manifest saved and validated for project: ${manifest.project_name}`);
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
});
