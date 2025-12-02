const path = require('path');
const fs = require('fs-extra');
const { extractMetadata } = require('../metadataExtractor');
const photosRepo = require('../repositories/photosRepo');
const projectsRepo = require('../repositories/projectsRepo');
const { PROJECTS_DIR, DEFAULT_USER } = require('../fsUtils');
const { resolvePhotoPath } = require('../../utils/assetPaths');
const makeLogger = require('../../utils/logger2');
const log = makeLogger('metadata-regen-worker');

/**
 * Run metadata regeneration for all photos or a specific project
 */
async function runRegenerateMetadata(job) {
    const { project_id } = job;

    log.info('metadata_regen_started', { job_id: job.id, project_id });

    try {
        let processed = 0;
        let updated = 0;
        let failed = 0;
        let total = 0;

        // Calculate total first for progress reporting
        if (project_id) {
            total = photosRepo.countByProject(project_id);
        } else {
            // Global count - sum of all projects
            const projects = projectsRepo.list();
            for (const p of projects) {
                total += photosRepo.countByProject(p.id);
            }
        }

        // Report initial progress
        if (job.onProgress) {
            job.onProgress({ done: 0, total });
        }

        const BATCH_SIZE = 100;

        if (project_id) {
            // Single project scope
            await processProject(project_id, BATCH_SIZE);
        } else {
            // Global scope - iterate all projects
            const projects = projectsRepo.list();
            for (const p of projects) {
                await processProject(p.id, BATCH_SIZE);
            }
        }

        async function processProject(pid, batchSize) {
            const project = projectsRepo.getById(pid);
            if (!project) return;

            const projectPath = path.join(PROJECTS_DIR, DEFAULT_USER, project.project_folder);
            let offset = 0;

            while (true) {
                // Fetch batch
                const result = photosRepo.listPaged({
                    project_id: pid,
                    limit: batchSize,
                    cursor: offset.toString() // Using offset-based cursor logic from listPaged fallback
                });

                const photos = result.items;
                if (!photos || photos.length === 0) break;

                for (const photo of photos) {
                    try {
                        // Use helper to find file path with correct extension/case
                        const filePath = await resolvePhotoPath(projectPath, photo);

                        if (filePath) {
                            // Extract metadata using the optimized extractor
                            const metadata = await extractMetadata(filePath);

                            // Only update if we have valid metadata
                            if (metadata.date_time_original) {
                                const updatedPhoto = {
                                    ...photo,
                                    date_time_original: metadata.date_time_original,
                                    orientation: metadata.orientation || photo.orientation,
                                    meta_json: metadata.meta_json || photo.meta_json
                                };

                                photosRepo.upsertPhoto(photo.project_id, updatedPhoto);
                                updated++;
                            }
                        } else {
                            log.warn('file_not_found', { photo_id: photo.id, filename: photo.filename, ext: photo.ext });
                            failed++;
                        }
                    } catch (err) {
                        log.error('photo_regen_failed', { photo_id: photo.id, error: err.message });
                        failed++;
                    }

                    processed++;

                    // Report progress periodically
                    if (processed % 10 === 0 && job.onProgress) {
                        job.onProgress({ done: processed, total });
                    }
                }

                offset += photos.length;

                // Safety break if we're not making progress (shouldn't happen with offset)
                if (photos.length < batchSize) break;
            }
        }

        // Final progress
        if (job.onProgress) {
            job.onProgress({ done: total, total });
        }

        log.info('metadata_regen_complete', {
            job_id: job.id,
            processed,
            updated,
            failed
        });

        return { processed, updated, failed };
    } catch (err) {
        log.error('metadata_regen_job_failed', {
            job_id: job.id,
            error: err.message,
            stack: err.stack
        });
        throw err;
    }
}

module.exports = {
    runRegenerateMetadata
};
