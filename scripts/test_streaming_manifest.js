#!/usr/bin/env node
/**
 * Test streaming manifest check with progress monitoring
 */

const projectsRepo = require('../server/services/repositories/projectsRepo');
const jobsRepo = require('../server/services/repositories/jobsRepo');
const makeLogger = require('../server/utils/logger2');
const log = makeLogger('test-streaming');

async function testStreamingManifestCheck() {
  try {
    // Test with project ID 13 (188 photos - largest project)
    const project = projectsRepo.getById(13);

    if (!project) {
      console.error('❌ Project 13 not found');
      process.exit(1);
    }

    console.log('\n📊 Testing Streaming Manifest Check');
    console.log('=====================================');
    console.log(`Project: ${project.project_name} (ID: ${project.id})`);
    console.log(`Expected: ~188 photos`);
    console.log(`Chunk size: 2000 (from config)\n`);

    // Enqueue job
    const job = jobsRepo.enqueue({
      tenant_id: 1,
      project_id: project.id,
      type: 'manifest_check',
      priority: 95,
      scope: 'project',
      payload: {
        source: 'streaming_test',
        triggered_at: new Date().toISOString()
      }
    });

    log.info('streaming_test_started', {
      job_id: job.id,
      project_id: project.id,
      project_name: project.project_name
    });

    console.log(`✅ Job enqueued (ID: ${job.id})`);
    console.log('\nMonitoring progress...\n');

    // Monitor progress
    let lastStatus = null;
    let lastProgress = null;

    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));

      const status = jobsRepo.getById(job.id);
      if (!status) continue;

      const progressChanged = lastProgress !== `${status.done}/${status.total}`;
      const statusChanged = lastStatus !== status.status;

      if (progressChanged || statusChanged) {
        const progressBar = status.total
          ? `[${'='.repeat(Math.floor((status.done / status.total) * 20))}${' '.repeat(20 - Math.floor((status.done / status.total) * 20))}]`
          : '[???]';

        console.log(`[${(i * 0.5).toFixed(1)}s] ${status.status.padEnd(10)} ${progressBar} ${status.done || 0}/${status.total || '?'} photos`);

        lastStatus = status.status;
        lastProgress = `${status.done}/${status.total}`;
      }

      if (status.status === 'completed' || status.status === 'failed') {
        console.log(`\n${status.status === 'completed' ? '✅' : '❌'} Job ${status.status}!`);
        if (status.error) {
          console.log(`   Error: ${status.error}`);
        }
        if (status.status === 'completed') {
          console.log(`   Processed: ${status.done || 0} photos`);
          console.log(`   Total: ${status.total || 0} photos`);
        }
        break;
      }
    }

    console.log('\n📝 Check server logs for detailed streaming behavior:');
    console.log('   - Look for "manifest_check_summary" with "total_processed"');
    console.log('   - Progress updates should show incremental processing\n');

  } catch (err) {
    log.error('streaming_test_failed', { error: err.message, stack: err.stack });
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  }
}

testStreamingManifestCheck().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n❌ Unexpected error:', err);
  process.exit(1);
});
