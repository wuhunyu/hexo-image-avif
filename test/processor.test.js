'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const { processImages } = require('../lib/processor');
const { DestinationCollisionError } = require('../lib/collisions');

async function makeSite() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hexo-image-avif-site-'));
  const sourceDir = path.join(root, 'source');
  await fs.mkdir(path.join(sourceDir, '_posts'), { recursive: true });
  await fs.mkdir(path.join(sourceDir, '_drafts'), { recursive: true });
  const messages = { info: [], warn: [], error: [] };
  return {
    root,
    sourceDir,
    hexo: {
      source_dir: `${sourceDir}${path.sep}`,
      config: {},
      log: {
        info: message => messages.info.push(String(message)),
        warn: message => messages.warn.push(String(message)),
        error: message => messages.error.push(String(message)),
      },
    },
    messages,
  };
}

test('detects collisions before any conversion or Markdown mutation', async () => {
  const { sourceDir, hexo } = await makeSite();
  const postPath = path.join(sourceDir, '_posts', 'ai', 'a.md');
  const draftPath = path.join(sourceDir, '_drafts', 'ai', 'b.md');
  await fs.mkdir(path.dirname(postPath), { recursive: true });
  await fs.mkdir(path.dirname(draftPath), { recursive: true });
  const postContent = '![a](https://one.example.com/images/a.jpg)\n';
  const draftContent = '![b](https://two.example.com/images/a.png)\n';
  await fs.writeFile(postPath, postContent);
  await fs.writeFile(draftPath, draftContent);

  let conversions = 0;
  await assert.rejects(
    processImages(hexo, { convertRemoteImage: async () => { conversions++; } }),
    error => error instanceof DestinationCollisionError,
  );

  assert.equal(conversions, 0);
  assert.equal(await fs.readFile(postPath, 'utf8'), postContent);
  assert.equal(await fs.readFile(draftPath, 'utf8'), draftContent);
});

test('reuses an existing target without downloading and replaces the source URL', async () => {
  const { sourceDir, hexo } = await makeSite();
  const markdownPath = path.join(sourceDir, '_posts', 'ai', '2026', 'post.md');
  await fs.mkdir(path.dirname(markdownPath), { recursive: true });
  await fs.writeFile(markdownPath, '![a](https://cdn.example.com/images/2025/a.jpg)\n');

  const targetPath = path.join(sourceDir, 'images', 'ai', '2026', 'images-2025-a.avif');
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, 'already-avif');

  let conversions = 0;
  const summary = await processImages(hexo, { convertRemoteImage: async () => { conversions++; } });

  assert.equal(conversions, 0);
  assert.equal(
    await fs.readFile(markdownPath, 'utf8'),
    '![a](/images/ai/2026/images-2025-a.avif)\n',
  );
  assert.equal(summary.reused, 1);
  assert.equal(summary.converted, 0);
  assert.equal(summary.failed, 0);
});

test('processes jobs serially and leaves only failed image references unchanged', async () => {
  const { sourceDir, hexo, messages } = await makeSite();
  const markdownPath = path.join(sourceDir, '_posts', 'post.md');
  await fs.writeFile(markdownPath, [
    '![one](http://img.example.com/a.jpg)',
    '![two](https://img.example.com/b.png)',
    '![three](https://img.example.com/c.jpeg)',
    '',
  ].join('\n'));

  let active = 0;
  let maxActive = 0;
  const order = [];
  async function converter({ url, targetPath }) {
    active++;
    maxActive = Math.max(maxActive, active);
    order.push(url);
    await new Promise(resolve => setTimeout(resolve, 5));
    try {
      if (url.endsWith('/b.png')) throw new Error('decode failed');
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, 'avif');
    } finally {
      active--;
    }
  }

  const summary = await processImages(hexo, { convertRemoteImage: converter });
  const result = await fs.readFile(markdownPath, 'utf8');

  assert.equal(maxActive, 1);
  assert.deepEqual(order, [
    'http://img.example.com/a.jpg',
    'https://img.example.com/b.png',
    'https://img.example.com/c.jpeg',
  ]);
  assert.equal(result, [
    '![one](/images/a.avif)',
    '![two](https://img.example.com/b.png)',
    '![three](/images/c.avif)',
    '',
  ].join('\n'));
  assert.equal(summary.converted, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.updatedFiles, 1);
  assert.equal(messages.warn.some(message => message.includes('decode failed')), true);
});

test('handle_subffix filters by URL pathname extension before collision detection', async () => {
  const { sourceDir, hexo } = await makeSite();
  hexo.config.image_avif = { handle_subffix: ['.JPG'] };
  const markdownPath = path.join(sourceDir, '_posts', 'post.md');
  const original = [
    '![jpg](https://img.example.com/images/a.jpg?width=1200)',
    '![png](https://other.example.com/images/a.png)',
    '![svg](https://img.example.com/vector/logo.svg)',
    '',
  ].join('\n');
  await fs.writeFile(markdownPath, original);

  const convertedUrls = [];
  async function converter({ url, targetPath }) {
    convertedUrls.push(url);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, 'avif');
  }

  const summary = await processImages(hexo, { convertRemoteImage: converter });

  assert.deepEqual(convertedUrls, ['https://img.example.com/images/a.jpg?width=1200']);
  assert.equal(await fs.readFile(markdownPath, 'utf8'), [
    '![jpg](/images/images-a.avif)',
    '![png](https://other.example.com/images/a.png)',
    '![svg](https://img.example.com/vector/logo.svg)',
    '',
  ].join('\n'));
  assert.equal(summary.found, 1);
  assert.equal(summary.converted, 1);
});

test('empty or wildcard handle_subffix processes every remote image', async () => {
  for (const handleSubffix of [[], ['*']]) {
    const { sourceDir, hexo } = await makeSite();
    hexo.config.image_avif = { handle_subffix: handleSubffix };
    const markdownPath = path.join(sourceDir, '_posts', 'post.md');
    await fs.writeFile(markdownPath, [
      '![jpg](https://img.example.com/a.jpg)',
      '![svg](https://img.example.com/b.svg)',
      '![noext](https://img.example.com/image)',
      '',
    ].join('\n'));

    const convertedUrls = [];
    async function converter({ url, targetPath }) {
      convertedUrls.push(url);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, 'avif');
    }

    const summary = await processImages(hexo, { convertRemoteImage: converter });
    assert.deepEqual(convertedUrls, [
      'https://img.example.com/a.jpg',
      'https://img.example.com/b.svg',
      'https://img.example.com/image',
    ]);
    assert.equal(summary.found, 3);
  }
});
