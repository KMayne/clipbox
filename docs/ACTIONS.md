# Candidate actions by kind

Copied from the actions plan (`~/.claude/plans/ok-next-i-want-delegated-nest.md`, which lives outside
the repo). Pick batch 2 from this list. To add one, follow "New actions" in `CLAUDE.md`.

Legend:

- ✅ = implemented as an action (the framework's proof actions, on `feat/actions`).
- ✓ = already exists as a derivation (shown in the Actions sidebar's Open group); it becomes an action
  later.
- **Bold** = recommended for the first batch.

### Every kind

- **Copy** ✓ · **Download** (raw bytes, sensible filename and extension) · **Hash**: SHA-256/SHA-1/SHA-512 of the raw bytes (`core/hash.ts`) ✅ (also SHA-384) · **Open as text** ✅ (UTF-8, Latin-1/Windows-1252, UTF-16 LE/BE; offered when the bytes aren't already UTF-8 text) / **Open as hex dump** ✅ (`any.hexDump`, `hexdump -C` style, 8/16/32 bytes per row, first 16 MiB)

### Text

- **Trim** ✅ (leading/trailing/both; each line or whole), **remove blank lines** ✅, **sort lines** ✅ (A → Z / Z → A, natural order), **dedupe lines** ✅ (order-keeping, optionally ignoring case; also Sort lines' "Remove duplicates"), **reverse lines** ✅, number lines
- **Change case** ✅: UPPER, lower, Title, camelCase, snake_case, kebab-case; slugify (not done)
- **Find & replace** (regex, param) ✅
- **Encode/decode** ✅ (`text.encode` / `text.decode`, a format setting): base64 (standard or URL-safe; decoding ignores whitespace, and non-text bytes come out as binary), URL percent-encoding (component, where decoding also reads `+` as a space, or full URL), HTML entities (the HTML 4 named set plus numeric, in `core/htmlEntities.ts`; optional `&#N;` for non-ASCII), JSON string escape/unescape (optional quotes and `\uXXXX`)
- **Split lines → JSON array** ✅ (trim and skip-empty settings); wrap at N columns

### JSON

- **Format** (2-space) ✅ (2 spaces, 4 spaces or tabs) · **Minify** ✅ · **Sort keys** ✅
- **To YAML** ✅ · **To CSV** ✓ (arrays of objects) · **To NDJSON** ✅ (arrays only) · to XML
- **Generate TypeScript types** (`schemaToTs` in `core/schema.ts`) ✅ (root type name param) · generate JSON Schema
- **Flatten to dot-path keys** ✅ (separator setting; indices as `a.0.b` or `a[0].b`; empty objects and arrays kept as leaves) · unflatten
- **Pick by path / JSONPath** ✅: RFC 9535 in `core/jsonPath.ts`, parsed and evaluated without `eval`: `$.a.b`, `['key']`, `*`, `..`, indices, negative indices, slices (RFC rules, negative steps), unions, and filters `[?@.price < 10 && @.tags]` (also `[?(…)]`): `== != < <= > >=`, `&&`, `||`, `!`, parentheses, existence tests, nested `@`/`$` queries and the functions `length()`, `count()`, `match()`, `search()`, `value()`. Extensions: `=~ /regex/flags` and `in` (`@.x in ['a','b']`, `'a' in @.tags`). Comparisons need single-value queries, as in the RFC (a clear error otherwise). Leniencies: bare `a.b`, `-` and `$` in member names. Also offered for records (the rows as an array of objects). A definite path gives the value, others an array of matches (or always an array, a setting) · stringify as a string literal

### Query and group (JSON arrays of objects and records)

The `query` area files (`catalog/query.ts`, `run/query.ts`). Fields are a dot path (`user.country`, `tags[0]`; an exact key with dots wins) or, for records, a column name or 1-based number; an unknown field's error lists the fields (columns, or paths inferred from the schema).

- **Group by** ✅: outputs: Summary table (key, count and aggregates such as `sum:price, avg:age`; functions count, sum, avg, min, max, distinct, first, last, with `mean`/`average`/`unique` aliases; columns named `sum_price`), Object of arrays (`{ "UK": [...] }`, written in the chosen order even for number-like keys) or Array of groups (`[{ key, count, items }]`). Sort by key (natural, numbers numerically) or count, either way, or first seen; ties keep first-seen order. Missing values group as `(none)` (last for key orders) or are skipped; for records, empty cells are missing. Keys: numbers, booleans and null spelled out, so `1` and `"1"` share a group (the first value seen is kept). Summary tables are CSV (TSV for tab sources) from delimited records, else JSON; files named e.g. `people-by-team.csv`.
- **Count by** ✅ (key and count, largest first) · **Distinct values** ✅ (a JSON array; first seen, A → Z or most common first)
- All three report progress ("Grouping N items", then "Summarising N groups") and can be cancelled.
- **jq** ✅ (`query.jq`, the lazy `jq` module: jq 1.8.2 via `jq-wasm`, MIT, ~930 KB wasm): JSON, YAML (several documents are several inputs), NDJSON (one input per line) and records (the rows array). Settings: filter (multiline, default `.`), raw output `-r` (text lines), compact `-c`, slurp `-s`, variables (`name=value` per line for `--arg`, `name:=JSON` for `--argjson`). One output stays as it is; several become a JSON array (pretty or compact); the input is the parsed value re-serialised, so integers beyond 2^53 have already lost digits. jq's compile and runtime errors come back as the notice, on one line; output over 32 MB is refused. Each run goes to a runner worker nested in the engine worker (`modules/jq/runner.worker.ts`; one idle runner is kept warm), so a filter that never ends (e.g. `repeat(.)`) blocks only that: Cancel terminates the runner, as does the Timeout setting (seconds, default 30, 1–300; "jq timed out after 30 s"), which also frees whatever memory the filter took. Progress is an indeterminate "Running jq…".

### Records (CSV/TSV)

- **As JSON** ✓ · **To TSV / To CSV** ✅ (re-reads delimited sources, so cells like `007` and `1.50` stay as written) · **To Markdown table** ✅ (pipes escaped, line breaks as `<br>`; alignment setting, auto right-aligns numeric columns) · to HTML table · to NDJSON
- **To SQL INSERTs** ✅ (table name, which may include a schema; rows per INSERT; empty cells as NULL; dialect for identifier quoting: ANSI, MySQL, PostgreSQL, SQLite. Numbers unquoted except ones with leading zeros, JSON booleans as TRUE/FALSE, MySQL also escapes backslashes) · **Generate TypeScript types** ✅ (row type name)
- **Pick/rename columns** ✅ (`id, 3, name:title`), **sort by column** ✅ (stable; natural, numeric or text; empties last), **filter rows** ✅ (equals, not equals, contains, starts with, regex, >, <, empty, not empty; ignore case). Columns are a header name or a 1-based number. Results keep the source format (same delimiter, JSON array or NDJSON) · dedupe rows · transpose

### NDJSON

- **To JSON array** ✅ (invalid lines skipped; the label notes how many) · **To CSV** ✅ (objects; union of keys) · **Extract invalid lines** ✅ (`12: …`, offered when there are some)

### YAML

- **To JSON** ✅ (several documents become one JSON array, in order, so the result is one value you can keep transforming; the label notes it) · **Format** ✅ (indent setting; comments, anchors and document markers kept) · sort keys

### XML

- **Format** ✅ (indent setting; works on the source text, so comments, CDATA, PIs and attribute order are kept; text-only elements stay inline, and mixed content and `xml:space="preserve"` elements are copied verbatim; `core/xmlFormat.ts`) · **Minify** ✅ (drops whitespace-only text between tags except under `xml:space="preserve"`, tightens tags; optional comment removal) · **To JSON** ✅ (fast-xml-parser; attributes as `@_` keys (prefix setting), grouped under `:@`, or left out; optional number/boolean parsing)

### HTML

- **To Markdown** ✅ (GFM: headings, emphasis, links, images, nested lists, code with language,
  quotes, tables, breaks; scripts and styles dropped) · **To plain text** ✅ (block-aware; setting:
  links as "text (url)") · **Extract links** ✅ (CSV of text, href, title; relative links resolved
  against the Base URL setting, else the document's `<base>`) · **Extract tables → CSV** ✅ (one CSV
  per table, spans filled; several make a collection) · extract images · format/minify · sanitise
- All run on `core/html/`: a small tolerant HTML parser (the worker has no DOM), the converter and an
  allowlist sanitiser. None of them recurse on the call stack (the converter is trampolined with
  `core/trampoline.ts`; the tree walks use explicit stacks), so 10k-deep nesting and 200k-row tables
  work.

### Markdown

- **Render to HTML** ✅ (settings: sanitise, on by default; full document with a title, defaulting to
  the first heading) · **To plain text** ✅ · **Extract links** ✅ · **Extract code blocks** ✅ (each
  fenced or indented block, e.g. `code-2.py`, extension from its language tag; a collection) ·
  **Extract tables → CSV** ✅ · table of contents

### Image

- **Convert** ✅: PNG / JPEG / WebP (re-encoding also strips metadata; quality param; not offered for SVG; works on TIFF/EMF/WMF/PSD/TGA/PCX/HEIC via their first-page render) · **Pages as PNG** ✅ (every page of a multi-page image, e.g. TIFF or a HEIC burst, as one collection) · **Resize** ✅ (75/50/25%, or width/height px with keep-aspect; the browser's
  high-quality resampler) · **Rotate/flip** ✅ (90/180/270, horizontal, vertical; both keep
  PNG/JPEG/WebP, else PNG) · grayscale
- **To data URL** ✅ (also for SVG) · **Read QR/barcode** ✅ (Chromium's `BarcodeDetector`, every
  format and code, where the platform has one: macOS, ChromeOS, Android; elsewhere, e.g. Windows and
  Linux, the `qr` module's jsQR reads one QR code; several codes make a collection) · **Extract
  palette** ✅ (median cut seeding k-means on a 96 px downsample; setting: colours, default 6; each a
  colour capture, as a collection)

### Binary

- **Hex dump** ✅ (the any-kind Hex dump) · **To base64** ✅ (standard or URL-safe; optional 76-column wrap)

### Base64

- **Decode** ✓ · **To data URL** ✅ (MIME from the decoded bytes' signature via `core/magic.ts`, else the text/JSON guess) · switch standard ↔ URL-safe alphabet ✅ (padding: keep, strip or add)

### JWT

- **Open header / payload** ✓ · **Verify signature** ✅ (`crypto.subtle`: HS/RS/PS/ES 256/384/512 and EdDSA; key: HMAC secret (optionally base64), PEM public key, certificate or JWK/JWK set (picked by `kid`); `none` refused, PEM refused for HS*; ES accepts DER signatures too; checks exp/nbf/iat with a clock-skew setting; text report such as `Signature valid (HS256) · expires in 2h`. The key is a `secret` setting: never in labels or results) · claims as JSON

### Timestamp

- **Convert to** ✅ ISO 8601 (UTC or with offset), RFC 2822, Unix seconds, Unix ms, local time (IANA time zone setting, default the browser's; `Intl` only)

### UUID / ULID

- **Format** ✅ (Reformat: lowercase, uppercase, no dashes, braces, URN) · **Extract the embedded time** ✅ (v1/v6/v7/ULID → ISO text, which opens as a timestamp; a clear error for other versions)

### URL

- **Decode / encode** ✅ (Percent-decode / Percent-encode, per line) · **Query string → JSON** ✅ (repeated keys → arrays; several URLs → an array) · **Strip tracking params** ✅ (`TRACKING_PARAMS` in `run/url.ts`: utm_*, fbclid, gclid, dclid, msclkid, mc_eid, igshid, _hsenc, ref_src…, `si` on YouTube/Spotify only; an "extra params" setting with `prefix*`; other params keep their encoding) · **Open in new tab** ✅ (an effect action, see below) · make QR code

### Colour

- **Convert to** ✅ hex, rgb(), hsl(), oklch() (alpha kept; the colour kind now parses `oklch()` too) · **Contrast against white/black** ✅ (Contrast check: WCAG 2 ratios, AA/AAA for normal and large text, optional second colour) · tints and shades

### Archive

- **Open entry** ✓ · **Listing as CSV** ✅ (path, size, compressed size, modified, type; core and
  libarchive formats) · download an entry · extract all (zip download)

### PDF

- **Extract text** ✓ · **Page as PNG** ✓ · **Metadata as JSON** ✅ (pdf module service: info
  dictionary, XMP, page count, sizes and labels, outline, attachments)
- **Extract images** ✅: every distinct image (repeats like a logo on each page dropped by object id,
  then by content) as PNG, one collection capture named `page-03-image1.png`; settings: page range
  (`1-3,7`, empty for all) and minimum size (32 px). Runs in the `pdf` module's service; stops at
  500 images with a `more-images.txt` note.

### PowerPoint (.pptx)

- **Extract images** ✅: every image in `ppt/media`, deduplicated by content, in order of first slide
  use, then unused ones (`slide-03-image2.png`, `unused-image1.png`), one collection capture;
  EMF, WMF and TIFF come out as the original files (previewable through the `imageformats`
  module); settings: slide range, "Convert vector/legacy images to PNG" (off: originals; on: PNG
  renders, one per TIFF page)
- **Extract text** ✅: Markdown, `## Slide N: Title` with the text and `### Notes` beneath (setting:
  include notes) · **Slides as JSON** ✅ (metadata, and each slide's title, text, notes and media)

### Audio / video

- **Cover art** ✓ · **Metadata as JSON** ✅ (media module service: music-metadata's streams, common
  and native tags; pictures described, not embedded) · **Video frame as PNG** ✅ (`audiotools`
  module: Mediabunny and WebCodecs; time setting in seconds, m:ss or %, default 10%; not for AVI or
  Ogg)
- **Normalise audio** ✅ (`media.normalise`, `audiotools` module): two-pass EBU R128 loudness
  normalisation. Pass 1 decodes and measures integrated loudness (BS.1770-4 gating) and true peak
  (4× oversampled); pass 2 applies one constant gain and re-encodes the audio only, copying any
  video track's packets untouched. Settings: target (-14 LUFS, -36 to -5), true-peak ceiling
  (-1 dBTP), Limit peaks (off: the gain is capped at the ceiling and the result named
  "peak-capped"; on: an offline true-peak lookahead limiter reaches the target). The result name
  carries the before loudness and the gain, e.g. `song (normalised -14 LUFS; was -23.1 LUFS,
  +9.1 dB).wav`. Output keeps the container and codec when WebCodecs can encode it (Opus, AAC
  where available, PCM, FLAC), else: lossy audio → Opus in Ogg, lossless → WAV, video → Matroska.
  Reports progress per pass ("Pass 1 of 2 · measuring loudness", "Pass 2 of 2 · encoding", by
  decoded time over the duration) and cancels at the next decoded chunk; not offered for AVI or
  Ogg Theora.

### Spreadsheet

- **Sheet as CSV** ✓ · **Sheet as JSON** ✅ (sheet by name or number; first row as keys, or arrays)
  · **All sheets as JSON** ✅ · sheet as Markdown table

### SQLite

- **Table as CSV** ✓ · **Table as JSON** ✅ (sqlite module service; blobs as `x'…'`) · **Schema
  (CREATE statements) as SQL** ✅ (tables, then indexes, views, triggers) · run a read-only query (param; known gap)

### Executable (PE, ELF, Mach-O)

Parsed in core (`src/core/executable/`), no dependency. Actions in the `executable` area files:

- **Extract icon** ✅: the first icon group as `.ico` (largest image first) plus its largest image as
  PNG (PNG-compressed icons as they are; BMP DIBs decoded and re-encoded in pure TS, no canvas), one
  collection capture
- **Version info as JSON** ✅ · **Imports as CSV** ✅ (dll, function, ordinal, delay_loaded; ELF
  needed libraries and Mach-O dylibs with an empty function) · **Exports as CSV** ✅ (PE exports,
  ELF dynamic symbols) · **Sections as CSV** ✅ · **Extract manifest** ✅ (XML)
- **Extract strings** ✅: ASCII and/or UTF-16LE (both alignments), minimum length (6), optional hex
  offsets; stops at 100,000 strings with a note line
- **Extract overlay** ✅: data after the last section, minus a trailing Authenticode table
- **Extract signing certificates** ✅: the Authenticode / Mach-O CMS certificates as PEM, which the
  x509 module then decodes as usual (so no `ctx.service` call is needed; the signer's subject and
  issuer are read by a small DER walker in core, never verified)

### Playlist (M3U, HLS)

Parsed in core (`src/core/playlist/m3u.ts`), no dependency; nothing a playlist names is ever
fetched (no backend, and CORS usually blocks it). Actions in the `playlist` area files:

- **Resolve URLs** ✅: URI lines and `URI="…"` attributes in tags (keys, maps, renditions, I-frame
  streams, parts, unknown tags) made absolute against a Base URL setting (http(s) only; empty
  leaves the playlist unchanged). Absolute URIs, comments, other tags and line endings stay as they are
- **Segments as CSV** ✅ · **Segments as JSON** ✅ (media playlists: sequence, duration, start,
  byte range, discontinuity, program date-time, key method and URI, init section)
- **Variants as JSON** ✅ (master playlists, source order, with every attribute)
- **URL list** ✅: variant, I-frame, rendition, init-section, segment and track URIs (not key
  URIs), de-duplicated
- Later: Open a variant in a new tab (an `open-url` effect)

### PEM / X.509

- **Certificate details as JSON** ✅ (x509 module service: names, validity, SANs, key usage, EKU, basic constraints, key ids, extensions, fingerprints; leaf first) · **SHA-256 fingerprint** ✅ (Fingerprint: SHA-256, SHA-1 or both, colon-separated uppercase hex, computed in core) · **Extract public key (PEM)** ✅ (SPKI; the leaf, or every block) · PEM ↔ DER

## Notes for batch 2

- **Progress and cancelling** (done, `feat/action-progress`): `ctx.progress(fraction, message?)`
  (0..1, or `undefined` for indeterminate) and a real `ctx.signal`. The engine throttles reports to
  about 10 a second (always sending the last), gives each run an id (`runAction(…, runId)`,
  `derive(…, runId)`), and `engine.cancelAction(runId)` aborts it; `forget`/`clear` abort runs on
  the removed entries. A cancelled run rejects with an AbortError, which the UI treats as quiet
  ("Cancelled"), not a failure notice. UI: `state/runs.ts` (one proxied progress listener,
  validated with Zod; a UI AbortController per run, so Cancel is instant even while the worker is
  busy) and `components/RunProgress.tsx` (the bar under the sidebar row, and the running-actions
  strip above the notice for runs whose row isn't on screen). Bars show only after 300 ms.
  Instrumented: Normalise audio, Video frame as PNG (indeterminate steps), PDF Extract images and
  the Extract text derivation (per page), PowerPoint Extract images, TIFF Pages as PNG, Extract
  strings (per MiB, cancellable), Hash (indeterminate: `crypto.subtle` can't stream), records
  Sort, Filter, Pick columns, To CSV/TSV and To SQL (per row), Image resize (indeterminate). The
  rest are quick single calls (one `JSON.parse`, one `Array.sort`, one canvas encode) with no loop
  to report from; they still get an indeterminate "Working…" bar and a Cancel that drops the
  result if they take over 300 ms.

- Results can set `note` on `DerivedContent` (e.g. "2 invalid lines skipped"); the UI appends it to the capture's label.
- Actions that don't produce a new capture: set `effect: 'open-url'` in the catalog entry and use
  `implementEffect` in `run/`, returning `{ effect: 'open-url', url }`. The engine's `actionEffect`
  returns it, and `state/effects.ts` validates it with Zod (http(s) only) and performs it
  (`window.open` with `noopener`). Add new effect types to `ActionEffect` and that schema. Copy and
  Download stay UI commands.
- Multi-output actions return `DerivedContent[]`, which becomes one collection capture (done; used
  by PDF and PowerPoint Extract images). Extract palette and archive "extract all" can use it too.
- Actions on lazy-module kinds (PDF, spreadsheet, SQLite, PEM, media) get a value the module has
  already parsed. Their `run/` file must not import the module's code (that would bundle it into the
  core worker chunk): narrow the value with a light guard (e.g. from the module's `types.ts`), and
  when the module's library is needed, set `module` in the catalog and call
  `ctx.service(id, guard)` in `run`.
