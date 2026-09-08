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
- HTML image tags: `<img src="...">`, including images inside `{% waterfall %}` blocks

Only `http://` and `https://` URLs are processed. Empty and already-local references are ignored. HTML `<img>` tags inside fenced code blocks or inline code are ignored.

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

## Plugin ordering

Automatic processing is registered on Hexo's `after_init` filter with priority `0` by default. Hexo executes lower filter priorities first, so this runs before plugins that use the default filter priority `10`. You can override it with `image_avif.priority`.

Image localization therefore finishes before post rendering begins. Plugins such as `hexo-plugin-waterfall` parse their `{% waterfall %}` content later during tag rendering, so they receive the already-rewritten local AVIF `src` values instead of the original remote URLs.

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

## Concurrent processing

The plugin first scans all Markdown files and collects every image reference. References that resolve to the same full `targetPath` are grouped into one conversion task, so concurrent workers never write the same destination file at the same time.

Only image conversion runs concurrently. Markdown discovery happens before conversion, and Markdown replacement happens only after all conversion tasks finish.

Concurrency is enabled by default. When `concurrency` is omitted or set to `0`, the worker count uses Node.js `os.availableParallelism()`, which reflects the CPU parallelism available to the host/container. Set `concurrent: false` to force serial image processing.

If a destination AVIF already exists, the task is reused immediately without downloading or converting the remote image.

## Size target and recursive compression

Each remote image is downloaded once. AVIF attempts always start from the original downloaded bytes; the plugin never re-encodes a previously generated AVIF.

The first attempt uses `quality`. If the result exceeds `max_size_kb`, the plugin recursively searches lower AVIF quality values for the highest quality result that fits the target. The search is bounded by `max_compress_attempts`, including the first encoding attempt.

Defaults:

- target size: `100 KB` (`100 * 1024` bytes)
- maximum attempts: `6`
- initial/maximum searched quality: `75`

If no attempt can reach the target size, the smallest result found is still written and the plugin logs a `SIZE_TARGET_MISS` warning. The conversion is still considered successful and the Markdown URL is rewritten. The plugin does not resize image dimensions to force the target size.

## Error behavior

A normal image failure such as HTTP 403/404, timeout, download failure, or decoding failure is logged. That target keeps its original remote references and processing continues with other image tasks.

If multiple remote references resolve to the same full destination path, they share one conversion task and are rewritten to the same local path after that task succeeds.

This also applies when the same image appears in multiple Markdown files or when URL query strings/fragments differ but resolve to the same local filename.

## Configuration

Optional `_config.yml` settings:

```yaml
image_avif:
  enable: true
  priority: 0
  quality: 75
  effort: 4
  timeout: 30000

  handle_subffix:
    - '*'

  concurrent: true
  concurrency: 0

  max_size_kb: 100
  max_compress_attempts: 6
```

Ordering behavior:

- `priority` omitted: use `0`
- lower `priority` values run earlier than higher values for the same Hexo filter
- the plugin still runs on `after_init`, before post/tag rendering

`handle_subffix` behavior:

- omitted: process all remote image URLs
- `[]`: process all remote image URLs
- contains `*`: process all remote image URLs
- `['.png', '.jpg']`: only process URLs whose pathname ends in `.png` or `.jpg`

Concurrency behavior:

- `concurrent` omitted or `true`: enable concurrent conversion
- `concurrent: false`: process conversion tasks serially
- `concurrency` omitted or `0`: use `os.availableParallelism()`
- `concurrency: 4`: run at most 4 image conversion tasks simultaneously

Compression behavior:

- `max_size_kb` omitted: target `100 KB`
- `max_compress_attempts` omitted: try at most `6` AVIF encodings
- `quality` is the first attempt and the upper bound of the recursive quality search
- reaching the size target is best-effort; dimensions are never reduced automatically

## Development

```bash
npm install
npm test
```

## License

MIT
