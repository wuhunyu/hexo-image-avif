'use strict';

const path = require('node:path');

function parseRemoteUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed;
  } catch {
    return null;
  }
}

function isRemoteHttpUrl(value) {
  return parseRemoteUrl(value) !== null;
}

function shouldHandleUrl(value, handleSubffix) {
  const parsed = parseRemoteUrl(value);
  if (!parsed) return false;
  if (!Array.isArray(handleSubffix) || handleSubffix.length === 0) return true;

  const normalizedSuffixes = handleSubffix
    .filter(value => typeof value === 'string')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  if (normalizedSuffixes.length === 0 || normalizedSuffixes.includes('*')) return true;

  const suffix = path.posix.extname(parsed.pathname).toLowerCase();
  return normalizedSuffixes.some(value => (
    (value.startsWith('.') ? value : `.${value}`) === suffix
  ));
}

function remoteFileName(value) {
  const parsed = parseRemoteUrl(value);
  if (!parsed) throw new TypeError(`Not an HTTP(S) URL: ${value}`);

  const flattened = parsed.pathname.replace(/^\/+/, '').replace(/\/+/g, '-');
  if (!flattened) throw new Error(`Remote image URL has no pathname: ${value}`);

  const ext = path.posix.extname(flattened);
  const stem = ext ? flattened.slice(0, -ext.length) : flattened;
  if (!stem) throw new Error(`Remote image URL has no usable file name: ${value}`);
  return `${stem}.avif`;
}

function articleRelativeDir(sourceDir, markdownPath) {
  const normalizedSource = path.resolve(sourceDir);
  const normalizedMarkdown = path.resolve(markdownPath);
  const postsDir = path.join(normalizedSource, '_posts');
  const draftsDir = path.join(normalizedSource, '_drafts');

  let baseDir;
  if (normalizedMarkdown === postsDir || normalizedMarkdown.startsWith(`${postsDir}${path.sep}`)) {
    baseDir = postsDir;
  } else if (normalizedMarkdown === draftsDir || normalizedMarkdown.startsWith(`${draftsDir}${path.sep}`)) {
    baseDir = draftsDir;
  } else {
    throw new Error(`Markdown file must be inside source/_posts or source/_drafts: ${markdownPath}`);
  }

  return path.dirname(path.relative(baseDir, normalizedMarkdown));
}

function resolveTarget(sourceDir, markdownPath, remoteUrl) {
  const relativeDir = articleRelativeDir(sourceDir, markdownPath);
  const fileName = remoteFileName(remoteUrl);
  const targetPath = path.join(path.resolve(sourceDir), 'images', relativeDir, fileName);
  const publicPath = `/${path.posix.join('images', relativeDir.split(path.sep).join('/'), fileName)}`;
  return { targetPath, publicPath };
}

module.exports = {
  isRemoteHttpUrl,
  shouldHandleUrl,
  remoteFileName,
  resolveTarget,
};
