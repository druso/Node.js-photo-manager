const { parentPort } = require('worker_threads');
const sharp = require('sharp');
const fs = require('fs-extra');
const path = require('path');

/**
 * Image processing worker thread.
 * Receives tasks from the pool and processes images using Sharp.
 */

if (!parentPort) {
  throw new Error('This module must be run as a worker thread');
}

parentPort.on('message', async ({ jobId, task }) => {
  try {
    const result = await processImage(task);
    parentPort.postMessage({ jobId, result });
  } catch (err) {
    parentPort.postMessage({ 
      jobId, 
      error: err.message || String(err),
      stack: err.stack 
    });
  }
});

/**
 * Process a single image and generate all requested derivatives.
 * @param {Object} task
 * @param {string} task.sourcePath - Absolute path to source image
 * @param {Array} task.derivatives - Array of derivative specs
 * @returns {Promise<Array>} Results with metadata for each derivative
 */
async function processImage(task) {
  const { sourcePath, derivatives } = task;
  
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error(`Source file not found: ${sourcePath}`);
  }
  
  if (!Array.isArray(derivatives) || derivatives.length === 0) {
    throw new Error('No derivatives specified');
  }
  
  const results = [];
  
  for (const deriv of derivatives) {
    try {
      const result = await generateDerivative(sourcePath, deriv);
      results.push(result);
    } catch (err) {
      // Log error but continue with other derivatives
      results.push({
        type: deriv.type,
        error: err.message || String(err),
        outputPath: deriv.outputPath
      });
    }
  }
  
  return results;
}

/**
 * Generate a single derivative using Sharp.
 * @param {string} sourcePath - Source image path
 * @param {Object} deriv - Derivative specification
 * @returns {Promise<Object>} Metadata about generated derivative
 */
async function generateDerivative(sourcePath, deriv) {
  const { type, width, height, quality, outputPath } = deriv;
  
  // Ensure output directory exists
  await fs.ensureDir(path.dirname(outputPath));
  
  // Create Sharp pipeline
  let pipeline = sharp(sourcePath)
    .rotate(); // Auto-rotate based on EXIF orientation
  
  // Resize if dimensions specified
  if (width || height) {
    pipeline = pipeline.resize(width, height, {
      fit: 'inside',
      withoutEnlargement: true
    });
  }
  
  // Convert to JPEG with progressive encoding
  const jpegQuality = Math.max(1, Math.min(100, Number(quality) || 80));
  pipeline = pipeline.jpeg({
    quality: jpegQuality,
    progressive: true, // Enable progressive JPEG for better loading experience
    mozjpeg: true // Use mozjpeg for better compression if available
  });
  
  // Generate the file
  const output = await pipeline.toFile(outputPath);
  
  return {
    type,
    outputPath,
    width: output.width,
    height: output.height,
    size: output.size,
    format: output.format,
    channels: output.channels
  };
}

// Handle uncaught errors in worker
process.on('uncaughtException', (err) => {
  // Send error to parent and exit
  if (parentPort) {
    parentPort.postMessage({
      jobId: null,
      error: `Worker uncaught exception: ${err.message}`,
      stack: err.stack
    });
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  // Send error to parent and exit
  if (parentPort) {
    parentPort.postMessage({
      jobId: null,
      error: `Worker unhandled rejection: ${reason}`,
      stack: reason?.stack
    });
  }
  process.exit(1);
});
