// Project utilities: folder/id helpers for the fresh-start model
// Canonical folder format: p<id>

function slugify(name) {
  // Kept for potential future use (e.g., display-only slugs); not used in folder naming
  return String(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/[^a-zA-Z0-9\s-_]/g, '')
    .trim()
    .replace(/\s+/g, '_');
}

function makeProjectFolderName(project_name, id) {
  // Folder is now strictly based on immutable id
  return `p${id}`;
}

function isCanonicalProjectFolder(folder) {
  return /^p\d+$/.test(String(folder));
}

function parseProjectIdFromFolder(folder) {
  const m = /^p(\d+)$/.exec(String(folder));
  return m ? Number(m[1]) : null;
}

module.exports = {
  slugify,
  makeProjectFolderName,
  isCanonicalProjectFolder,
  parseProjectIdFromFolder,
};
