const { runRegenerateMetadata } = require('./server/services/workers/metadataRegenerationWorker');
const projectsRepo = require('./server/services/repositories/projectsRepo');
const photosRepo = require('./server/services/repositories/photosRepo');
const { extractMetadata } = require('./server/services/metadataExtractor');
const path = require('path');
const fs = require('fs-extra');
const { PROJECTS_DIR, DEFAULT_USER } = require('./server/services/fsUtils');

async function debug() {
    try {
        console.log('Listing projects...');
        const projects = projectsRepo.list();
        if (projects.length === 0) {
            console.log('No projects found.');
            return;
        }

        const project = projects[0];
        console.log(`Using project: ${project.project_name} (${project.id})`);

        const photos = photosRepo.listPaged({ project_id: project.id, limit: 5 });
        console.log(`Found ${photos.items.length} photos.`);

        for (const photo of photos.items) {
            const projectPath = path.join(PROJECTS_DIR, DEFAULT_USER, project.project_folder);

            // Try constructing path with extension
            let filePath = path.join(projectPath, `${photo.filename}.${photo.ext}`);
            let exists = await fs.pathExists(filePath);

            if (!exists) {
                // Try uppercase extension
                filePath = path.join(projectPath, `${photo.filename}.${photo.ext.toUpperCase()}`);
                exists = await fs.pathExists(filePath);
            }

            console.log(`Checking file: ${filePath}`);
            console.log(`Exists: ${exists}`);

            if (exists) {
                console.log('Extracting metadata...');
                const metadata = await extractMetadata(filePath);
                console.log('Metadata:', JSON.stringify(metadata, null, 2));
            } else {
                console.log(`Failed to find file for ${photo.filename} (ext: ${photo.ext})`);
            }
        }

    } catch (err) {
        console.error('Debug failed:', err);
    }
}

debug();
