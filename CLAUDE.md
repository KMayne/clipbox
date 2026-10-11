# Clipbox

Paste anything (text/JSON/CSV/HTML/image/file), inspect it (interpretations, preview, stats, schema), and later transform it with a typed node graph. Web app, Chromium only, no backend.

Plan: `~/.claude/plans/hi-claude-i-d-like-linked-hare.md`. Done: Deliverable 1a and Batch A (modules, values in the worker, Monaco, language detection, offline cache). Type assertions are banned (see Conventions). Batch B is done: persistence, YAML/XML, Markdown/NDJSON, derived captures ("Open as…") + base64/JWT, value decoders (timestamp/uuid/url/colour) and the lazy `x509` PEM module. Next: Batch C (binary formats: archives, PDF, audio, video, spreadsheets, SQLite); archives open entries as derived captures.

## Commands
- `pnpm dev` — Vite dev server
- `pnpm test` — Vitest unit tests (`tests/unit`)
- `pnpm test:e2e` — Playwright, two projects:
  - `dev`: dev server, synthetic `ClipboardEvent`/`DragEvent`
  - `preview`: production build plus `vite preview`, for Service Worker and offline tests (`offline.spec.ts`)
- `pnpm typecheck` (main tsconfig plus `tsconfig.sw.json` for the service worker), `pnpm lint` (zero warnings), `pnpm build`

Node lives under nvm: `export PATH=~/.nvm/versions/node/v26.11.1/bin:$PATH`.

## Architecture
- `src/core/` — pure TS, no React.
  - `types.ts`: Summary, Schema, ValueHandle, SliceRequest, Interpretation status.
  - `interpreters/`: one file per core kind (detect → parse(ctx) → label/summarise/slice/export).
  - `schema.ts` (inference plus TS rendering) and `magic.ts` (format and dimensions from file headers).
- `src/engine/` — `Engine` runs in a Web Worker via Comlink.
  - **Values never leave the worker.** The UI gets a `Summary` and fetches windows of data with `engine.slice` (`valueHandle.ts`).
  - Ingest has two phases: `ingest` returns interpretations as `ready`, `loading` or `off`, and `resolve` loads the needed modules and finishes parsing.
- `src/modules/` — lazily-loaded feature modules.
  - `registry.ts`: metadata and cheap detectors, shared by both threads.
  - `workerLoaders.ts` / `uiLoaders.ts`: the `import()` for each half. These are kept separate so the worker build doesn't pull in UI chunks and vice versa.
  - Policies are Auto, Preload or Off, stored in localStorage under `clipbox.modules`.
  - Interpreters use module services through `ctx.service(id)`, which returns null when the module is off or fails to load.
  - Current modules: `editor` (Monaco, UI only), `langdetect` (VS Code's ML model, worker only) and `x509` (PEM certificates and keys, worker only, `@peculiar/x509`).
- `src/sw.ts` + `vite/modulesManifest.ts` — the plugin maps each module's entry to its files (chunks, workers, assets), emits `modules-manifest.json`, and emits `sw.js` with the manifest inlined. The SW precaches the core files and handles per-module download, remove and update. It only runs in production builds. `src/swClient.ts` is the page side.
- `src/capture/` — capture sources (paste, read, drop, file) → `captureStore.add()`.
- `src/state/` — Zustand stores (`captureStore`, `moduleStore`, `uiStore`).
- `src/state/persistence.ts` — saves captures to IndexedDB (idb-keyval). Metadata and blobs live in separate databases, and blobs are keyed by SHA-256 and garbage-collected. It's on by default with a 7-day expiry (Settings → History). Records are validated with Zod on read. It talks to the store through the `CaptureHost` interface, so it doesn't import the store (that would start the worker in Node tests).
- `src/components/` — Emotion CSS, with dark theme tokens in `src/theme.ts`. Previews live in `components/previews/`. `ModulePreview` lazy-loads a module's preview and falls back to the core one.

## Conventions
- **No type assertions:** `as` (other than `as const`) and non-null `!` are lint errors. Instead:
  - narrow with checks;
  - use the guards in `src/core/guards.ts` (`isRecord`, `defined`, `hasKind`);
  - or fix the types.
- **Zod at trust boundaries:** localStorage, `fetch`/`JSON.parse` results, messages, and values arriving from the worker (`engine/valueHandle.ts` validates every slice).
  - Exception: `src/sw.ts` isn't bundled, so it narrows by hand.
- **New kinds:**
  - Write an `Interpreter<V>` whose value is tagged `{ kind: '<kind>', … }`, with `isValue: v => hasKind(v, '<kind>')`, and add it with `register()`. The registry stores type-erased `AnyInterpreter`s that check values on every call.
  - Previews read data through the typed `ValueHandle` methods (`lines`, `rows`, `children`, `bytes`, `text`, `image`, `json`).
- **Derivations:** interpreters can offer `derivations`/`derive` ("Open as…"). The engine returns the bytes, and `captureStore.derive` adds a `'derived'` capture with a `parent` link, which persistence also stores.
- **Bytes** are `Uint8Array<ArrayBuffer>` throughout. `crypto.subtle` and `Blob` need ArrayBuffer-backed bytes.

## Gotchas
- Import `{ Icon }` from `@mdi/react` (named), the default import breaks under Vite 8.
- TypeScript pinned to 6.x: typescript-eslint doesn't support TS 7 yet.
- Playwright:
  - Its `request` event fires for CSP-blocked requests too; check `requestfailed` errorText `csp`.
  - It can't route the browser's Service Worker update check; tests edit `dist/sw.js` instead.
- `@vscode/vscode-languagedetection` is patched (`patches/`): its webpack chunk `require` is made static so Rolldown can bundle it.
- The user's shell exports `NODE_ENV=development`, so `pnpm build` pins `NODE_ENV=production`. Without it you get the development build of React.
- Lazily-imported dependencies must be listed in `optimizeDeps.include`. Otherwise the dev server reloads the page on first use, which makes the e2e tests flaky.
- The SW looks up the cache with `ignoreVary` (files are content-hashed). `vite preview` sends `Vary: Origin`, which would otherwise cause cache misses.
