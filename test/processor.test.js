'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const { processImages } = require('../lib/processor');

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

test('reuses the same target path across Markdown files instead of treating it as a collision', async () => {
  const { sourceDir, hexo } = await makeSite();
  const firstPath = path.join(sourceDir, '_posts', 'ai', 'a.md');
  const secondPath = path.join(sourceDir, '_posts', 'ai', 'b.md');
  await fs.mkdir(path.dirname(firstPath), { recursive: true });
  await fs.writeFile(firstPath, '![a](https://img.example.com/images/a.jpg?version=1)\n');
  await fs.writeFile(secondPath, '![b](https://img.example.com/images/a.jpg?version=2)\n');

  let conversions = 0;
  async function converter({ targetPath }) {
    conversions++;
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, 'avif');
  }

  const summary = await processImages(hexo, { convertRemoteImage: converter });

  assert.equal(conversions, 1);
  assert.equal(await fs.readFile(firstPath, 'utf8'), '![a](/images/ai/images-a.avif)\n');
  assert.equal(await fs.readFile(secondPath, 'utf8'), '![b](/images/ai/images-a.avif)\n');
  assert.equal(summary.converted, 1);
  assert.equal(summary.reused, 1);
  assert.equal(summary.failed, 0);
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
  assert.equal(await fs.readFile(markdownPath, 'utf8'), '![a](/images/ai/2026/images-2025-a.avif)\n');
  assert.equal(summary.reused, 1);
  assert.equal(summary.converted, 0);
  assert.equal(summary.failed, 0);
});

test('concurrent=false processes jobs serially and leaves only failed image references unchanged', async () => {
  const { sourceDir, hexo, messages } = await makeSite();
  hexo.config.image_avif = { concurrent: false, concurrency: 8 };
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
    } finally { active--; }
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

test('handle_subffix filters by URL pathname extension before processing', async () => {
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


test('processes unique target paths concurrently up to configured concurrency', async () => {
  const { sourceDir, hexo } = await makeSite();
  hexo.config.image_avif = { concurrent: true, concurrency: 2 };
  const markdownPath = path.join(sourceDir, '_posts', 'parallel.md');
  const original = [
    '![a](https://img.example.com/a.jpg)',
    '![b](https://img.example.com/b.jpg)',
    '![c](https://img.example.com/c.jpg)',
    '![d](https://img.example.com/d.jpg)',
    '',
  ].join('\n');
  await fs.writeFile(markdownPath, original);

  let active = 0;
  let maxActive = 0;
  async function converter({ targetPath }) {
    active++;
    maxActive = Math.max(maxActive, active);
    assert.equal(await fs.readFile(markdownPath, 'utf8'), original);
    await new Promise(resolve => setTimeout(resolve, 15));
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, 'avif');
    active--;
    return { targetMet: true, sizeBytes: 1000, quality: 75, attempts: 1 };
  }

  const summary = await processImages(hexo, { convertRemoteImage: converter });

  assert.equal(maxActive, 2);
  assert.equal(summary.converted, 4);
  assert.equal(summary.failed, 0);
  assert.equal(await fs.readFile(markdownPath, 'utf8'), [
    '![a](/images/a.avif)',
    '![b](/images/b.avif)',
    '![c](/images/c.avif)',
    '![d](/images/d.avif)',
    '',
  ].join('\n'));
});

test('uses available parallelism as default concurrency when concurrent is omitted', async () => {
  const { sourceDir, hexo } = await makeSite();
  hexo.config.image_avif = {};
  const markdownPath = path.join(sourceDir, '_posts', 'auto-parallel.md');
  await fs.writeFile(markdownPath, [
    '![a](https://img.example.com/a.jpg)',
    '![b](https://img.example.com/b.jpg)',
    '![c](https://img.example.com/c.jpg)',
    '![d](https://img.example.com/d.jpg)',
    '',
  ].join('\n'));

  let active = 0;
  let maxActive = 0;
  async function converter({ targetPath }) {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 15));
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, 'avif');
    active--;
  }

  await processImages(hexo, {
    convertRemoteImage: converter,
    availableParallelism: () => 3,
  });

  assert.equal(maxActive, 3);
});

test('deduplicates concurrent work by target path and maps every reference to the result', async () => {
  const { sourceDir, hexo } = await makeSite();
  hexo.config.image_avif = { concurrent: true, concurrency: 4 };
  const firstPath = path.join(sourceDir, '_posts', 'same', 'a.md');
  const secondPath = path.join(sourceDir, '_posts', 'same', 'b.md');
  await fs.mkdir(path.dirname(firstPath), { recursive: true });
  await fs.writeFile(firstPath, '![a](https://img.example.com/shared/photo.jpg?v=1)\n');
  await fs.writeFile(secondPath, '![b](https://img.example.com/shared/photo.jpg?v=2)\n');

  let conversions = 0;
  async function converter({ targetPath }) {
    conversions++;
    await new Promise(resolve => setTimeout(resolve, 10));
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, 'avif');
  }

  const summary = await processImages(hexo, { convertRemoteImage: converter });

  assert.equal(conversions, 1);
  assert.equal(summary.converted, 1);
  assert.equal(summary.reused, 1);
  assert.equal(await fs.readFile(firstPath, 'utf8'), '![a](/images/same/shared-photo.avif)\n');
  assert.equal(await fs.readFile(secondPath, 'utf8'), '![b](/images/same/shared-photo.avif)\n');
});

test('passes size compression settings to image conversion and reports oversized results', async () => {
  const { sourceDir, hexo } = await makeSite();
  hexo.config.image_avif = {
    concurrent: false,
    max_size_kb: 88,
    max_compress_attempts: 4,
  };
  const markdownPath = path.join(sourceDir, '_posts', 'size.md');
  await fs.writeFile(markdownPath, '![a](https://img.example.com/a.jpg)\n');

  let received;
  async function converter(options) {
    received = options;
    await fs.mkdir(path.dirname(options.targetPath), { recursive: true });
    await fs.writeFile(options.targetPath, 'avif');
    return { targetMet: false, sizeBytes: 100000, quality: 12, attempts: 4 };
  }

  const summary = await processImages(hexo, { convertRemoteImage: converter });

  assert.equal(received.maxSizeKb, 88);
  assert.equal(received.maxCompressAttempts, 4);
  assert.equal(summary.oversized, 1);
  assert.equal(summary.failed, 0);
  assert.equal(await fs.readFile(markdownPath, 'utf8'), '![a](/images/a.avif)\n');
});
