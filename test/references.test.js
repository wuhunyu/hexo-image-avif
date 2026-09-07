'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { findImageReferences, applyReplacements } = require('../lib/references');

test('finds remote thumbnail, cover, and markdown image URLs with exact ranges', () => {
  const content = `---\ntitle: demo\nthumbnail: http://img.example.com/a.jpg\ncover: "https://img.example.com/b.png?x=1"\n---\n\n![body](https://img.example.com/c.jpeg)\n`;
  const refs = findImageReferences(content);
  assert.deepEqual(refs.map(({ url, kind }) => ({ url, kind })), [
    { url: 'http://img.example.com/a.jpg', kind: 'thumbnail' },
    { url: 'https://img.example.com/b.png?x=1', kind: 'cover' },
    { url: 'https://img.example.com/c.jpeg', kind: 'markdown' },
  ]);
  for (const ref of refs) {
    assert.equal(content.slice(ref.start, ref.end), ref.url);
  }
});

test('skips empty, local, data, normal links, fenced code, and inline code', () => {
  const content = `---\nthumbnail:\ncover: /images/local.avif\n---\n\n[link](https://example.com/not-image.jpg)\n![local](/images/local.avif)\n![data](data:image/png;base64,abc)\n\`![inline](https://example.com/inline.jpg)\`\n\n\`\`\`markdown\n![fenced](http://example.com/fenced.jpg)\n\`\`\`\n\n![real](http://example.com/real.jpg "title")\n`;
  const refs = findImageReferences(content);
  assert.deepEqual(refs.map(ref => ref.url), ['http://example.com/real.jpg']);
});

test('supports quoted frontmatter and angle-bracket markdown destinations', () => {
  const content = `---\nthumbnail: 'https://example.com/a.jpg'\ncover: \"http://example.com/b.png\"\n---\n![x](<https://example.com/a path.jpg>)\n`;
  const refs = findImageReferences(content);
  assert.deepEqual(refs.map(ref => ref.url), [
    'https://example.com/a.jpg',
    'http://example.com/b.png',
    'https://example.com/a path.jpg',
  ]);
});

test('applies only URL replacements and preserves all surrounding source text', () => {
  const content = `---\nthumbnail: "https://example.com/a.jpg"\n---\n\nText ![alt](http://example.com/b.png) tail\n`;
  const refs = findImageReferences(content);
  const replacements = refs.map((ref, index) => ({
    start: ref.start,
    end: ref.end,
    value: index === 0 ? '/images/a.avif' : '/images/b.avif',
  }));
  assert.equal(
    applyReplacements(content, replacements),
    `---\nthumbnail: "/images/a.avif"\n---\n\nText ![alt](/images/b.avif) tail\n`,
  );
});
