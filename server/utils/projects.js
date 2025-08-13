// Project utilities: folder/id helpers for the fresh-start model
// Canonical folder format: <slug(project_name)>--p<id>

function slugify(name) {
  return String(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/[^a-zA-Z0-9\s-_]/g, '')
    .trim()
    .replace(/\s+/g, '_');
}

function makeProjectFolderName(project_name, id) {
  return `${slugify(project_name)}--p${id}`;
}

function isCanonicalProjectFolder(folder) {
  return /--p\d+$/.test(String(folder));
}

function parseProjectIdFromFolder(folder) {
  const m = /--p(\d+)$/.exec(String(folder));
  return m ? Number(m[1]) : null;
}

module.exports = {
  slugify,
  makeProjectFolderName,
  isCanonicalProjectFolder,
  parseProjectIdFromFolder,
};
