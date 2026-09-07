'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

async function convertRemoteImage({
  url,
  targetPath,
  fetchImpl = globalThis.fetch,
  sharpImpl,
  timeoutMs = 30000,
  quality = 75,
  effort = 4,
}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Global fetch is unavailable; Node.js 24 or a fetch implementation is required.');
  }
  if (!sharpImpl) sharpImpl = require('sharp');

  const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(timeoutMs)
    : undefined;
  const response = await fetchImpl(url, {
    signal,
    headers: {
      'user-agent': 'hexo-image-avif/0.1.0',
      accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    },
  });

  if (!response || !response.ok) {
    const status = response && response.status != null ? response.status : 'unknown';
    throw new Error(`HTTP ${status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  const suffix = crypto.randomBytes(8).toString('hex');
  const tempPath = `${targetPath}.${process.pid}.${suffix}.tmp`;
  try {
    await sharpImpl(buffer)
      .avif({ quality, effort })
      .toFile(tempPath);
    await fs.rename(tempPath, targetPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

module.exports = {
  convertRemoteImage,
};
