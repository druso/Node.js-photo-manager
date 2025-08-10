const sharp = require('sharp');
const fs = require('fs-extra');
const path = require('path');

/**
 * Generate a derivative JPEG (thumbnail or preview) from a source image.
 * - Rotates according to EXIF
 * - Optionally resizes to fit within maxDim (inside fit, no enlargement)
 * - Writes JPEG with specified quality
 * @param {string} sourceFile - absolute path to source image
 * @param {string} destFile - absolute path to output JPEG
 * @param {Object} opts
 * @param {number} opts.maxDim - maximum width/height in pixels (fit inside). If falsy, no resize.
 * @param {number} opts.quality - JPEG quality 1-100
 */
async function generateDerivative(sourceFile, destFile, opts = {}) {
  const { maxDim = null, quality = 80 } = opts;
  await fs.ensureDir(path.dirname(destFile));
  let img = sharp(sourceFile).rotate();
  if (maxDim && Number(maxDim) > 0) {
    img = img.resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true });
  }
  await img.jpeg({ quality: Math.max(1, Math.min(100, Number(quality) || 80)) }).toFile(destFile);
}

module.exports = { generateDerivative };
