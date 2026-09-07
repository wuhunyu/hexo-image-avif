'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const { convertRemoteImage } = require('../lib/image');

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'hexo-image-avif-'));
}

function response(bytes, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async arrayBuffer() {
      return Uint8Array.from(bytes).buffer;
    },
  };
}

test('rejects HTTP failures without creating a target file', async () => {
  const dir = await tempDir();
  const targetPath = path.join(dir, 'image.avif');
  await assert.rejects(
    convertRemoteImage({
      url: 'https://example.com/image.jpg',
      targetPath,
      fetchImpl: async () => response([], 403),
      sharpImpl: () => { throw new Error('sharp should not run'); },
    }),
    /HTTP 403/,
  );
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
      avif(options) {
        avifOptions = options;
        return this;
      },
      async toFile(filePath) {
        tempPath = filePath;
        await fs.writeFile(filePath, 'converted-avif');
      },
    };
  }

  await convertRemoteImage({
    url: 'http://example.com/image.png',
    targetPath,
    fetchImpl: async () => response([1, 2, 3]),
    sharpImpl,
    quality: 71,
    effort: 5,
  });

  assert.deepEqual([...receivedBuffer], [1, 2, 3]);
  assert.deepEqual(avifOptions, { quality: 71, effort: 5 });
  assert.equal(await fs.readFile(targetPath, 'utf8'), 'converted-avif');
  await assert.rejects(fs.stat(tempPath), { code: 'ENOENT' });
});

test('removes the temporary file when conversion fails', async () => {
  const dir = await tempDir();
  const targetPath = path.join(dir, 'image.avif');
  let tempPath;

  function sharpImpl() {
    return {
      avif() { return this; },
      async toFile(filePath) {
        tempPath = filePath;
        await fs.writeFile(filePath, 'partial');
        throw new Error('decode failed');
      },
    };
  }

  await assert.rejects(
    convertRemoteImage({
      url: 'https://example.com/broken.jpg',
      targetPath,
      fetchImpl: async () => response([9, 9, 9]),
      sharpImpl,
    }),
    /decode failed/,
  );

  await assert.rejects(fs.stat(targetPath), { code: 'ENOENT' });
  await assert.rejects(fs.stat(tempPath), { code: 'ENOENT' });
});
