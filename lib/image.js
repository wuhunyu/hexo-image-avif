'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function normalizePositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeAttempts(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 6;
}

function normalizeQuality(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 75;
  return Math.max(1, Math.min(100, Math.round(number)));
}

async function convertRemoteImage({
  url,
  targetPath,
  fetchImpl = globalThis.fetch,
  sharpImpl,
  timeoutMs = 30000,
  quality = 75,
  effort = 4,
  maxSizeKb = 100,
  maxCompressAttempts = 6,
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

  const sourceBuffer = Buffer.from(await response.arrayBuffer());
  const targetBytes = Math.floor(normalizePositiveNumber(maxSizeKb, 100) * 1024);
  const attemptLimit = normalizeAttempts(maxCompressAttempts);
  const initialQuality = normalizeQuality(quality);
  let attempts = 0;
  let smallest = null;
  let bestUnderTarget = null;

  async function encodeAtQuality(selectedQuality) {
    attempts++;
    const output = await sharpImpl(sourceBuffer, { density: 144 })
      .avif({ quality: selectedQuality, effort })
      .toBuffer();
    const result = {
      buffer: Buffer.from(output),
      quality: selectedQuality,
      sizeBytes: output.length,
    };
    if (!smallest || result.sizeBytes < smallest.sizeBytes || (
      result.sizeBytes === smallest.sizeBytes && result.quality < smallest.quality
    )) {
      smallest = result;
    }
    if (result.sizeBytes <= targetBytes && (
      !bestUnderTarget || result.quality > bestUnderTarget.quality
    )) {
      bestUnderTarget = result;
    }
    return result;
  }

  const initial = await encodeAtQuality(initialQuality);

  async function search(low, high) {
    if (bestUnderTarget && attempts >= attemptLimit) return;
    if (attempts >= attemptLimit || low > high) return;

    const remaining = attemptLimit - attempts;
    const selectedQuality = remaining === 1 && !bestUnderTarget
      ? 1
      : Math.floor((low + high) / 2);
    const result = await encodeAtQuality(selectedQuality);

    if (result.sizeBytes <= targetBytes) {
      await search(selectedQuality + 1, high);
    } else {
      await search(low, selectedQuality - 1);
    }
  }

  if (initial.sizeBytes > targetBytes && attempts < attemptLimit && initialQuality > 1) {
    await search(1, initialQuality - 1);
  }

  const finalResult = bestUnderTarget || smallest;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const suffix = crypto.randomBytes(8).toString('hex');
  const tempPath = `${targetPath}.${process.pid}.${suffix}.tmp`;
  try {
    await fs.writeFile(tempPath, finalResult.buffer);
    await fs.rename(tempPath, targetPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }

  return {
    targetMet: finalResult.sizeBytes <= targetBytes,
    sizeBytes: finalResult.sizeBytes,
    quality: finalResult.quality,
    attempts,
  };
}

module.exports = {
  convertRemoteImage,
};
