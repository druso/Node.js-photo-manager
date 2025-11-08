const path = require('node:path');
const fs = require('fs-extra');
const { ensureProjectDirs, ensureUserRoot, DEFAULT_USER } = require('../../services/fsUtils');

const FIXTURES_ROOT = path.join(__dirname, '..', '..', '..', 'test_content');

const TEST_FIXTURES = {
  PORTRAIT_RAW: 'DSC02215.ARW',
  PORTRAIT_JPG: 'DSC02215.JPG',
  LANDSCAPE_RAW: 'DSC03890.ARW',
  LANDSCAPE_JPG: 'DSC03890.JPG',
};

function getFixturePath(fixtureName) {
  if (!fixtureName || typeof fixtureName !== 'string') {
    throw new Error('Fixture name is required');
  }
  return path.join(FIXTURES_ROOT, fixtureName);
}

async function copyFixtureToProject(fixtureName, projectFolder, options = {}) {
  const { user = DEFAULT_USER, destName } = options;
  const sourcePath = getFixturePath(fixtureName);
  const destFolder = ensureProjectDirs(projectFolder, user);
  const destPath = path.join(destFolder, destName || fixtureName);
  await fs.copy(sourcePath, destPath);
  return destPath;
}

async function seedProjectWithFixtures(projectFolder, fixtures = [], options = {}) {
  const projectPath = ensureProjectDirs(projectFolder, options.user || DEFAULT_USER);
  const copied = [];
  for (const fixtureName of fixtures) {
    const dest = await copyFixtureToProject(fixtureName, projectFolder, options);
    copied.push(dest);
  }
  return { projectPath, copied };
}

function ensureTestUserRoot(user = DEFAULT_USER) {
  return ensureUserRoot(user);
}

module.exports = {
  TEST_FIXTURES,
  getFixturePath,
  copyFixtureToProject,
  seedProjectWithFixtures,
  ensureTestUserRoot,
};
