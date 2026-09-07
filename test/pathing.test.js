'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  isRemoteHttpUrl,
  remoteFileName,
  resolveTarget,
} = require('../lib/pathing');

test('accepts http and https URLs only', () => {
  assert.equal(isRemoteHttpUrl('http://example.com/a.jpg'), true);
  assert.equal(isRemoteHttpUrl('https://example.com/a.jpg'), true);
  assert.equal(isRemoteHttpUrl('/images/a.jpg'), false);
  assert.equal(isRemoteHttpUrl('data:image/png;base64,abc'), false);
  assert.equal(isRemoteHttpUrl(''), false);
});

test('flattens pathname and changes extension to avif', () => {
  assert.equal(
    remoteFileName('https://static.wuhunyu.top/images/2025/09/a2767e93ec0e65298e832c5f726dcb31.jpg'),
    'images-2025-09-a2767e93ec0e65298e832c5f726dcb31.avif',
  );
  assert.equal(
    remoteFileName('http://example.com/assets/photo.jpeg?width=1200#hero'),
    'assets-photo.avif',
  );
  assert.equal(remoteFileName('https://example.com/image'), 'image.avif');
});

test('maps posts and drafts to the same source/images relative directory', () => {
  const sourceDir = path.resolve('/site/source');
  const post = resolveTarget(
    sourceDir,
    path.resolve('/site/source/_posts/ai/agent/2026/08/thoughts.md'),
    'https://static.example.com/images/2025/09/a.jpg',
  );
  const draft = resolveTarget(
    sourceDir,
    path.resolve('/site/source/_drafts/ai/agent/2026/08/thoughts.md'),
    'https://static.example.com/images/2025/09/a.jpg',
  );

  const expected = path.resolve('/site/source/images/ai/agent/2026/08/images-2025-09-a.avif');
  assert.equal(post.targetPath, expected);
  assert.equal(draft.targetPath, expected);
  assert.equal(post.publicPath, '/images/ai/agent/2026/08/images-2025-09-a.avif');
});
