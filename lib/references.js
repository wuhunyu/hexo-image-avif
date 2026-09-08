'use strict';

const { isRemoteHttpUrl } = require('./pathing');

function isEscaped(text, index) {
  let count = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) count++;
  return count % 2 === 1;
}

function findFrontmatterReferences(content) {
  const refs = [];
  if (!(content.startsWith('---\n') || content.startsWith('---\r\n'))) {
    return { refs, bodyStart: 0 };
  }

  const openingEnd = content.indexOf('\n') + 1;
  const closeMatch = /^---\s*$/m.exec(content.slice(openingEnd));
  if (!closeMatch) return { refs, bodyStart: 0 };

  const closeStart = openingEnd + closeMatch.index;
  const closeLineEnd = content.indexOf('\n', closeStart);
  const bodyStart = closeLineEnd === -1 ? content.length : closeLineEnd + 1;
  const frontmatter = content.slice(openingEnd, closeStart);

  let offset = openingEnd;
  for (const line of frontmatter.split(/(?<=\n)/)) {
    const lineText = line.endsWith('\n') ? line.slice(0, -1).replace(/\r$/, '') : line.replace(/\r$/, '');
    const match = /^(thumbnail|cover):[ \t]*(.*?)[ \t]*$/.exec(lineText);
    if (match) {
      const kind = match[1];
      const rawValue = match[2];
      if (rawValue) {
        let value = rawValue;
        let relativeStart = lineText.indexOf(rawValue);
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
          relativeStart += 1;
        }
        if (isRemoteHttpUrl(value)) {
          refs.push({
            url: value,
            start: offset + relativeStart,
            end: offset + relativeStart + value.length,
            kind,
          });
        }
      }
    }
    offset += line.length;
  }

  return { refs, bodyStart };
}

function findClosingBracket(line, start) {
  let depth = 1;
  for (let i = start; i < line.length; i++) {
    if (isEscaped(line, i)) continue;
    if (line[i] === '[') depth++;
    if (line[i] === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findMarkdownReferences(content, bodyStart) {
  const refs = [];
  const body = content.slice(bodyStart);
  const lines = body.split(/(?<=\n)/);
  let globalOffset = bodyStart;
  let fenceChar = null;
  let fenceLength = 0;

  for (const rawLine of lines) {
    const line = rawLine.endsWith('\n') ? rawLine.slice(0, -1).replace(/\r$/, '') : rawLine.replace(/\r$/, '');
    const fence = /^( {0,3})(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const token = fence[2];
      if (!fenceChar) {
        fenceChar = token[0];
        fenceLength = token.length;
      } else if (token[0] === fenceChar && token.length >= fenceLength) {
        fenceChar = null;
        fenceLength = 0;
      }
      globalOffset += rawLine.length;
      continue;
    }
    if (fenceChar) {
      globalOffset += rawLine.length;
      continue;
    }

    let i = 0;
    while (i < line.length) {
      if (line[i] === '`' && !isEscaped(line, i)) {
        let ticks = 1;
        while (line[i + ticks] === '`') ticks++;
        const delimiter = '`'.repeat(ticks);
        const close = line.indexOf(delimiter, i + ticks);
        i = close === -1 ? line.length : close + ticks;
        continue;
      }

      if (line[i] !== '!' || line[i + 1] !== '[' || isEscaped(line, i)) {
        i++;
        continue;
      }

      const altClose = findClosingBracket(line, i + 2);
      if (altClose === -1) {
        i++;
        continue;
      }

      let cursor = altClose + 1;
      while (line[cursor] === ' ' || line[cursor] === '\t') cursor++;
      if (line[cursor] !== '(') {
        i = altClose + 1;
        continue;
      }
      cursor++;
      while (line[cursor] === ' ' || line[cursor] === '\t') cursor++;

      let urlStart;
      let urlEnd;
      if (line[cursor] === '<') {
        urlStart = cursor + 1;
        let end = urlStart;
        while (end < line.length && (line[end] !== '>' || isEscaped(line, end))) end++;
        if (end >= line.length) {
          i = cursor + 1;
          continue;
        }
        urlEnd = end;
      } else {
        urlStart = cursor;
        let depth = 0;
        let end = cursor;
        for (; end < line.length; end++) {
          const ch = line[end];
          if (isEscaped(line, end)) continue;
          if (ch === '(') {
            depth++;
            continue;
          }
          if (ch === ')') {
            if (depth === 0) break;
            depth--;
            continue;
          }
          if ((ch === ' ' || ch === '\t') && depth === 0) break;
        }
        urlEnd = end;
      }

      const url = line.slice(urlStart, urlEnd);
      if (isRemoteHttpUrl(url)) {
        refs.push({
          url,
          start: globalOffset + urlStart,
          end: globalOffset + urlEnd,
          kind: 'markdown',
        });
      }
      i = Math.max(urlEnd + 1, i + 1);
    }

    globalOffset += rawLine.length;
  }
  return refs;
}

function findHtmlTagEnd(line, start) {
  let quote = null;
  for (let i = start + 1; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote && !isEscaped(line, i)) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '>') return i;
  }
  return -1;
}

function findHtmlImageReferences(content, bodyStart) {
  const refs = [];
  const body = content.slice(bodyStart);
  const lines = body.split(/(?<=\n)/);
  let globalOffset = bodyStart;
  let fenceChar = null;
  let fenceLength = 0;

  for (const rawLine of lines) {
    const line = rawLine.endsWith('\n') ? rawLine.slice(0, -1).replace(/\r$/, '') : rawLine.replace(/\r$/, '');
    const fence = /^( {0,3})(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const token = fence[2];
      if (!fenceChar) {
        fenceChar = token[0];
        fenceLength = token.length;
      } else if (token[0] === fenceChar && token.length >= fenceLength) {
        fenceChar = null;
        fenceLength = 0;
      }
      globalOffset += rawLine.length;
      continue;
    }
    if (fenceChar) {
      globalOffset += rawLine.length;
      continue;
    }

    let i = 0;
    while (i < line.length) {
      if (line[i] === '`' && !isEscaped(line, i)) {
        let ticks = 1;
        while (line[i + ticks] === '`') ticks++;
        const delimiter = '`'.repeat(ticks);
        const close = line.indexOf(delimiter, i + ticks);
        i = close === -1 ? line.length : close + ticks;
        continue;
      }

      if (line[i] !== '<' || !/^<img\b/i.test(line.slice(i))) {
        i++;
        continue;
      }

      const tagEnd = findHtmlTagEnd(line, i);
      if (tagEnd === -1) {
        i++;
        continue;
      }

      const tag = line.slice(i, tagEnd + 1);
      const srcMatch = /(?:^|\s)src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(tag);
      if (srcMatch) {
        const url = srcMatch[1] ?? srcMatch[2] ?? srcMatch[3] ?? '';
        if (isRemoteHttpUrl(url)) {
          const valueOffset = srcMatch[0].lastIndexOf(url);
          const start = globalOffset + i + srcMatch.index + valueOffset;
          refs.push({
            url,
            start,
            end: start + url.length,
            kind: 'html',
          });
        }
      }
      i = tagEnd + 1;
    }

    globalOffset += rawLine.length;
  }
  return refs;
}

function findImageReferences(content) {
  const { refs, bodyStart } = findFrontmatterReferences(content);
  return refs
    .concat(findMarkdownReferences(content, bodyStart), findHtmlImageReferences(content, bodyStart))
    .sort((a, b) => a.start - b.start);
}

function applyReplacements(content, replacements) {
  let result = content;
  const ordered = [...replacements].sort((a, b) => b.start - a.start);
  for (const replacement of ordered) {
    result = `${result.slice(0, replacement.start)}${replacement.value}${result.slice(replacement.end)}`;
  }
  return result;
}

module.exports = {
  findImageReferences,
  applyReplacements,
};
