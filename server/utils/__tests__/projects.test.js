const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isCanonicalProjectFolder } = require('../projects');

describe('isCanonicalProjectFolder (post-legacy)', () => {
  it('accepts valid sanitized folder names', () => {
    assert.equal(isCanonicalProjectFolder('my-project'), true);
    assert.equal(isCanonicalProjectFolder('Project_2024'), true);
    assert.equal(isCanonicalProjectFolder('photos-vacation'), true);
    assert.equal(isCanonicalProjectFolder('Summer Photos'), true);
    assert.equal(isCanonicalProjectFolder('Iceland July 2025 (2)'), true);
  });

  it('accepts short names including p<number> format', () => {
    // Users should be free to name projects however they want
    assert.equal(isCanonicalProjectFolder('p1'), true);
    assert.equal(isCanonicalProjectFolder('p123'), true);
    assert.equal(isCanonicalProjectFolder('p999'), true);
    assert.equal(isCanonicalProjectFolder('a'), true);
    assert.equal(isCanonicalProjectFolder('Project1'), true);
  });

  it('rejects invalid characters', () => {
    assert.equal(isCanonicalProjectFolder('my/project'), false);
    assert.equal(isCanonicalProjectFolder('my\\project'), false);
    assert.equal(isCanonicalProjectFolder('../project'), false);
    assert.equal(isCanonicalProjectFolder('project<test>'), false);
    assert.equal(isCanonicalProjectFolder('project|test'), false);
  });

  it('rejects empty or whitespace-only names', () => {
    assert.equal(isCanonicalProjectFolder(''), false);
    assert.equal(isCanonicalProjectFolder('   '), false);
    assert.equal(isCanonicalProjectFolder(null), false);
    assert.equal(isCanonicalProjectFolder(undefined), false);
  });

  it('rejects names that would be modified by sanitization', () => {
    // These would be sanitized to different values, so should be rejected
    assert.equal(isCanonicalProjectFolder('test//project'), false); // would become 'test-project'
    assert.equal(isCanonicalProjectFolder('test::project'), false); // would become 'test--project'
    assert.equal(isCanonicalProjectFolder('test  project'), false); // would become 'test project' (single space)
  });

  it('rejects names exceeding 240 characters', () => {
    const longName = 'a'.repeat(241);
    assert.equal(isCanonicalProjectFolder(longName), false);
    
    const exactLimit = 'a'.repeat(240);
    assert.equal(isCanonicalProjectFolder(exactLimit), true);
  });

  it('handles edge cases', () => {
    assert.equal(isCanonicalProjectFolder(123), false); // number
    assert.equal(isCanonicalProjectFolder({}), false); // object
    assert.equal(isCanonicalProjectFolder([]), false); // array
  });
});
