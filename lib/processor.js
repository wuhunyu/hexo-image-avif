'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

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
        const item = {
          ...reference,
          markdownPath,
          targetPath: target.targetPath,
          publicPath: target.publicPath,
        };
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

function buildTargetJobs(items) {
  const jobs = new Map();
  for (const item of items) {
    let job = jobs.get(item.targetPath);
    if (!job) {
      job = {
        targetPath: item.targetPath,
        publicPath: item.publicPath,
        url: item.url,
        markdownPath: item.markdownPath,
        references: [],
      };
      jobs.set(item.targetPath, job);
    }
    job.references.push(item);
  }
  return [...jobs.values()];
}

function resolveConcurrency(config, availableParallelism) {
  if (config.concurrent === false) return 1;
  const configured = Number(config.concurrency);
  if (Number.isInteger(configured) && configured > 0) return configured;
  const detected = Number(availableParallelism());
  return Number.isInteger(detected) && detected > 0 ? detected : 1;
}

async function runWithConcurrency(tasks, limit, worker) {
  if (tasks.length === 0) return;
  let nextIndex = 0;
  async function runWorker() {
    while (true) {
      const index = nextIndex++;
      if (index >= tasks.length) return;
      await worker(tasks[index]);
    }
  }
  const workerCount = Math.min(Math.max(1, limit), tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
}

async function processImages(hexo, deps = {}) {
  const config = hexo.config.image_avif || {};
  if (config.enable === false) {
    hexo.log.info('[hexo-image-avif] Disabled by image_avif.enable=false');
    return { found: 0, converted: 0, reused: 0, failed: 0, oversized: 0, updatedFiles: 0 };
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
  const jobs = buildTargetJobs(items);
  const convertRemoteImage = deps.convertRemoteImage || defaultConvertRemoteImage;
  const availableParallelism = deps.availableParallelism || os.availableParallelism;
  const concurrency = resolveConcurrency(config, availableParallelism);
  const results = new Map();
  let converted = 0;
  let reused = 0;
  let failed = 0;
  let oversized = 0;

  await runWithConcurrency(jobs, concurrency, async job => {
    if (await exists(job.targetPath)) {
      reused += job.references.length;
      results.set(job.targetPath, true);
      hexo.log.info(`[hexo-image-avif] REUSE ${job.url} -> ${job.publicPath}`);
      return;
    }

    try {
      const conversion = await convertRemoteImage({
        url: job.url,
        targetPath: job.targetPath,
        timeoutMs: config.timeout ?? 30000,
        quality: config.quality ?? 75,
        effort: config.effort ?? 4,
        maxSizeKb: config.max_size_kb ?? 100,
        maxCompressAttempts: config.max_compress_attempts ?? 6,
        fetchImpl: deps.fetchImpl,
        sharpImpl: deps.sharpImpl,
      });
      converted++;
      reused += Math.max(0, job.references.length - 1);
      results.set(job.targetPath, true);
      if (conversion && conversion.targetMet === false) {
        oversized++;
        hexo.log.warn(
          `[hexo-image-avif] SIZE_TARGET_MISS ${job.url}: ${conversion.sizeBytes} bytes after ${conversion.attempts} attempts at quality ${conversion.quality}`,
        );
      }
      hexo.log.info(`[hexo-image-avif] OK ${job.url} -> ${job.publicPath}`);
    } catch (error) {
      failed++;
      results.set(job.targetPath, false);
      hexo.log.warn(`[hexo-image-avif] FAIL ${job.url} (${job.markdownPath}): ${errorMessage(error)}`);
    }
  });

  let updatedFiles = 0;
  for (const document of documents) {
    const replacements = [];
    for (const reference of document.references) {
      if (results.get(reference.targetPath) === true) {
        replacements.push({
          start: reference.start,
          end: reference.end,
          value: reference.publicPath,
        });
      }
    }
    if (replacements.length === 0) continue;
    const updated = applyReplacements(document.content, replacements);
    if (updated !== document.content) {
      await fs.writeFile(document.markdownPath, updated, 'utf8');
      updatedFiles++;
    }
  }

  const summary = { found: items.length, converted, reused, failed, oversized, updatedFiles };
  hexo.log.info(
    `[hexo-image-avif] Done: ${summary.found} references, ${summary.converted} converted, ${summary.reused} reused, ${summary.failed} failed, ${summary.oversized} oversized, ${summary.updatedFiles} files updated`,
  );
  return summary;
}

module.exports = {
  processImages,
  listMarkdownFiles,
};
