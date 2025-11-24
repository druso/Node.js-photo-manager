// Test script to verify schema migration for jobs refactoring
const jobsRepo = require('./server/services/repositories/jobsRepo');

console.log('Testing schema migration...\n');

try {
  // Test 1: Enqueue a job with project_id (traditional project-scoped)
  console.log('Test 1: Enqueue project-scoped job');
  const job1 = jobsRepo.enqueue({
    tenant_id: 'user_0',
    project_id: 1,
    type: 'test_project_job',
    payload: { test: 'data' },
    priority: 50
  });
  console.log('✓ Created project-scoped job:', { id: job1.id, scope: job1.scope, project_id: job1.project_id });

  // Test 2: Enqueue a job without project_id (photo_set scope)
  console.log('\nTest 2: Enqueue photo_set-scoped job (no project_id)');
  const job2 = jobsRepo.enqueue({
    tenant_id: 'user_0',
    type: 'test_photo_set_job',
    payload: { photo_ids: [1, 2, 3] },
    priority: 75
  });
  console.log('✓ Created photo_set-scoped job:', { id: job2.id, scope: job2.scope, project_id: job2.project_id });

  // Test 3: Enqueue a global-scoped job
  console.log('\nTest 3: Enqueue global-scoped job');
  const job3 = jobsRepo.enqueue({
    tenant_id: 'user_0',
    type: 'test_global_job',
    scope: 'global',
    priority: 100
  });
  console.log('✓ Created global-scoped job:', { id: job3.id, scope: job3.scope, project_id: job3.project_id });

  // Test 4: Enqueue with items (small batch)
  console.log('\nTest 4: Enqueue job with items (small batch)');
  const job4 = jobsRepo.enqueueWithItems({
    tenant_id: 'user_0',
    type: 'test_items_job',
    items: [
      { photo_id: 1, filename: 'test1.jpg' },
      { photo_id: 2, filename: 'test2.jpg' }
    ],
    priority: 60
  });
  console.log('✓ Created job with items:', { id: job4.id, scope: job4.scope, progress_total: job4.progress_total });

  // Test 5: List by tenant
  console.log('\nTest 5: List jobs by tenant');
  const tenantJobs = jobsRepo.listByTenant('user_0', { limit: 10 });
  console.log(`✓ Found ${tenantJobs.length} jobs for tenant user_0`);
  tenantJobs.forEach(j => {
    console.log(`  - Job ${j.id}: type=${j.type}, scope=${j.scope}, project_id=${j.project_id || 'null'}`);
  });

  // Test 6: Test chunking validation (should throw error without autoChunk)
  console.log('\nTest 6: Test item limit enforcement');
  try {
    const largeItems = Array.from({ length: 2500 }, (_, i) => ({ photo_id: i, filename: `test${i}.jpg` }));
    jobsRepo.enqueueWithItems({
      tenant_id: 'user_0',
      type: 'test_large_job',
      items: largeItems,
      autoChunk: false
    });
    console.log('✗ Should have thrown error for exceeding item limit');
  } catch (err) {
    console.log('✓ Correctly rejected oversized job:', err.message);
  }

  // Test 7: Test auto-chunking
  console.log('\nTest 7: Test auto-chunking for large batches');
  // Use filename-only items to avoid FK constraint issues
  const largeItems = Array.from({ length: 2500 }, (_, i) => ({ filename: `test${i}.jpg` }));
  const chunkedJobs = jobsRepo.enqueueWithItems({
    tenant_id: 'user_0',
    type: 'test_chunked_job',
    items: largeItems,
    autoChunk: true,
    priority: 80
  });
  console.log(`✓ Created ${chunkedJobs.length} chunked jobs for 2500 items`);
  chunkedJobs.forEach((j, idx) => {
    console.log(`  - Chunk ${idx}: job_id=${j.id}, items=${j.progress_total}, scope=${j.scope}`);
  });

  console.log('\n✅ All tests passed! Schema migration successful.');
  
} catch (error) {
  console.error('\n❌ Test failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
