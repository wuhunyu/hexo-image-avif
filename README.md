# hexo-image-avif

A Hexo plugin that localizes remote images referenced by posts and drafts, converts them to AVIF, and rewrites Markdown/frontmatter URLs in place.

## Requirements

- Node.js 24+
- Hexo 8.1.2+

## Install

```bash
npm install github:wuhunyu/hexo-image-avif
```

Hexo automatically loads dependencies whose package name starts with `hexo-`.

## Usage

The plugin runs automatically before source loading when you execute:

```bash
hexo g
# or
hexo generate
```

You can also process images without generating the site:

```bash
hexo images
```

## What is processed

The plugin scans Markdown files under:

```text
source/_posts
source/_drafts
```

It processes remote image URLs in:

- frontmatter `thumbnail`
- frontmatter `cover`
- Markdown image syntax: `![](...)`

Only `http://` and `https://` URLs are processed. Empty and already-local references are ignored.

## Output path

Images are written below `source/images`, keeping the Markdown file's directory relative to `_posts` or `_drafts`.

For example:

```text
source/_posts/ai/agent/2026/08/thoughts-on-mini-agent.md
```

with:

```text
https://static.wuhunyu.top/images/2025/09/a2767e93ec0e65298e832c5f726dcb31.jpg
```

becomes:

```text
source/images/ai/agent/2026/08/images-2025-09-a2767e93ec0e65298e832c5f726dcb31.avif
```

and the Markdown reference becomes:

```text
/images/ai/agent/2026/08/images-2025-09-a2767e93ec0e65298e832c5f726dcb31.avif
```

The local filename is derived from the URL pathname:

1. remove the leading `/`
2. replace `/` path separators with `-`
3. replace the original extension with `.avif`
4. ignore URL query strings and fragments

## Error behavior

Image processing is serial.

A normal image failure such as HTTP 403/404, timeout, download failure, or decoding failure is logged. That image keeps its original remote URL and processing continues with subsequent images.

If two different remote URLs resolve to the same destination path, processing stops before any download or Markdown mutation. The error prints:

- destination path
- first Markdown file and remote URL
- conflicting Markdown file and remote URL

This collision requires manual intervention.

## Configuration

Optional `_config.yml` settings:

```yaml
image_avif:
  enable: true
  quality: 75
  effort: 4
  timeout: 30000
```

## Development

```bash
npm install
npm test
```

## License

MIT
