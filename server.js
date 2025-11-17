require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
// Remove global console timestamp prefixer to avoid duplicate timestamps with structured logger
// require('./server/utils/logger');
const makeLogger = require('./server/utils/logger2');
const log = makeLogger('server');
const { initAuth } = require('./server/services/auth/initAuth');

initAuth({ log });
// Upload handling and image processing are implemented in route/services modules
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const requestId = require('./server/middleware/requestId');
const accessLog = require('./server/middleware/accessLog');
const errorHandler = require('./server/middleware/errorHandler');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 5000;
const CLIENT_DIST_DIR = path.join(__dirname, 'client', 'dist');
const CLIENT_ASSETS_DIR = path.join(CLIENT_DIST_DIR, 'assets');

// Middleware
// Correlate requests early
app.use(requestId());
// Access log as early as possible to capture static file requests
app.use(accessLog());
app.use(express.json());
app.use(cookieParser());

// HTTP compression for API responses and static assets
// Configured to skip already-compressed content (images) and small responses
app.use(compression({
  filter: (req, res) => {
    // Allow disabling compression via header (useful for debugging)
    if (req.headers['x-no-compression']) {
      return false;
    }
    // Don't compress images - they're already compressed
    const contentType = res.getHeader('Content-Type');
    if (contentType && contentType.toString().startsWith('image/')) {
      return false;
    }
    // Use default compression filter for everything else (JSON, HTML, CSS, JS)
    return compression.filter(req, res);
  },
  level: 6, // Balance between speed and compression ratio
  threshold: 1024 // Only compress responses larger than 1KB
}));

// Explicit static mounts to serve built frontend
// Serve hashed assets with no fallthrough to avoid route interference
app.use('/assets', express.static(CLIENT_ASSETS_DIR, { fallthrough: false }));
// Serve other static files (index.html, icons, manifest). Allow fallthrough to API routes.
app.use(express.static(CLIENT_DIST_DIR));

// Apply CORS to API routes only (after static)
// Production CORS allowlist (configurable via ALLOWED_ORIGINS comma-separated).
// Dev-friendly defaults include common Vite/CRA ports and localhost/127.0.0.1 variants.
const rawAllowed = process.env.ALLOWED_ORIGINS || [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://localhost:5000',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5000',
  'https://photomanager-poc.dru.so'
].join(',');
const allowedOrigins = rawAllowed.split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: function(origin, cb) {
    // Allow same-origin/non-browser (no Origin header)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('CORS: Origin not allowed'));
  },
  credentials: true
}));

// Routers
const authRouter = require('./server/routes/auth');
app.use('/api/auth', authRouter);

const authenticateAdmin = require('./server/middleware/authenticateAdmin');
const { attachAdminToRequest } = authenticateAdmin;
const PUBLIC_ASSET_PATH = /^\/projects\/[^/]+\/(thumbnail|preview|image)\//;
const PUBLIC_HASH_METADATA_PATH = /^\/projects\/image\/[^/]+$/;
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) {
    return next();
  }
  // Allow SSE endpoints to pass through (they handle auth internally if needed)
  if (req.path.startsWith('/sse/')) {
    return next();
  }
  if (req.method === 'GET' && (PUBLIC_ASSET_PATH.test(req.path) || PUBLIC_HASH_METADATA_PATH.test(req.path))) {
    return next();
  }
  if (req.method === 'GET' && req.path === '/photos') {
    const publicLinkHash = typeof req.query?.public_link_id === 'string' && req.query.public_link_id.length > 0;
    if (publicLinkHash) {
      const attachResult = attachAdminToRequest(req);
      if (attachResult?.attached) {
        return next();
      }
      if (attachResult?.reason && attachResult.reason !== 'missing') {
        return res.status(401).json({ error: 'Authentication required' });
      }
      return next();
    }
  }
  return authenticateAdmin(req, res, next);
});

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
// All Photos (cross-project) route
const photosRouter = require('./server/routes/photos');
app.use('/api', photosRouter);
// Image-scoped actions (tags/keep, future process/move)
const photosActionsRouter = require('./server/routes/photosActions');
app.use('/api', photosActionsRouter);
// Public links (admin endpoints - require authentication)
const publicLinksRouter = require('./server/routes/publicLinks');
app.use('/api/public-links', authenticateAdmin, publicLinksRouter);
// Shared links (public endpoints - no authentication)
const sharedLinksRouter = require('./server/routes/sharedLinks');
app.use('/shared/api', sharedLinksRouter);
// SSE (Server-Sent Events) for real-time updates
const { router: sseRouter } = require('./server/routes/sse');
app.use('/api/sse', sseRouter);

// SPA fallback: send index.html for non-API routes so React Router can handle them
app.get(/^\/(?!api\b|shared\/api\b|assets\b).*/, (req, res, next) => {
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(CLIENT_DIST_DIR, 'index.html'));
});

// Centralized error handler (must be after routes)
app.use(errorHandler);

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
  log.error('insecure_download_secret', { note: 'Set a strong DOWNLOAD_SECRET in production' });
  process.exit(1);
}

// Routes are implemented in `server/routes/*`

// Get config (ensure merged defaults)
app.get('/api/config', (req, res) => {
  try {
    config = getConfig();
    res.json(config);
  } catch (e) {
    log.error('config_load_failed', { message: e?.message, stack: e?.stack });
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
    log.error('config_save_failed', { message: error?.message, stack: error?.stack });
    res.status(500).json({ error: 'Failed to save config' });
  }
});

// Restore default config
app.post('/api/config/restore', async (req, res) => {
  try {
    // Use config service to ensure consistent defaults restoration (if available)
    const DEFAULT_CONFIG_PATH = path.join(__dirname, 'config.default.json');
    fs.copySync(DEFAULT_CONFIG_PATH, CONFIG_PATH);
    config = fs.readJsonSync(CONFIG_PATH);
    res.json(config);
  } catch (error) {
    log.error('config_restore_failed', { message: error?.message, stack: error?.stack });
    res.status(500).json({ error: 'Failed to restore default config' });
  }
});

app.listen(PORT, () => {
  log.info('server_started', { port: PORT });
  log.info('projects_dir_ready', { dir: PROJECTS_DIR });
  // Start background worker loop
  try {
    const { startWorkerLoop } = require('./server/services/workerLoop');
    startWorkerLoop();
    log.info('worker_loop_started');
    // Start scheduler to enqueue periodic maintenance jobs
    try {
      const { startScheduler } = require('./server/services/scheduler');
      startScheduler();
      log.info('scheduler_started');
    } catch (e) {
      log.error('scheduler_start_failed', { message: e?.message, stack: e?.stack });
    }
  } catch (e) {
    log.error('worker_loop_start_failed', { message: e?.message, stack: e?.stack });
  }
});
