#!/usr/bin/env node
/**
 * Test script for manifest check streaming implementation
 * Tests the cursor-based pagination in runManifestCheck
 */

const path = require('path');
const projectsRepo = require('../server/services/repositories/projectsRepo');
const jobsRepo = require('../server/services/repositories/jobsRepo');
const makeLogger = require('../server/utils/logger2');
const log = makeLogger('test');

async function testManifestCheck() {
  try {
    log.info('test_start', { message: 'Testing manifest check streaming implementation' });

    // Get first active project
    const projects = projectsRepo.list().filter(p => !p.status || p.status !== 'canceled');

    if (projects.length === 0) {
      log.warn('no_projects', { message: 'No active projects found for testing' });
      return;
    }

    const testProject = projects[0];
    log.info('test_project_selected', {
      project_id: testProject.id,
      project_folder: testProject.project_folder,
      project_name: testProject.project_name
    });

    // Enqueue a manifest check job for this project
    const job = jobsRepo.enqueue({
      tenant_id: 1,
      project_id: testProject.id,
      type: 'manifest_check',
      priority: 95,
      scope: 'project',
      payload: {
        source: 'test_script',
        triggered_at: new Date().toISOString()
      }
    });

    log.info('job_enqueued', {
      job_id: job.id,
      message: 'Manifest check job enqueued. Worker will process it automatically.'
    });

    console.log('\n✅ Test job enqueued successfully!');
    console.log(`   Job ID: ${job.id}`);
    console.log(`   Project: ${testProject.project_name}`);
    console.log(`   Watch the server logs for progress updates.\n`);

    // Monitor job progress for a few seconds
    console.log('Monitoring job progress for 10 seconds...\n');

    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const status = jobsRepo.getById(job.id);
      if (status) {
        console.log(`[${i + 1}s] Status: ${status.status}, Progress: ${status.done || 0}/${status.total || '?'}`);
        if (status.status === 'completed' || status.status === 'failed') {
          console.log(`\n✅ Job ${status.status}!`);
          if (status.error) {
            console.log(`   Error: ${status.error}`);
          }
          break;
        }
      }
    }

  } catch (err) {
    log.error('test_failed', { error: err.message, stack: err.stack });
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  }
}

testManifestCheck().then(() => {
  console.log('\n✅ Test completed. Check server logs for detailed output.');
  process.exit(0);
}).catch(err => {
  console.error('\n❌ Unexpected error:', err);
  process.exit(1);
});
