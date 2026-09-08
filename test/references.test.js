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

test('finds remote src values in HTML img tags, including waterfall content', () => {
  const content = [
    '{% waterfall %}',
    '<img alt="one" src="https://img.example.com/a.jpg" />',
    "<IMG SRC='https://img.example.com/b.png?x=1' alt='two'>",
    '<img data-src="https://ignore.example.com/lazy.jpg" src = https://img.example.com/c.webp>',
    '{% endwaterfall %}',
    '<img src="/images/local.avif">',
    '<img src="data:image/png;base64,abc">',
    '',
  ].join('\n');

  const refs = findImageReferences(content);
  assert.deepEqual(refs.map(({ url, kind }) => ({ url, kind })), [
    { url: 'https://img.example.com/a.jpg', kind: 'html' },
    { url: 'https://img.example.com/b.png?x=1', kind: 'html' },
    { url: 'https://img.example.com/c.webp', kind: 'html' },
  ]);
  for (const ref of refs) {
    assert.equal(content.slice(ref.start, ref.end), ref.url);
  }

  const updated = applyReplacements(content, refs.map((ref, index) => ({
    start: ref.start,
    end: ref.end,
    value: `/images/${index}.avif`,
  })));
  assert.match(updated, /src="\/images\/0\.avif"/);
  assert.match(updated, /SRC='\/images\/1\.avif'/);
  assert.match(updated, /src = \/images\/2\.avif/);
});

test('skips empty, local, data, normal links, fenced code, and inline code', () => {
  const content = `---\nthumbnail:\ncover: /images/local.avif\n---\n\n[link](https://example.com/not-image.jpg)\n![local](/images/local.avif)\n![data](data:image/png;base64,abc)\n\`![inline](https://example.com/inline.jpg)\`\n\`<img src="https://example.com/inline-html.jpg">\`\n\n\`\`\`markdown\n![fenced](http://example.com/fenced.jpg)\n<img src="https://example.com/fenced-html.jpg">\n\`\`\`\n\n![real](http://example.com/real.jpg "title")\n<img src="https://example.com/real-html.png">\n`;
  const refs = findImageReferences(content);
  assert.deepEqual(refs.map(ref => ref.url), [
    'http://example.com/real.jpg',
    'https://example.com/real-html.png',
  ]);
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
