#!/usr/bin/env node
const projectsRepo = require('./server/services/repositories/projectsRepo');
const photosRepo = require('./server/services/repositories/photosRepo');

const projects = projectsRepo.list().filter(p => !p.status || p.status !== 'canceled');

console.log('\nProject Photo Counts:\n');
const projectSizes = projects.map(p => {
  const page = photosRepo.listPaged({ project_id: p.id, limit: 1 });
  return {
    id: p.id,
    name: p.project_name,
    count: page.total || 0
  };
}).sort((a, b) => b.count - a.count);

projectSizes.forEach(p => {
  console.log(`${p.id.toString().padStart(3)} | ${p.count.toString().padStart(6)} photos | ${p.name}`);
});

console.log(`\nTotal projects: ${projects.length}`);
console.log(`Total photos: ${projectSizes.reduce((sum, p) => sum + p.count, 0)}\n`);
