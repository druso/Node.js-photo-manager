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

// Ensure projects directory exists
const PROJECTS_DIR = path.join(__dirname, '.projects');
fs.ensureDirSync(PROJECTS_DIR);

// Config management
const CONFIG_PATH = path.join(__dirname, 'config.json');
const DEFAULT_CONFIG_PATH = path.join(__dirname, 'config.default.json');

const loadConfig = () => {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.copySync(DEFAULT_CONFIG_PATH, CONFIG_PATH);
  }
  return fs.readJsonSync(CONFIG_PATH);
};

let config = loadConfig();

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
app.get('/api/projects', async (req, res) => {
  try {
    const projects = [];
    const projectDirs = await fs.readdir(PROJECTS_DIR);
    
    for (const dir of projectDirs) {
      const projectPath = path.join(PROJECTS_DIR, dir);
      const stat = await fs.stat(projectPath);
      
      if (stat.isDirectory()) {
        const manifest = await loadManifest(projectPath);
        if (manifest) {
          projects.push({
            name: manifest.project_name,
            folder: dir,
            created_at: manifest.created_at,
            updated_at: manifest.updated_at,
            photo_count: manifest.entries.length
          });
        }
      }
    }
    
    res.json(projects);
  } catch (error) {
    console.error('Error getting projects:', error);
    res.status(500).json({ error: 'Failed to get projects' });
  }
});

// Create new project
app.post('/api/projects', async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Project name is required' });
    }
    
    // Create safe folder name
    const folderName = name.replace(/[^a-zA-Z0-9\s-_]/g, '').replace(/\s+/g, '_');
    const projectPath = path.join(PROJECTS_DIR, folderName);
    
    // Check if project already exists
    if (await fs.pathExists(projectPath)) {
      return res.status(400).json({ error: 'Project already exists' });
    }
    
    // Create project directory and subdirectories
    await fs.ensureDir(projectPath);
    await fs.ensureDir(path.join(projectPath, '.thumb'));
    
    // Create initial manifest
    const manifest = createManifest(name);
    await saveManifest(projectPath, manifest);
    
    res.json({ 
      message: 'Project created successfully',
      project: {
        name: manifest.project_name,
        folder: folderName,
        created_at: manifest.created_at,
        updated_at: manifest.updated_at,
        photo_count: 0
      }
    });
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// Get project details
app.get('/api/projects/:folder', async (req, res) => {
  try {
    const { folder } = req.params;
    const projectPath = path.join(PROJECTS_DIR, folder);
    
    if (!await fs.pathExists(projectPath)) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const manifest = await loadManifest(projectPath);
    if (!manifest) {
      return res.status(404).json({ error: 'Project manifest not found' });
    }

    // Rename 'entries' to 'photos' to match frontend expectations
    const projectData = {
      ...manifest,
      photos: manifest.entries || []
    };
    delete projectData.entries;
    
    res.json(projectData);
  } catch (error) {
    console.error('Error getting project details:', error);
    res.status(500).json({ error: 'Failed to get project details' });
  }
});

// Upload photos to project
app.post('/api/projects/:folder/upload', upload.array('photos'), async (req, res) => {
  try {
    const { folder } = req.params;
    const projectPath = path.join(PROJECTS_DIR, folder);
    
    if (!await fs.pathExists(projectPath)) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const manifest = await loadManifest(projectPath);
    if (!manifest) {
      return res.status(404).json({ error: 'Project manifest not found' });
    }
    
    const uploadedFiles = [];
    
    for (const file of req.files) {
      const originalName = path.parse(file.originalname).name;
      const ext = path.extname(file.originalname).toLowerCase();
      const fileType = getFileType(file.originalname);
      
      // Save original file
      const filePath = path.join(projectPath, file.originalname);
      await fs.writeFile(filePath, file.buffer);
      
      // Skip thumbnail generation during upload - will be handled in Phase 3
      const isRawFile = /\.(arw|cr2|nef|dng|raw)$/i.test(ext);
      console.log(`Deferring thumbnail generation for ${file.originalname} (RAW: ${isRawFile})`);
      
      // SCHEMA_ENFORCEMENT: Extract EXIF data according to schema definition (skip RAW files)
      let metadata = {};
      
      if (!isRawFile) {
        try {
          const parser = ExifParser.create(file.buffer);
          const result = parser.parse();
          
          if (result && result.tags) {
            metadata = {
              // Legacy fields (keeping for backward compatibility)
              date_time_original: result.tags.DateTimeOriginal ? new Date(result.tags.DateTimeOriginal * 1000).toISOString() : null,
              camera_model: result.tags.Model || null,
              camera_make: result.tags.Make || null,
              
              // New EXIF fields as requested
              make: result.tags.Make || null,
              model: result.tags.Model || null,
              exif_image_width: result.tags.ExifImageWidth || null,
              exif_image_height: result.tags.ExifImageHeight || null,
              orientation: result.tags.Orientation || null
            };
              
            // Clean up null values to keep metadata object clean
            Object.keys(metadata).forEach(key => {
              if (metadata[key] === null) {
                delete metadata[key];
              }
            });
          }
        } catch (err) {
          console.error(`EXIF parsing error for ${file.originalname}:`, err.message);
        }
      }
      
      // Set thumbnail status for tracking
      const thumbnailStatus = isRawFile ? 'not_supported' : 'pending';

      // SCHEMA_ENFORCEMENT: Update manifest with schema-compliant photo entry creation
      let entry = manifest.entries.find(e => e.filename === originalName);
      if (entry) {
        // Update existing entry - properly track multiple file types
        console.log(`Updating existing entry for ${originalName}, adding ${fileType} file`);
        
        // Update file type availability flags
        if (fileType === 'jpg') {
          entry.jpg_available = true;
        } else if (fileType === 'raw') {
          entry.raw_available = true;
        } else if (fileType === 'other') {
          entry.other_available = true;
        }
        
        // Update metadata if available (prefer JPG metadata over RAW)
        if (Object.keys(metadata).length > 0) {
          if (fileType === 'jpg' || !entry.metadata || Object.keys(entry.metadata).length === 0) {
            entry.metadata = { ...entry.metadata, ...metadata };
            console.log(`Updated metadata for ${originalName} from ${fileType} file`);
          }
        }
        
        // Update thumbnail status (prefer 'pending' for JPG files)
        if (fileType === 'jpg' || entry.thumbnail_status === 'failed') {
          entry.thumbnail_status = thumbnailStatus;
        }
        
        // Update timestamp
        entry.updated_at = getCurrentTimestamp();
        
        // SCHEMA_ENFORCEMENT: Validate updated entry
        const entryValidation = validatePhotoEntry(entry);
        if (!entryValidation.valid) {
          console.error(`Updated photo entry validation failed for ${originalName}:`, entryValidation.errors);
        }
      } else {
        // SCHEMA_ENFORCEMENT: Create new entry using schema-compliant function
        console.log(`Creating new entry for ${originalName} with ${fileType} file`);
        entry = createDefaultPhotoEntry(originalName, fileType, metadata);
        // Add thumbnail status to new entry
        entry.thumbnail_status = thumbnailStatus;
        
        // SCHEMA_ENFORCEMENT: Validate new entry before adding to manifest
        const entryValidation = validatePhotoEntry(entry);
        if (!entryValidation.valid) {
          console.error(`New photo entry validation failed for ${originalName}:`, entryValidation.errors);
          throw new Error(`Cannot create invalid photo entry: ${entryValidation.errors.join(', ')}`);
        }
        
        manifest.entries.push(entry);
      }
      
      uploadedFiles.push({
        filename: file.originalname,
        size: file.size,
        type: fileType
      });
    }
    
    await saveManifest(projectPath, manifest);
    
    res.json({
      message: `Successfully uploaded ${uploadedFiles.length} files`,
      files: uploadedFiles
    });
  } catch (error) {
    console.error('Error uploading files:', error);
    res.status(500).json({ error: 'Failed to upload files' });
  }
});

// Phase 1: Analyze files for upload (backend-driven duplicate detection)
app.post('/api/projects/:folder/analyze-files', async (req, res) => {
  try {
    const { folder } = req.params;
    const { files } = req.body; // Array of { name, size, type }
    const projectPath = path.join(PROJECTS_DIR, folder);
    
    if (!await fs.pathExists(projectPath)) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Load manifest for existing entries
    const manifest = await loadManifest(projectPath);
    if (!manifest) {
      return res.status(404).json({ error: 'Project manifest not found' });
    }
    
    // Get actual files in project folder
    const actualFiles = await fs.readdir(projectPath);
    const actualImageFiles = actualFiles.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.jpg', '.jpeg', '.png', '.arw', '.cr2', '.nef', '.dng', '.raw', '.tiff', '.webp'].includes(ext);
    });
    
    console.log(`Analyzing ${files.length} files for project ${folder}`);
    
    // Group uploaded files by base name
    const imageGroups = {};
    files.forEach(file => {
      const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
      const ext = path.extname(file.name).toLowerCase();
      const fileType = getFileType(file.name);
      
      if (!imageGroups[baseName]) {
        imageGroups[baseName] = {
          baseName,
          files: [],
          isNew: true,
          hasConflict: false,
          conflictType: null,
          analysis: []
        };
      }
      
      imageGroups[baseName].files.push({
        name: file.name,
        size: file.size,
        type: file.type,
        extension: ext,
        fileType: fileType
      });
    });
    
    // Analyze each image group
    Object.values(imageGroups).forEach(group => {
      const existingEntry = manifest.entries.find(e => e.filename === group.baseName);
      
      if (existingEntry) {
        // Analyzing existing image for format completion/duplicates
        
        let duplicateFiles = [];
        let completionFiles = [];
        let exactDuplicateFiles = [];
        
        group.files.forEach(fileInfo => {
          const isJpg = ['jpg', 'jpeg'].includes(fileInfo.fileType);
          const isRaw = fileInfo.fileType === 'raw';
          const isOther = fileInfo.fileType === 'other';
          
          // Check if this exact file already exists in folder
          const fileExistsInFolder = actualImageFiles.includes(fileInfo.name);
          
          if (fileExistsInFolder) {
            group.analysis.push(`File ${fileInfo.name} already exists in folder (exact duplicate)`);
            exactDuplicateFiles.push(fileInfo.name);
          } else if (isJpg && existingEntry.jpg_available) {
            group.analysis.push(`JPG format already exists for ${group.baseName} (would overwrite)`);
            duplicateFiles.push(fileInfo.name);
          } else if (isRaw && existingEntry.raw_available) {
            group.analysis.push(`RAW format already exists for ${group.baseName} (would overwrite)`);
            duplicateFiles.push(fileInfo.name);
          } else if (isOther && existingEntry.other_available) {
            group.analysis.push(`Other format already exists for ${group.baseName} (would overwrite)`);
            duplicateFiles.push(fileInfo.name);
          } else if (isJpg && !existingEntry.jpg_available) {
            group.analysis.push(`Adding JPG format to existing ${group.baseName} (format completion)`);
            completionFiles.push(fileInfo.name);
          } else if (isRaw && !existingEntry.raw_available) {
            group.analysis.push(`Adding RAW format to existing ${group.baseName} (format completion)`);
            completionFiles.push(fileInfo.name);
          } else if (isOther && !existingEntry.other_available) {
            group.analysis.push(`Adding other format to existing ${group.baseName} (format completion)`);
            completionFiles.push(fileInfo.name);
          }
        });
        
        // Set conflict status based on analysis - prioritize format completion
        if (completionFiles.length > 0) {
          // If there are any format completions, treat as completion
          // (even if some files are duplicates, the new formats are valuable)
          group.isNew = false;
          group.hasConflict = false;
          group.conflictType = 'completion';
          if (duplicateFiles.length > 0 || exactDuplicateFiles.length > 0) {
            group.analysis.push(`Mixed scenario: ${completionFiles.length} new format(s), ${duplicateFiles.length + exactDuplicateFiles.length} duplicate(s)`);
          }
        } else if (duplicateFiles.length > 0 || exactDuplicateFiles.length > 0) {
          // Only duplicates, no new formats
          group.isNew = false;
          group.hasConflict = true;
          group.conflictType = 'duplicate';
        }
      } else {
        group.analysis.push(`New image ${group.baseName}`);
        group.isNew = true;
        group.hasConflict = false;
      }
    });
    
    // Generate summary
    const summary = {
      totalImages: Object.keys(imageGroups).length,
      totalFiles: files.length,
      newImages: Object.values(imageGroups).filter(g => g.isNew).length,
      conflictImages: Object.values(imageGroups).filter(g => g.hasConflict).length,
      completionImages: Object.values(imageGroups).filter(g => g.conflictType === 'completion').length,
      duplicateImages: Object.values(imageGroups).filter(g => g.conflictType === 'duplicate').length
    };
    
    console.log(`Analysis complete: ${summary.totalImages} images, ${summary.newImages} new, ${summary.completionImages} completions, ${summary.duplicateImages} duplicates`);
    
    res.json({
      success: true,
      imageGroups,
      summary,
      analysis: 'File analysis completed successfully'
    });
    
  } catch (error) {
    console.error('Error analyzing files:', error);
    res.status(500).json({ error: 'Failed to analyze files' });
  }
});

// Phase 3: Generate thumbnails for uploaded photos
app.post('/api/projects/:folder/generate-thumbnails', async (req, res) => {
  try {
    const { folder } = req.params;
    const projectPath = path.join(PROJECTS_DIR, folder);
    
    if (!await fs.pathExists(projectPath)) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const manifest = await loadManifest(projectPath);
    if (!manifest) {
      return res.status(404).json({ error: 'Project manifest not found' });
    }
    
    // Find entries that need thumbnail generation (pending or failed)
    const pendingEntries = manifest.entries.filter(entry => 
      entry.thumbnail_status === 'pending' || entry.thumbnail_status === 'failed' || !entry.thumbnail_status
    );
    
    console.log(`Generating thumbnails for ${pendingEntries.length} images`);
    
    let processedCount = 0;
    const results = [];
    
    for (const entry of pendingEntries) {
      try {
        // Find a supported file format for this entry
        const supportedExtensions = ['.jpg', '.jpeg', '.JPG', '.JPEG', '.png', '.PNG', '.tiff', '.TIFF', '.webp', '.WEBP'];
        let sourceFile = null;
        
        // Look for source file (JPG preferred for thumbnail generation)
        const possibleFiles = [entry.filename, entry.filename.replace(/\.[^.]+$/, '.jpg'), entry.filename.replace(/\.[^.]+$/, '.jpeg')];
        for (const fileName of possibleFiles) {
          const filePath = path.join(projectPath, fileName);
          if (fs.existsSync(filePath)) {
            sourceFile = filePath;
            break;
          }
        }
        
        if (!sourceFile) {
          console.log(`No supported source file found for ${entry.filename}`);
          entry.thumbnail_status = 'failed';
          results.push({ filename: entry.filename, status: 'failed', reason: 'No supported source file' });
          continue;
        }
        
        // Generate thumbnail
        const thumbPath = path.join(projectPath, '.thumb', `${entry.filename}.jpg`);
        await fs.ensureDir(path.dirname(thumbPath));
        
        const sharpImage = sharp(sourceFile);
        
        // Get image metadata for orientation
        const imageMetadata = await sharpImage.metadata();
        // Generate thumbnail from source file  orientation: imageMetadata.orientation
        await sharpImage
          .rotate() // Auto-rotate based on EXIF orientation
          .resize(200, 200, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toFile(thumbPath);
        
        // Update entry status
        entry.thumbnail_status = 'generated';
        processedCount++;
        
        results.push({ filename: entry.filename, status: 'generated' });
        // Thumbnail generated successfully
        
      } catch (error) {
        console.error(`Failed to generate thumbnail for ${entry.filename}:`, error);
        entry.thumbnail_status = 'failed';
        results.push({ filename: entry.filename, status: 'failed', reason: error.message });
      }
    }
    
    // Save updated manifest
    await saveManifest(projectPath, manifest);
    
    res.json({
      message: `Generated ${processedCount} thumbnails`,
      processed: processedCount,
      total: pendingEntries.length,
      results: results
    });
    
  } catch (error) {
    console.error('Error generating thumbnails:', error);
    res.status(500).json({ error: 'Failed to generate thumbnails' });
  }
});

// Update tags for photos
app.put('/api/projects/:folder/tags', async (req, res) => {
  try {
    const { folder } = req.params;
    const { updates } = req.body; // Array of { filename, tags }
    
    const projectPath = path.join(PROJECTS_DIR, folder);
    
    if (!await fs.pathExists(projectPath)) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const manifest = await loadManifest(projectPath);
    if (!manifest) {
      return res.status(404).json({ error: 'Project manifest not found' });
    }
    
    let updatedCount = 0;
    
    // SCHEMA_ENFORCEMENT: Validate and update photo entries with tag changes
    for (const update of updates) {
      const entry = manifest.entries.find(e => e.filename === update.filename);
      if (entry) {
        // Validate tags array before updating
        if (!Array.isArray(update.tags)) {
          console.error(`Invalid tags for ${update.filename}: tags must be an array`);
          continue;
        }
        
        // Validate each tag is a string
        const invalidTags = update.tags.filter(tag => typeof tag !== 'string');
        if (invalidTags.length > 0) {
          console.error(`Invalid tag types for ${update.filename}: all tags must be strings`);
          continue;
        }
        
        entry.tags = update.tags;
        entry.updated_at = getCurrentTimestamp();
        
        // SCHEMA_ENFORCEMENT: Validate updated entry
        const entryValidation = validatePhotoEntry(entry);
        if (!entryValidation.valid) {
          console.error(`Photo entry validation failed after tag update for ${update.filename}:`, entryValidation.errors);
          // Continue processing other entries even if one fails validation
        }
        
        updatedCount++;
      }
    }
    
    await saveManifest(projectPath, manifest);
    
    res.json({
      message: `Updated tags for ${updatedCount} photos`,
      updated_count: updatedCount
    });
  } catch (error) {
    console.error('Error updating tags:', error);
    res.status(500).json({ error: 'Failed to update tags' });
  }
});

// Serve thumbnails
app.get('/api/projects/:folder/thumbnail/:filename', (req, res) => {
  const { folder, filename } = req.params;
  // FIX: The thumbnail is always a JPG, so add the extension.
  const thumbPath = path.join(PROJECTS_DIR, folder, '.thumb', `${filename}.jpg`);
  
  if (fs.existsSync(thumbPath)) {
    res.sendFile(path.resolve(thumbPath));
  } else {
    res.status(404).json({ error: 'Thumbnail not found' });
  }
});

// Serve original images
// Delete project
app.delete('/api/projects/:folder', async (req, res) => {
  try {
    const { folder } = req.params;
    const projectPath = path.join(PROJECTS_DIR, folder);

    if (!await fs.pathExists(projectPath)) {
      return res.status(404).json({ error: 'Project not found' });
    }

    await fs.remove(projectPath);

    res.json({ message: 'Project deleted successfully' });
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

app.get('/api/projects/:folder/image/:filename', async (req, res) => {
  const { folder, filename } = req.params;
  const projectPath = path.join(PROJECTS_DIR, folder);

  try {
    const manifest = await loadManifest(projectPath);
    if (!manifest) {
      return res.status(404).json({ error: 'Project manifest not found' });
    }

    const photoEntry = manifest.entries.find(e => e.filename === filename);
    if (!photoEntry) {
      return res.status(404).json({ error: 'Photo not found in manifest' });
    }

    // Prioritize JPG, then RAW, then any other file with that name
    let imagePath = null;
    const files = await fs.readdir(projectPath);

    if (photoEntry.jpg_available) {
      const jpgFile = files.find(f => path.parse(f).name === filename && getFileType(f) === 'jpg');
      if (jpgFile) imagePath = path.join(projectPath, jpgFile);
    } 
    
    if (!imagePath && photoEntry.raw_available) {
      const rawFile = files.find(f => path.parse(f).name === filename && getFileType(f) === 'raw');
      if (rawFile) imagePath = path.join(projectPath, rawFile);
    }

    if (imagePath && fs.existsSync(imagePath)) {
      res.sendFile(path.resolve(imagePath));
    } else {
      res.status(404).json({ error: 'Image file not found on disk' });
    }
  } catch (error) {
    console.error('Error serving image:', error);
    res.status(500).json({ error: 'Failed to serve image' });
  }
});

// Get config
app.get('/api/config', (req, res) => {
  res.json(config);
});

// Update config
app.post('/api/config', async (req, res) => {
  try {
    config = { ...config, ...req.body };
    await fs.writeJson(CONFIG_PATH, config, { spaces: 2 });
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
