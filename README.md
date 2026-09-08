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

By default, every remote image URL is attempted. You can limit processing by URL pathname suffix with `image_avif.handle_subffix`.

```yaml
image_avif:
  handle_subffix:
    - .png
    - .jpg
    - .jpeg
    - .svg
```

Suffix matching is case-insensitive and ignores URL query strings and fragments. An omitted or empty `handle_subffix`, or a list containing `*`, processes all remote image URLs, including URLs without a file extension.

SVG input is supported through Sharp and is rasterized at 144 DPI before AVIF encoding.

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

If multiple remote references resolve to the same full destination path, the first one that successfully creates the AVIF file wins. Later references check the destination before downloading; when the file already exists, it is reused directly and the Markdown URL is rewritten to the same local path.

This also applies when the same image appears in multiple Markdown files or when URL query strings/fragments differ but resolve to the same local filename.

## Configuration

Optional `_config.yml` settings:

```yaml
image_avif:
  enable: true
  quality: 75
  effort: 4
  timeout: 30000
  handle_subffix:
    - '*'
```

`handle_subffix` behavior:

- omitted: process all remote image URLs
- `[]`: process all remote image URLs
- contains `*`: process all remote image URLs
- `['.png', '.jpg']`: only process URLs whose pathname ends in `.png` or `.jpg`

## Development

```bash
npm install
npm test
```

## License

MIT
