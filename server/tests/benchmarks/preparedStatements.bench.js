/**
 * Performance benchmark for prepared statement caching
 * 
 * Run with: node server/tests/benchmarks/preparedStatements.bench.js
 * 
 * Expected results: 20-30% improvement with caching
 */

const { getDb } = require('../../services/db');
const stmtCache = require('../../services/repositories/preparedStatements');

function benchmarkInline(iterations) {
  const db = getDb();
  const start = Date.now();
  
  for (let i = 0; i < iterations; i++) {
    const stmt = db.prepare('SELECT * FROM projects WHERE id = ?');
    stmt.get(1);
  }
  
  return Date.now() - start;
}

function benchmarkCached(iterations) {
  const db = getDb();
  const start = Date.now();
  
  for (let i = 0; i < iterations; i++) {
    const stmt = stmtCache.get(db, 'bench:test', 'SELECT * FROM projects WHERE id = ?');
    stmt.get(1);
  }
  
  return Date.now() - start;
}

function benchmarkComplexQuery(iterations, useCache) {
  const db = getDb();
  const start = Date.now();
  
  for (let i = 0; i < iterations; i++) {
    const sql = `
      SELECT p.*, COUNT(ph.id) as photo_count
      FROM projects p
      LEFT JOIN photos ph ON ph.project_id = p.id
      WHERE p.id = ?
      GROUP BY p.id
    `;
    
    let stmt;
    if (useCache) {
      stmt = stmtCache.get(db, 'bench:complex', sql);
    } else {
      stmt = db.prepare(sql);
    }
    stmt.get(1);
  }
  
  return Date.now() - start;
}

function formatResults(label, inlineTime, cachedTime) {
  const improvement = ((inlineTime - cachedTime) / inlineTime * 100).toFixed(1);
  const speedup = (inlineTime / cachedTime).toFixed(2);
  
  console.log(`\n${label}:`);
  console.log(`  Inline:  ${inlineTime}ms`);
  console.log(`  Cached:  ${cachedTime}ms`);
  console.log(`  Improvement: ${improvement}% faster`);
  console.log(`  Speedup: ${speedup}x`);
  
  return { improvement: parseFloat(improvement), speedup: parseFloat(speedup) };
}

function main() {
  console.log('='.repeat(60));
  console.log('Prepared Statement Caching - Performance Benchmark');
  console.log('='.repeat(60));
  
  // Warm up
  console.log('\nWarming up...');
  benchmarkInline(100);
  benchmarkCached(100);
  
  // Clear cache for clean benchmark
  stmtCache.clear();
  
  // Benchmark 1: Simple query with 10,000 iterations
  console.log('\n--- Benchmark 1: Simple SELECT (10,000 iterations) ---');
  const iterations1 = 10000;
  const inline1 = benchmarkInline(iterations1);
  stmtCache.clear();
  const cached1 = benchmarkCached(iterations1);
  const results1 = formatResults('Simple Query', inline1, cached1);
  
  // Benchmark 2: Complex query with 5,000 iterations
  console.log('\n--- Benchmark 2: Complex JOIN Query (5,000 iterations) ---');
  const iterations2 = 5000;
  const inline2 = benchmarkComplexQuery(iterations2, false);
  stmtCache.clear();
  const cached2 = benchmarkComplexQuery(iterations2, true);
  const results2 = formatResults('Complex Query', inline2, cached2);
  
  // Benchmark 3: High iteration count (50,000)
  console.log('\n--- Benchmark 3: High Volume (50,000 iterations) ---');
  const iterations3 = 50000;
  const inline3 = benchmarkInline(iterations3);
  stmtCache.clear();
  const cached3 = benchmarkCached(iterations3);
  const results3 = formatResults('High Volume', inline3, cached3);
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  
  const avgImprovement = ((results1.improvement + results2.improvement + results3.improvement) / 3).toFixed(1);
  const avgSpeedup = ((results1.speedup + results2.speedup + results3.speedup) / 3).toFixed(2);
  
  console.log(`\nAverage Improvement: ${avgImprovement}%`);
  console.log(`Average Speedup: ${avgSpeedup}x`);
  
  // Cache statistics
  const stats = stmtCache.getStats();
  console.log(`\nCache Statistics:`);
  console.log(`  Total Statements Cached: ${stats.size}`);
  console.log(`  Cache Hits: ${stats.hits}`);
  console.log(`  Cache Misses: ${stats.misses}`);
  console.log(`  Hit Rate: ${stats.hit_rate}%`);
  
  // Target validation
  console.log('\n' + '='.repeat(60));
  console.log('TARGET VALIDATION');
  console.log('='.repeat(60));
  
  const targetMin = 20;
  const targetMax = 30;
  
  if (avgImprovement >= targetMin && avgImprovement <= targetMax) {
    console.log(`✅ SUCCESS: ${avgImprovement}% improvement is within target range (${targetMin}-${targetMax}%)`);
  } else if (avgImprovement > targetMax) {
    console.log(`🎉 EXCELLENT: ${avgImprovement}% improvement exceeds target (${targetMin}-${targetMax}%)`);
  } else {
    console.log(`⚠️  WARNING: ${avgImprovement}% improvement is below target (${targetMin}-${targetMax}%)`);
  }
  
  console.log('\n' + '='.repeat(60));
}

// Run benchmark if executed directly
if (require.main === module) {
  main();
}

module.exports = { benchmarkInline, benchmarkCached, benchmarkComplexQuery };
