# Clipbox

Paste anything (text/JSON/CSV/HTML/image/file), inspect it (interpretations, preview, stats, schema), and later transform it with a typed node graph. Web app, Chromium only, no backend.

Progress and remaining work: `docs/PROGRESS.md`. Original plan: `~/.claude/plans/hi-claude-i-d-like-linked-hare.md` (local to the original machine). Done: Deliverable 1a and Batch A (modules, values in the worker, Monaco, language detection, offline cache). Type assertions are banned (see Conventions). Batches A–C are done. The kinds are: core (JSON, records, text, HTML, image, binary, YAML, XML, Markdown, NDJSON, base64, JWT, timestamp, UUID, URL, colour, archive for zip/gzip/tar, presentation for PowerPoint .pptx) plus lazy modules. Actions framework done on `feat/actions` (batch 2 to pick from `docs/ACTIONS.md`). Next: Deliverable 1b (canvas and graph) / Deliverable 2 (ops).

## Commands
- `pnpm dev` — Vite dev server
- `pnpm test` — Vitest unit tests (`tests/unit`)
- `pnpm test:e2e` — Playwright, two projects:
  - `dev`: dev server, synthetic `ClipboardEvent`/`DragEvent`
  - `preview`: production build plus `vite preview`, for Service Worker, offline, background-download and PWA tests (`offline.spec.ts`, `background.spec.ts`, `pwa.spec.ts`)
  - `mobile.spec.ts` runs in `dev` as a Pixel 7 (`test.use(devices['Pixel 7'])`).
- `pnpm typecheck` (main tsconfig plus `tsconfig.sw.json` for the service worker), `pnpm lint` (zero warnings), `pnpm build`

Node lives under nvm: `export PATH=~/.nvm/versions/node/v26.11.1/bin:$PATH`.

## Architecture
- `src/core/` — pure TS, no React.
  - `types.ts`: Summary, Schema, ValueHandle, SliceRequest, Interpretation status.
  - `interpreters/`: one file per core kind (detect → parse(ctx) → label/summarise/slice/export).
  - `schema.ts` (inference plus TS rendering) and `magic.ts` (format and dimensions from file headers).
- `src/engine/` — `Engine` runs in a Web Worker via Comlink.
  - **Values never leave the worker.** The UI gets a `Summary` and fetches windows of data with `engine.slice` (`valueHandle.ts`).
  - Ingest has two phases: `ingest` returns interpretations as `ready` or `loading`, and `resolve` loads the needed modules and finishes parsing.
- `src/modules/` — lazily-loaded feature modules.
  - `registry.ts`: metadata and cheap detectors, shared by both threads.
  - `workerLoaders.ts` / `uiLoaders.ts`: the `import()` for each half. These are kept separate so the worker build doesn't pull in UI chunks and vice versa.
  - There are no per-module policies: every module loads when a paste first needs it. One global **Module downloads** setting (`modules/downloadMode.ts`, localStorage `clipbox.moduleDownloads`, Zod-validated) decides what goes into the offline cache: Automatic (default; background downloads on fast connections), On demand (none) or Everything now (all, whatever the connection). It's UI-thread only; the worker doesn't need it. On load it migrates the old `clipbox.backgroundDownloads` toggle (off → On demand) and deletes it and the old `clipbox.modules` policies.
  - `libraries.ts`: each module's main library (display name and npm package). It has no imports because `vite/modulesManifest.ts` loads it too.
  - Interpreters use module services through `ctx.service(id)`, which returns null when the module fails to load (or has no loader).
  - Current modules:
    - `editor`: Monaco, UI only.
    - `langdetect`: VS Code's ML model.
    - `x509`: PEM, using `@peculiar/x509`.
    - `media`: audio and video, using music-metadata.
    - `sheets`: SheetJS, from the CDN tarball, Apache-2.0.
    - `sqlite`: sql.js WASM, read-only.
    - `pdf`: pdf.js in fake-worker mode inside the engine worker, rendering pages to PNG with `OffscreenCanvas`.
    - `libarchive`: 7z, RAR, tar.xz, tar.bz2 and zstd, owning the same `archive` kind as core.
    - `audiotools`: Mediabunny (MPL-2.0) for decode, re-encode (WebCodecs) and remux; owns no kinds, only serves the Normalise audio action. Its BS.1770 loudness, true-peak and limiter DSP is pure TS beside it (`loudness.ts`, `truePeak.ts`, `limiter.ts`).
  - Every module except `editor` is worker-only; their previews live in core.
- `src/state/backgroundDownloads.ts` (with the pure rules in `modules/backgroundPolicy.ts`) — on a fast, apparently unmetered connection (4G-class, at least 5 Mbps, Data Saver off, not cellular, read from `navigator.connection`), downloads modules into the SW cache while idle, smallest first, when the setting is Automatic; Everything now skips the connection and idle checks. The setting and status are in Settings → Modules, whose rows are status-only (library and version, size, state). The e2e tests fake `navigator.connection` with `addInitScript`.
- `src/sw.ts` + `vite/modulesManifest.ts` — the plugin maps each module's entry to its files (chunks, workers, assets), emits `modules-manifest.json` (including each module's library version, read from `node_modules/<package>/package.json`; absent in dev), and emits `sw.js` with the manifest inlined. The SW precaches the core files and handles per-module download, repair (delete and re-download this version's caches) and update. Settings shows the manifest hash as the app version with the build date (`__BUILD_DATE__`, a `define`, via `src/buildInfo.ts`), plus Check for updates and Repair offline cache. It only runs in production builds. `src/swClient.ts` is the page side.
- `src/core/actions/` — one-step transforms that turn a value into a new derived capture (the op registry Deliverable 2 will chain).
  - `catalog/<area>.ts` + `catalog/index.ts`: metadata only (`ActionInfo`: id, title, group, kinds, Zod `params`, optional `module`, optional `label`). Loaded by both threads, so no heavy imports.
  - `run/<area>.ts` + `run/index.ts`: worker implementations made with `implement(info, { value, applies?, run })`. Only the engine imports them.
  - `form.ts`: settings forms generated from `z.toJSONSchema(params)` (string with `hint: 'multiline' | 'regex'`, number with min/max, boolean, enum with `optionLabels`), and `actionLabel` for the derived capture's parent label.
  - Engine: `actions(entryId, kind)` lists applicable ids; `runAction(entryId, kind, id, params)` validates `params` in the worker, then runs. `captureStore.runAction` adds the result as a `'derived'` capture.
  - UI: `components/Sidebar.tsx` is the right sidebar (toggled with `A` or the top bar's panel icon), with three collapsible sections: Info (the value's stats, `I` toggles it), Actions (`components/ActionsPane.tsx` `ActionsSection`) and Schema (collapsed by default). Open state and expanded sections are in localStorage `clipbox.sidebarOpen` / `clipbox.sidebarSections`. The Inspector has a view switcher, Preview / Split / Raw (1–3). Split puts the source beside the preview: raw text, or a hex dump for binary kinds (`isBinaryKind` in `core/kinds.ts`; bytes via `engine.rawBytes`). The view is remembered per class in `clipbox.inspectorView` (`state/views.ts`): text-based kinds default to Split, binary ones to Preview. Plain text and plain binary don't split, since their preview already is the source. Palette entries come from `commands.ts` `selectionCommands`. Derivations show in the sidebar's Open group. Candidate actions and what's done: `docs/ACTIONS.md`.
- **PWA** (installable, Chromium):
  - `vite/pwa.ts` builds the web app manifest from Vite's `base` (`id`, `start_url`, `scope`, `share_target`, `file_handlers`, `launch_handler: navigate-existing`, `handle_links`), emits it and the icons in `vite/icons/` into the bundle (so the SW precaches them with the core), and injects the head tags (manifest, `theme-color`, icons, iOS meta). The dev server serves the same files.
  - The icons are committed PNGs. `node scripts/icons.ts` regenerates them from the top bar's MDI mark in Nord, using Playwright's Chromium.
  - Install UX: `state/install.ts` keeps the deferred `beforeinstallprompt`. "Install app" shows in the palette and Settings → App until `appinstalled` or `display-mode: standalone`. `src/pwa.d.ts` types the Chromium-only APIs.
  - **Share target:** Android's share sheet POSTs multipart form data to `<base>share-target`. `sw.ts` stashes each field in the `clipbox-share` cache (headers carry the field and file name) and redirects to `?share=<id>`. At startup `capture/share.ts` reads the stash (validated in `sharePayload.ts`), adds a `'share'` capture and deletes it. The shared string constants are typed with literal types in `swProtocol.ts`, so the SW's copies can't drift. Files opened with the installed desktop app arrive through `launchQueue` as `'file'` captures.
- **Mobile layout:** below 768 px (`MOBILE_QUERY` in `components/ui.ts`, `useIsMobile()`), `App` swaps the resizable panes for `MobileLayout`: one pane at a time (`uiStore.pane`: Pastes, Inspector, or the sidebar as "Actions") above a bottom navigation bar. A new capture (`state/mobileNav.ts`, on `added`) or choosing a chip or collection goes to the Inspector. The top bar is compact (Read clipboard as the primary button; icon buttons for Open file, Commands and Settings). Use `media.touch` for 40 px touch targets and show hover-only controls on touch; the bars pad for `env(safe-area-inset-*)` (`viewport-fit=cover`).
- `src/capture/` — capture sources (paste, read, drop, file, share) → `captureStore.add()`.
- **Collections** — a capture with 2+ entries (a multi-file drop, or an action's several results as one `'derived'` capture).
  - `captureStore.collection` (exclusive with `selection`) shows `components/CollectionView.tsx` in the Inspector: a tile grid (lazy `<img>` thumbnails from `thumbUrl`, arrows/Home/End/Enter), count, total size and parent link. Selected by clicking the capture header (the chevron collapses), by `j`/`k`/arrows (`navOrder` puts collection headers before their chips), and auto-selected for multi-result derived captures. Enter in the Pastes pane focuses the grid.
  - The Pastes pane lists the first `ENTRY_PREVIEW_LIMIT` entries (compact rows past 4) until "Show all"; `select()` expands a capture so the chosen entry is visible.
  - `capture/saveFiles.ts`: **Download** (one entry's raw blob via `<a download>`) and **Download all** (`showDirectoryPicker`, progress notice with Cancel, never overwrites files already in the folder). Names come from `core/filenames.ts` (own name, else `<kind>-<n>.<ext>` from the MIME; de-duplicated case-insensitively as "name (2).ext").
- `src/state/` — Zustand stores (`captureStore`, `moduleStore`, `uiStore`).
- `src/state/persistence.ts` — saves captures to IndexedDB (idb-keyval). Metadata and blobs live in separate databases, and blobs are keyed by SHA-256 and garbage-collected. It's on by default with a 7-day expiry (Settings → History). Records are validated with Zod on read. It talks to the store through the `CaptureHost` interface, so it doesn't import the store (that would start the worker in Node tests).
- `src/components/` — Emotion CSS. Colour schemes live in `src/theme.ts`: Nord (default), Tokyo Night, Catppuccin Mocha, One Dark and Gruvbox. Each scheme supplies the same neutrals and hues, and the semantic `theme`, `syntax` and `kindColors` tokens (plus the Monaco theme) derive from the active one. The scheme is chosen once at load: `?theme=<id>` wins (for previews), then the saved choice (localStorage `clipbox.theme`, set in Settings → Appearance, which reloads the page), then Nord. Components use the tokens and never hard-code colours. Previews live in `components/previews/`. `ModulePreview` lazy-loads a module's preview and falls back to the core one.

## Conventions
- **No type assertions:** `as` (other than `as const`) and non-null `!` are lint errors. Instead:
  - narrow with checks;
  - use the guards in `src/core/guards.ts` (`isRecord`, `defined`, `hasKind`);
  - or fix the types.
- **Zod at trust boundaries:** localStorage, `fetch`/`JSON.parse` results, messages, and values arriving from the worker (`engine/valueHandle.ts` validates every slice).
  - Exception: `src/sw.ts` isn't bundled, so it narrows by hand.
- **New kinds:**
  - Write an `Interpreter<V>` whose value is tagged `{ kind: '<kind>', … }`, with `isValue: v => hasKind(v, '<kind>')`, and add it with `register()`. The registry stores type-erased `AnyInterpreter`s that check values on every call.
  - Previews read data through the typed `ValueHandle` methods (`lines`, `rows`, `children`, `bytes`, `text`, `image`, `json`, `asset` for an embedded file by index).
- **Derivations:** interpreters can offer `derivations`/`derive` ("Open as…", listed in the Actions sidebar's Open group). The engine returns the bytes, and `captureStore.derive` adds a `'derived'` capture with a `parent` link, which persistence also stores.
- **New actions** (one entry per area file, so parallel work doesn't collide):
  1. Catalog: in `src/core/actions/catalog/<area>.ts`, `export const x = defineAction({ id: '<area>.<name>', title, group, kinds, params: z.object({ … }) })` and add it to that file's `<area>Actions` array. Every setting is a string, number, boolean or enum with `.default()`, and `.meta({ title, … })` goes last; the types reject anything else. Use `params: z.object({})` for none. Add `label: p => …` when the default "Title (settings)" label reads badly.
  2. Implementation: in `src/core/actions/run/<area>.ts`, add `implement(x, { value: <interpreter>.isValue, run: ({ value, content }, params, ctx) => DerivedContent })` to the `<area>Impls` array (`anyValue` when only `content` is used; `applies` for finer filtering). Return text with `textResult` from `run/util.ts`. Give results a sensible `name` (`withExtension`) and mime so they're detected as the right kind; set `note` to add a fact to the capture's label (e.g. lines skipped).
  3. Test: input → output in `tests/unit/actions.test.ts` (or a `tests/unit/actions-<area>.test.ts`). The catalog test already checks the form, defaults and that every entry has one implementation.
  - A new area adds one file in each folder and one line in each `index.ts`. Don't import lazy-module code in `run/`; use a light value guard and, for the module's library, `module` in the catalog plus `ctx.service`.
- **Multi-table values** (spreadsheet sheets, SQLite tables) use `Summary.tables` plus `rows(from, to, table?)`. `components/previews/tableHandle.ts` adapts one table into a single-table handle for `RecordsTable`.
- **Bytes** are `Uint8Array<ArrayBuffer>` throughout. `crypto.subtle` and `Blob` need ArrayBuffer-backed bytes.

## Gotchas
- **Subpath deploys:** set `BASE_PATH` (e.g. `/clipbox/`) at build time. The SW and its client resolve URLs against the base.
- Import `{ Icon }` from `@mdi/react` (named), the default import breaks under Vite 8.
- TypeScript pinned to 6.x: typescript-eslint doesn't support TS 7 yet.
- Playwright:
  - Its `request` event fires for CSP-blocked requests too; check `requestfailed` errorText `csp`.
  - It can't route the browser's Service Worker update check; tests edit `dist/sw.js` instead.
- `@vscode/vscode-languagedetection` is patched (`patches/`): its webpack chunk `require` is made static so Rolldown can bundle it.
- The user's shell exports `NODE_ENV=development`, so `pnpm build` pins `NODE_ENV=production`. Without it you get the development build of React.
- Monaco only parses hex colours in themes; an `rgba()` string renders red.
- Lazily-imported dependencies must be listed in `optimizeDeps.include`. Otherwise the dev server reloads the page on first use, which makes the e2e tests flaky.
- The SW looks up the cache with `ignoreVary` (files are content-hashed). `vite preview` sends `Vary: Origin`, which would otherwise cause cache misses.
