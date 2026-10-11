# Clipbox

Paste anything and see what it is. Clipbox reads every format on the clipboard (or a dropped or
opened file), works out the ways it can be interpreted, and shows a preview, stats and an inferred
schema for each. A node graph for transforming the data is planned.

Chromium only. No backend: everything runs in your browser, and pastes are kept on this device
(IndexedDB, 7 days by default; see Settings → History).

Source: https://github.com/KMayne/clipbox

## What it understands

- **Data:** JSON, NDJSON, CSV/TSV records, YAML, XML, HTML, Markdown
- **Text and code:** language detection plus a Monaco preview
- **Small values:** timestamps, UUID/ULID, URLs (with a query table), colours, base64/data URLs, JWTs
- **Binary:** images, archives (zip, gzip, tar, 7z, RAR, tar.xz, tar.bz2, zstd), PDF, audio, video,
  spreadsheets (xlsx/xlsm/xlsb/ods/xls), SQLite, PEM certificates and keys

The heavy formats load as optional modules. Settings → Modules lets you choose Auto, Preload or
Off for each one, and download them for offline use. "Open as…" turns a value into a new capture,
e.g. decoding base64, opening a file inside an archive, or a sheet as CSV.

## Development

```sh
pnpm install
pnpm dev          # Vite dev server
pnpm test         # unit tests (Vitest)
pnpm test:e2e     # end-to-end tests (Playwright: dev server + production preview)
pnpm typecheck
pnpm lint
pnpm build        # set BASE_PATH=/some/path/ to serve from a subpath
```

See `CLAUDE.md` for the architecture and conventions.

## TODO

### Archive support
- [ ] Add 7z and RAR test fixtures. Both formats are read by libarchive but are untested here.
- [ ] Support single-file `.xz` and `.bz2` streams. Only their tar forms work today; the bundled
      libarchive.js build has no "raw" format, so these show as "unsupported".
- [ ] Show modified dates for 7z/RAR/xz/bz2 entries. libarchive.js only exposes `mtime_nsec`, not
      the mtime itself.
- [ ] Password-protected and encrypted archives: prompt for a password instead of failing.
- [ ] Open nested archives in place (e.g. a `.tar.gz` inside a zip) rather than as a separate
      derived capture.
- [ ] Stream very large archives instead of holding the whole file in memory.

## Licence

MIT, see `LICENSE`. Third-party notices are in `NOTICE`.
