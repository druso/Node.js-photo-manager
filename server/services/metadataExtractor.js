const fs = require('fs-extra');
const path = require('path');
const exifParser = require('exif-parser');
const makeLogger = require('../utils/logger2');
const log = makeLogger('metadata-extractor');

// Size of buffer to read for EXIF extraction (128KB should be plenty for headers)
const EXIF_READ_BUFFER_SIZE = 128 * 1024;

/**
 * Extract EXIF metadata from an image file or buffer
 * Prefers DateTimeOriginal, falls back to CreateDate, then ModifyDate
 * 
 * @param {string|Buffer} input - File path or buffer
 * @returns {Promise<Object>} Metadata object with date_time_original, orientation, etc.
 */
async function extractMetadata(input) {
    try {
        let buffer;

        if (Buffer.isBuffer(input)) {
            buffer = input;
        } else if (typeof input === 'string') {
            // Read only the beginning of the file to avoid loading large files into memory
            // EXIF data is always at the start of the JPEG file
            const fd = await fs.open(input, 'r');
            try {
                const stats = await fs.fstat(fd);
                // Start with 256KB - 128KB proved too small for some files/tests
                let readSize = Math.min(stats.size, 256 * 1024);
                buffer = Buffer.alloc(readSize);
                await fs.read(fd, buffer, 0, readSize, 0);

                // Try parsing
                try {
                    const parser = exifParser.create(buffer);
                    const result = parser.parse();
                    return processResult(result);
                } catch (e) {
                    // If we get an offset error, it might mean the header is larger than our buffer
                    // Try reading more (up to 4MB)
                    if (e.message && e.message.includes('Invalid JPEG section offset') && stats.size > readSize) {
                        log.debug('retry_larger_buffer', { file: path.basename(input), error: e.message });
                        readSize = Math.min(stats.size, 4 * 1024 * 1024); // 4MB
                        buffer = Buffer.alloc(readSize);
                        // We need to read from the beginning again
                        await fs.read(fd, buffer, 0, readSize, 0);
                        const parser = exifParser.create(buffer);
                        const result = parser.parse();
                        return processResult(result);
                    }
                    throw e;
                }
            } finally {
                await fs.close(fd);
            }
        } else {
            throw new Error('Invalid input: must be file path or buffer');
        }

        // Fallback for buffer input
        const parser = exifParser.create(buffer);
        const result = parser.parse();
        return processResult(result);

    } catch (err) {
        const source = Buffer.isBuffer(input) ? 'buffer' : input;
        // Only log warnings for non-offset errors or if retry failed
        if (!err.message || !err.message.includes('Invalid JPEG section offset')) {
            log.warn('metadata_extraction_failed', {
                source: typeof source === 'string' ? require('path').basename(source) : 'buffer',
                error: err.message
            });
        }
    }

    return {
        date_time_original: null,
        orientation: null,
        meta_json: null
    };
}

function processResult(result) {
    if (result && result.tags) {
        // Prefer DateTimeOriginal (when photo was taken), fall back to CreateDate, then ModifyDate
        const captureTimestamp = result.tags.DateTimeOriginal || result.tags.CreateDate || result.tags.ModifyDate || null;

        const metadata = {
            date_time_original: captureTimestamp,
            create_date: result.tags.CreateDate || null,
            modify_date: result.tags.ModifyDate || null,
            orientation: result.tags.Orientation || null,
            camera_make: result.tags.Make || null,
            make: result.tags.Make || null,
            model: result.tags.Model || null,
            exif_image_width: result.tags.ExifImageWidth || null,
            exif_image_height: result.tags.ExifImageHeight || null
        };

        // Remove null values
        Object.keys(metadata).forEach(k => metadata[k] === null && delete metadata[k]);

        return {
            date_time_original: captureTimestamp ? new Date(captureTimestamp * 1000).toISOString() : null,
            orientation: metadata.orientation || null,
            meta_json: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
            // Return raw tags for internal use if needed
            _tags: metadata
        };
    }
    return { date_time_original: null, orientation: null, meta_json: null };
}

module.exports = {
    extractMetadata
};
