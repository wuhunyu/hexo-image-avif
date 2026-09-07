'use strict';

class DestinationCollisionError extends Error {
  constructor(first, second) {
    super([
      '[hexo-image-avif] Image destination collision',
      '',
      `Target: ${first.targetPath}`,
      '',
      `First image: ${first.url}`,
      `First Markdown: ${first.markdownPath}`,
      '',
      `Conflicting image: ${second.url}`,
      `Conflicting Markdown: ${second.markdownPath}`,
      '',
      'Different remote images resolve to the same local AVIF file. Resolve the conflict manually and run the command again.',
    ].join('\n'));
    this.name = 'DestinationCollisionError';
    this.targetPath = first.targetPath;
    this.first = first;
    this.second = second;
  }
}

function assertNoCollisions(items) {
  const seen = new Map();
  for (const item of items) {
    const previous = seen.get(item.targetPath);
    if (!previous) {
      seen.set(item.targetPath, item);
      continue;
    }
    if (previous.url !== item.url) {
      throw new DestinationCollisionError(previous, item);
    }
  }
}

module.exports = {
  DestinationCollisionError,
  assertNoCollisions,
};
