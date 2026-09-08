'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const { convertRemoteImage } = require('../lib/image');

async function tempDir() { return fs.mkdtemp(path.join(os.tmpdir(), 'hexo-image-avif-')); }
function response(bytes, status = 200) {
  return { ok: status >= 200 && status < 300, status, async arrayBuffer() { return Uint8Array.from(bytes).buffer; } };
}

test('rejects HTTP failures without creating a target file', async () => {
  const dir = await tempDir();
  const targetPath = path.join(dir, 'image.avif');
  await assert.rejects(convertRemoteImage({
    url: 'https://example.com/image.jpg', targetPath,
    fetchImpl: async () => response([], 403),
    sharpImpl: () => { throw new Error('sharp should not run'); },
  }), /HTTP 403/);
  await assert.rejects(fs.stat(targetPath), { code: 'ENOENT' });
});

test('writes AVIF through a temporary file and renames it atomically', async () => {
  const dir = await tempDir();
  const targetPath = path.join(dir, 'nested', 'image.avif');
  let receivedBuffer;
  let avifOptions;
  let tempPath;
  function sharpImpl(buffer) {
    receivedBuffer = buffer;
    return {
      avif(options) { avifOptions = options; return this; },
      async toBuffer() { return Buffer.from('converted-avif'); },
      async toFile(filePath) { tempPath = filePath; await fs.writeFile(filePath, 'converted-avif'); },
    };
  }
  await convertRemoteImage({
    url: 'http://example.com/image.png', targetPath,
    fetchImpl: async () => response([1, 2, 3]), sharpImpl, quality: 71, effort: 5,
  });
  assert.deepEqual([...receivedBuffer], [1, 2, 3]);
  assert.deepEqual(avifOptions, { quality: 71, effort: 5 });
  assert.equal(await fs.readFile(targetPath, 'utf8'), 'converted-avif');
  const nestedEntries = await fs.readdir(path.dirname(targetPath));
  assert.deepEqual(nestedEntries, ['image.avif']);
});

test('removes the temporary file when conversion fails', async () => {
  const dir = await tempDir();
  const targetPath = path.join(dir, 'image.avif');
  let tempPath;
  function sharpImpl() {
    return {
      avif() { return this; },
      async toBuffer() { throw new Error('decode failed'); },
      async toFile(filePath) { tempPath = filePath; await fs.writeFile(filePath, 'partial'); throw new Error('decode failed'); },
    };
  }
  await assert.rejects(convertRemoteImage({
    url: 'https://example.com/broken.jpg', targetPath,
    fetchImpl: async () => response([9, 9, 9]), sharpImpl,
  }), /decode failed/);
  await assert.rejects(fs.stat(targetPath), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(dir), []);
});

test('passes SVG rasterization density to Sharp before AVIF encoding', async () => {
  const dir = await tempDir();
  const targetPath = path.join(dir, 'vector.avif');
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
  let constructorOptions;
  let avifOptions;
  function sharpImpl(buffer, options) {
    assert.deepEqual(buffer, svg);
    constructorOptions = options;
    return {
      avif(optionsValue) { avifOptions = optionsValue; return this; },
      async toBuffer() { return Buffer.from('svg-as-avif'); },
      async toFile(filePath) { await fs.writeFile(filePath, 'svg-as-avif'); },
    };
  }
  await convertRemoteImage({
    url: 'https://example.com/logo.svg', targetPath,
    fetchImpl: async () => response([...svg]), sharpImpl,
  });
  assert.deepEqual(constructorOptions, { density: 144 });
  assert.deepEqual(avifOptions, { quality: 75, effort: 4 });
  assert.equal(await fs.readFile(targetPath, 'utf8'), 'svg-as-avif');
});


test('recursively searches AVIF quality to meet the configured size threshold', async () => {
  const dir = await tempDir();
  const targetPath = path.join(dir, 'image.avif');
  const qualities = [];

  function sharpImpl() {
    let selectedQuality;
    return {
      avif(options) {
        selectedQuality = options.quality;
        qualities.push(selectedQuality);
        return this;
      },
      async toBuffer() {
        return Buffer.alloc(selectedQuality * 40);
      },
    };
  }

  const result = await convertRemoteImage({
    url: 'https://example.com/large.jpg',
    targetPath,
    fetchImpl: async () => response([1, 2, 3]),
    sharpImpl,
    quality: 75,
    maxSizeKb: 1,
    maxCompressAttempts: 6,
  });

  assert.deepEqual(qualities, [75, 37, 18, 27, 22, 24]);
  assert.equal(result.targetMet, true);
  assert.equal(result.quality, 24);
  assert.equal(result.attempts, 6);
  assert.equal(result.sizeBytes, 960);
  assert.equal((await fs.stat(targetPath)).size, 960);
});

test('stops after the first encoding when the initial AVIF is already under the size target', async () => {
  const dir = await tempDir();
  const targetPath = path.join(dir, 'small.avif');
  const qualities = [];
  function sharpImpl() {
    let selectedQuality;
    return {
      avif(options) { selectedQuality = options.quality; qualities.push(selectedQuality); return this; },
      async toBuffer() { return Buffer.alloc(800); },
    };
  }

  const result = await convertRemoteImage({
    url: 'https://example.com/small.jpg',
    targetPath,
    fetchImpl: async () => response([1]),
    sharpImpl,
    quality: 75,
    maxSizeKb: 1,
    maxCompressAttempts: 6,
  });

  assert.deepEqual(qualities, [75]);
  assert.deepEqual(result, { targetMet: true, sizeBytes: 800, quality: 75, attempts: 1 });
});

test('uses the lowest-quality best effort after the maximum compression attempts when the target is impossible', async () => {
  const dir = await tempDir();
  const targetPath = path.join(dir, 'oversized.avif');
  const qualities = [];
  function sharpImpl() {
    let selectedQuality;
    return {
      avif(options) { selectedQuality = options.quality; qualities.push(selectedQuality); return this; },
      async toBuffer() { return Buffer.alloc(2000 + selectedQuality); },
    };
  }

  const result = await convertRemoteImage({
    url: 'https://example.com/huge.jpg',
    targetPath,
    fetchImpl: async () => response([1]),
    sharpImpl,
    quality: 75,
    maxSizeKb: 1,
    maxCompressAttempts: 6,
  });

  assert.deepEqual(qualities, [75, 37, 18, 9, 4, 1]);
  assert.equal(result.targetMet, false);
  assert.equal(result.quality, 1);
  assert.equal(result.attempts, 6);
  assert.equal(result.sizeBytes, 2001);
  assert.equal((await fs.stat(targetPath)).size, 2001);
});


test('defaults to a 100 KB target and at most 6 compression attempts', async () => {
  const dir = await tempDir();
  const targetPath = path.join(dir, 'default-limit.avif');
  const qualities = [];
  function sharpImpl() {
    let selectedQuality;
    return {
      avif(options) { selectedQuality = options.quality; qualities.push(selectedQuality); return this; },
      async toBuffer() {
        if (selectedQuality === 75) return Buffer.alloc(110 * 1024);
        if (selectedQuality >= 70) return Buffer.alloc(105 * 1024);
        return Buffer.alloc(95 * 1024);
      },
    };
  }

  const result = await convertRemoteImage({
    url: 'https://example.com/defaults.jpg',
    targetPath,
    fetchImpl: async () => response([1]),
    sharpImpl,
  });

  assert.equal(result.targetMet, true);
  assert.equal(result.sizeBytes <= 100 * 1024, true);
  assert.equal(result.attempts, 6);
  assert.equal(qualities.length, 6);
});
