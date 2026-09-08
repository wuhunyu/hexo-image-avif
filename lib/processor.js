'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const { findImageReferences, applyReplacements } = require('./references');
const { resolveTarget, shouldHandleUrl } = require('./pathing');
const { convertRemoteImage: defaultConvertRemoteImage } = require('./image');

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function listMarkdownFiles(root) {
  if (!(await exists(root))) return [];
  const result = [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await listMarkdownFiles(fullPath));
    else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.md') result.push(fullPath);
  }
  return result;
}

async function discover(sourceDir, handleSubffix) {
  const files = [
    ...await listMarkdownFiles(path.join(sourceDir, '_posts')),
    ...await listMarkdownFiles(path.join(sourceDir, '_drafts')),
  ].sort();
  const documents = [];
  const items = [];
  for (const markdownPath of files) {
    const content = await fs.readFile(markdownPath, 'utf8');
    const references = findImageReferences(content)
      .filter(reference => shouldHandleUrl(reference.url, handleSubffix))
      .map(reference => {
        const target = resolveTarget(sourceDir, markdownPath, reference.url);
        const item = { ...reference, markdownPath, targetPath: target.targetPath, publicPath: target.publicPath };
        items.push(item);
        return item;
      });
    documents.push({ markdownPath, content, references });
  }
  return { documents, items };
}

function errorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

async function processImages(hexo, deps = {}) {
  const config = hexo.config.image_avif || {};
  if (config.enable === false) {
    hexo.log.info('[hexo-image-avif] Disabled by image_avif.enable=false');
    return { found: 0, converted: 0, reused: 0, failed: 0, updatedFiles: 0 };
  }

  const sourceDir = path.resolve(hexo.source_dir);
  let discovery;
  try {
    discovery = await discover(sourceDir, config.handle_subffix);
  } catch (error) {
    hexo.log.error(errorMessage(error));
    throw error;
  }

  const { documents, items } = discovery;
  const convertRemoteImage = deps.convertRemoteImage || defaultConvertRemoteImage;
  const jobs = new Map();
  for (const item of items) {
    const key = `${item.targetPath}\0${item.url}`;
    if (!jobs.has(key)) jobs.set(key, item);
  }

  const results = new Map();
  let converted = 0;
  let reused = 0;
  let failed = 0;

  for (const [key, job] of jobs) {
    if (await exists(job.targetPath)) {
      reused++;
      results.set(key, true);
      hexo.log.info(`[hexo-image-avif] REUSE ${job.url} -> ${job.publicPath}`);
      continue;
    }
    try {
      await convertRemoteImage({
        url: job.url,
        targetPath: job.targetPath,
        timeoutMs: config.timeout ?? 30000,
        quality: config.quality ?? 75,
        effort: config.effort ?? 4,
        fetchImpl: deps.fetchImpl,
        sharpImpl: deps.sharpImpl,
      });
      converted++;
      results.set(key, true);
      hexo.log.info(`[hexo-image-avif] OK ${job.url} -> ${job.publicPath}`);
    } catch (error) {
      failed++;
      results.set(key, false);
      hexo.log.warn(`[hexo-image-avif] FAIL ${job.url} (${job.markdownPath}): ${errorMessage(error)}`);
    }
  }

  let updatedFiles = 0;
  for (const document of documents) {
    const replacements = [];
    for (const reference of document.references) {
      const key = `${reference.targetPath}\0${reference.url}`;
      if (results.get(key) === true) replacements.push({ start: reference.start, end: reference.end, value: reference.publicPath });
    }
    if (replacements.length === 0) continue;
    const updated = applyReplacements(document.content, replacements);
    if (updated !== document.content) {
      await fs.writeFile(document.markdownPath, updated, 'utf8');
      updatedFiles++;
    }
  }

  const summary = { found: items.length, converted, reused, failed, updatedFiles };
  hexo.log.info(`[hexo-image-avif] Done: ${summary.found} references, ${summary.converted} converted, ${summary.reused} reused, ${summary.failed} failed, ${summary.updatedFiles} files updated`);
  return summary;
}

module.exports = { processImages, listMarkdownFiles };
