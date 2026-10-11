# Candidate actions by kind

Copied from the actions plan (`~/.claude/plans/ok-next-i-want-delegated-nest.md`, which lives outside
the repo). Pick batch 2 from this list. To add one, follow "New actions" in `CLAUDE.md`.

Legend:

- ✅ = implemented as an action (the framework's proof actions, on `feat/actions`).
- ✓ = already exists as a derivation (shown in the Actions sidebar's Open group); it becomes an action
  later.
- **Bold** = recommended for the first batch.

### Every kind

- **Copy** ✓ · **Download** (raw bytes, sensible filename and extension) · **Hash**: SHA-256/SHA-1/SHA-512 of the raw bytes (`core/hash.ts`) ✅ (also SHA-384) · **Open as text** / **Open as hex dump**

### Text

- **Trim**, **remove blank lines**, **sort lines** ✅ (A → Z / Z → A, natural order), **dedupe lines** ✅ (Sort lines' "Remove duplicates"; an order-keeping dedupe is still open), **reverse lines**, number lines
- **Change case** ✅: UPPER, lower, Title, camelCase, snake_case, kebab-case; slugify (not done)
- **Find & replace** (regex, param) ✅
- **Encode/decode**: base64, URL (percent), HTML entities, JSON string escape/unescape
- **Split lines → JSON array**; wrap at N columns

### JSON

- **Format** (2-space) ✅ (2 spaces, 4 spaces or tabs) · **Minify** ✅ · **Sort keys** ✅
- **To YAML** ✅ · **To CSV** ✓ (arrays of objects) · **To NDJSON** (arrays) · to XML
- **Generate TypeScript types** (`schemaToTs` in `core/schema.ts`) ✅ (root type name param) · generate JSON Schema
- **Flatten to dot-path keys** · unflatten
- **Pick by path / JSONPath** (param) · stringify as a string literal

### Records (CSV/TSV)

- **As JSON** ✓ · **To TSV / To CSV** (swap delimiter) · **To Markdown table** · to HTML table · to NDJSON
- **To SQL INSERTs** (param: table name) · **Generate TypeScript types**
- **Pick/rename columns**, **sort by column**, **filter rows** (params) · dedupe rows · transpose

### NDJSON

- **To JSON array** · **To CSV** (objects) · **Extract invalid lines**

### YAML

- **To JSON** · **Format** · sort keys

### XML

- **Format** · **Minify** · **To JSON**

### HTML

- **To Markdown** (roadmap extra) · **To plain text** · **Extract links** (→ records: text, href) · **Extract tables → CSV** · extract images · format/minify · sanitise

### Markdown

- **Render to HTML** · **To plain text** · **Extract links** · **Extract code blocks** · **Extract tables → CSV** · table of contents

### Image

- **Convert** ✅: PNG / JPEG / WebP (re-encoding also strips metadata; quality param; not offered for SVG) · **Resize** (presets 50%/25%, or a width param) · **Rotate/flip** · grayscale
- **To data URL / base64** · **Read QR/barcode** (Chromium's `BarcodeDetector`) · **Extract palette** (dominant colours → colour captures)

### Binary

- **Hex dump** · **To base64**

### Base64

- **Decode** ✓ · **To data URL** · switch standard ↔ URL-safe alphabet

### JWT

- **Open header / payload** ✓ · **Verify signature** (param: HMAC secret or public key, via `crypto.subtle`) · claims as JSON

### Timestamp

- **Convert to** ISO 8601, RFC 2822, Unix seconds, Unix ms, local time

### UUID / ULID

- **Format**: uppercase, no dashes, braces, URN · **Extract the embedded time** (v1/v6/v7/ULID → timestamp)

### URL

- **Decode / encode** · **Query string → JSON** · **Strip tracking params** (utm_*, fbclid, gclid…) · **Open in new tab** · make QR code

### Colour

- **Convert to** hex, rgb(), hsl(), oklch() · **Contrast against white/black** · tints and shades

### Archive

- **Open entry** ✓ · **Listing as CSV** · download an entry · extract all (zip download)

### PDF

- **Extract text** ✓ · **Page as PNG** ✓ · **Metadata as JSON**

### Audio / video

- **Cover art** ✓ · **Metadata as JSON** · **Video frame as PNG** (at a time param)

### Spreadsheet

- **Sheet as CSV** ✓ · **Sheet as JSON** · **All sheets as JSON** · sheet as Markdown table

### SQLite

- **Table as CSV** ✓ · **Table as JSON** · **Schema (CREATE statements) as SQL** · run a read-only query (param; known gap)

### PEM / X.509

- **Certificate details as JSON** · **SHA-256 fingerprint** · **Extract public key (PEM)** · PEM ↔ DER

## Notes for batch 2

- Actions that don't produce a new capture (Copy, Download, Open in new tab) don't fit
  `run → DerivedContent` yet; they need a small extension (e.g. a result type that the UI handles
  instead of adding a capture).
- Multi-output actions (Extract palette → several colour captures, extract all) likewise need a
  result with several entries.
- Actions on lazy-module kinds (PDF, spreadsheet, SQLite, PEM, media) get a value the module has
  already parsed. Their `run/` file must not import the module's code (that would bundle it into the
  core worker chunk): narrow the value with a light guard (e.g. from the module's `types.ts`), and
  when the module's library is needed, set `module` in the catalog and call
  `ctx.service(id, guard)` in `run`.
