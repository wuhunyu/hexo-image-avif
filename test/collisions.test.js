'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { assertNoCollisions, DestinationCollisionError } = require('../lib/collisions');

test('allows repeated references when the remote URL and target are identical', () => {
  assert.doesNotThrow(() => assertNoCollisions([
    { url: 'https://a.example.com/images/2025/a.jpg', markdownPath: '/site/source/_posts/a.md', targetPath: '/site/source/images/images-2025-a.avif' },
    { url: 'https://a.example.com/images/2025/a.jpg', markdownPath: '/site/source/_posts/b.md', targetPath: '/site/source/images/images-2025-a.avif' },
  ]));
});

test('throws a diagnostic error when different URLs resolve to the same target', () => {
  const items = [
    { url: 'https://a.example.com/images/2025/a.jpg', markdownPath: '/site/source/_posts/a.md', targetPath: '/site/source/images/images-2025-a.avif' },
    { url: 'https://b.example.com/images/2025/a.png', markdownPath: '/site/source/_drafts/b.md', targetPath: '/site/source/images/images-2025-a.avif' },
  ];

  assert.throws(
    () => assertNoCollisions(items),
    error => {
      assert.equal(error instanceof DestinationCollisionError, true);
      assert.equal(error.targetPath, '/site/source/images/images-2025-a.avif');
      assert.match(error.message, /https:\/\/a\.example\.com\/images\/2025\/a\.jpg/);
      assert.match(error.message, /https:\/\/b\.example\.com\/images\/2025\/a\.png/);
      assert.match(error.message, /source\/_posts\/a\.md/);
      assert.match(error.message, /source\/_drafts\/b\.md/);
      return true;
    },
  );
});
