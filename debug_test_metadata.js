const { extractMetadata } = require('./server/services/metadataExtractor');
const path = require('path');

async function run() {
    const fixturePath = path.join(__dirname, 'test_content', 'DSC02215.JPG');
    console.log(`Extracting metadata from: ${fixturePath}`);

    try {
        const result = await extractMetadata(fixturePath);
        console.log('Result:', JSON.stringify(result, null, 2));

        if (result.meta_json) {
            const meta = JSON.parse(result.meta_json);
            console.log('Parsed meta_json:', JSON.stringify(meta, null, 2));
            console.log('Has camera_model?', !!meta.camera_model);
            console.log('Has Model?', !!meta.Model);
            console.log('Has model?', !!meta.model);
        }
    } catch (err) {
        console.error('Error:', err);
    }
}

run();
