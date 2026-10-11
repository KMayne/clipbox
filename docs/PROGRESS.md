# Clipbox progress

Last updated: 11 October 2026. For the architecture and conventions, see `CLAUDE.md`. For what the app
does and how to run it, see `README.md`.

## Picking this up on another machine

1. Clone `git@github.com:KMayne/clipbox.git`. If you want the theme work, also check out the
   `feat/theme-switcher` branch (see "Open branches" below).
2. Install Node 26 (this machine uses nvm: `~/.nvm/versions/node/v26.11.1`) and pnpm 10.14
   (`packageManager` in `package.json` pins it).
3. Run `pnpm install`. This also applies `patches/@vscode__vscode-languagedetection@1.0.23.patch`.
4. Run `pnpm exec playwright install chromium` for the e2e tests.
5. If your shell exports `NODE_ENV=development`, `pnpm build` still produces a production build
   (the script pins it), but plain `vite build` won't.
6. Check everything works: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`. All should pass:
   242 unit tests and 41 e2e tests on `main` (43 on the theme branch).

Claude Code context that lives outside the repo and won't come with it:

- the original plan, `~/.claude/plans/hi-claude-i-d-like-linked-hare.md`, whose remaining items are copied
  below;
- one saved preference: plans should spell out the first deliverable in detail (UI, files,
  verification) and list risks up front.

## Open branches

- **`feat/theme-switcher`** (unmerged, one commit on top of `main` at `a535ba1`): colour schemes with a
  switcher in Settings → Appearance. Nord is the default; the others are Tokyo Night, Catppuccin Mocha,
  One Dark and Gruvbox. `?theme=<id>` previews a scheme without saving it. It credits all five palettes
  (MIT) in `NOTICE`. To merge, rebase it on `main` (`main` has moved on with the credit link) and check
  the credit's colours in each scheme.

## Done

- **Deliverable 1a: paste intake and the Inspector.**
  - Capture from paste, Read clipboard, drag and drop, and Open file.
  - The Inspector shows every clipboard format's interpretations, with Preview, Stats, Schema and Raw
    tabs.
  - Command palette (Ctrl+K) and keyboard navigation.
- **Batch A:**
  - All values stay in the engine worker, so the UI only fetches slices.
  - Lazily-loaded modules, with a Service Worker offline cache, per-module download, and an update
    notice.
  - Monaco code preview, and ML language detection.
- **Type-safety pass:** no `as` or `!` (both are lint errors), and Zod at every trust boundary.
- **Batch B:**
  - IndexedDB history (on by default, 7-day expiry).
  - "Open as…" derived captures.
  - YAML, XML, Markdown, NDJSON, base64 and data URLs, JWT, timestamp, UUID/ULID, URL, colour, and PEM
    (the lazy `x509` module).
- **Batch C:**
  - Archives: zip, gzip and tar in core; 7z, RAR, tar.xz, tar.bz2 and zstd in a lazy module.
  - PDF, audio and video, spreadsheets, and SQLite (row counts load on demand).
- **Other:**
  - Background module downloads on fast connections.
  - Subpath deploys via `BASE_PATH`.
  - A theme with native controls, focus rings and text selection all themed.
  - The KianMayne.co.uk credit.
  - README, NOTICE and the MIT licence.
- **Deployment:** to be served at `kianmayne.co.uk/clipbox/`, built with `BASE_PATH=/clipbox/`.
  A separate Claude session handled the site side and a local preview (port 8080), and it needs a
  rebuild to show recent changes.

## Remaining work

### Next up (agreed, not started)

1. **Simplify Settings → Modules.**
   - Each row shows status only: name, library and version (e.g. "pdf.js 6.4.299"), size, and status
     (not downloaded, downloading x%, offline, loaded). Remove Auto/Preload/Off and per-module
     Download/Remove.
   - Library versions: have `vite/modulesManifest.ts` read each module's main package version into
     `modules-manifest.json`.
   - Footer: app version (the manifest hash) and build date, **Check for updates** (`registration.update()`)
     and **Repair offline cache** (delete and re-download the current version's caches).
   - **Decision needed:** with no per-module controls, the policy system (Auto/Preload/Off in
     `modules/registry.ts`, `engine.setPolicies`, the `'off'` interpretation status, the "module off"
     chip, `clipbox.modules` in localStorage, and `skip`/`unskip` in `backgroundDownloads.ts`) has no
     UI. Either remove it, or keep it internal and ignore the saved policies, so nobody is stuck with a
     module Off. Several tests depend on it: `tests/e2e/modules.spec.ts`, the Engine unit tests, and
     the x509 "module off" e2e test.
   - The background-download toggle should stay; it's a useful control on metered connections.
2. **Merge `feat/theme-switcher`** once it has been reviewed.
3. **Push:** none of this work since the licence commit has been pushed to GitHub (`main` and the
   theme branch).

### Original roadmap (from the plan)

4. **Deliverable 1b: the canvas.**
   - Add a React Flow canvas between the Pastes pane and the Inspector.
   - Source nodes are created from a chip with "+" or Enter.
   - Shift+Enter replaces a source's data with the latest paste.
   - Undo/redo with `zundo`.
   - Save the graph (history persistence already exists), and pin each source node's blob so expiry
     can't remove it.
5. **Deliverable 2: ops and edges.**
   - Op registry: input and output kinds, Zod params, and async `run(inputs, params, { signal })`.
   - Engine `setGraph` with reactive, debounced re-evaluation that cancels stale runs.
   - Per-node results; when a node errors, the nodes downstream show as blocked.
   - Parameter forms generated from the Zod schemas, with field dropdowns from the inferred `Schema`.
   - Ops: pick/rename, filter, sort, group by, flatten, count/unique, to Markdown, to CSV/TSV,
     stringify, split lines, regex replace.
   - Palette: typing an op name adds it after the selected node.
6. **Spike, then Deliverable 3: inline TypeScript node.**
   - Monaco in the existing `editor` module.
   - Inject the upstream value's `Schema` as `declare const input: …` for type checking.
   - Transpile with sucrase and run in a disposable sandbox worker with a timeout.
7. **Deliverable 4: quick-task UX.**
   - Tab on a node opens the op picker, filtered by output kind, which auto-wires the chosen op.
   - Auto-layout.
   - Saved pipelines as templates.
8. **Extras:**
   - Diffing two inputs.
   - Image ops.
   - HTML→Markdown.
   - JSONPath.
   - An Electron capture source, for native clipboard formats the browser can't see.

### Smaller improvements and known gaps

- **Bundle size:** the main bundle is about 537 KB, and about 91 KB of that is Zod. Switching to
  `zod/mini` would make it a few KB, but every Zod call would need rewriting.
- **Archives:** see the TODO list in `README.md`:
  - 7z/RAR fixtures;
  - single-file `.xz`/`.bz2`;
  - modified dates for libarchive formats;
  - passwords;
  - nested archives;
  - streaming.
- **Detection quirks:**
  - A well-formed HTML fragment pasted as plain text is labelled XML.
  - A short Markdown note made of `Label: value` lines falls back to Text.
  - A Markdown doc that is mostly one pipe table may rank Records above Markdown.
  - Short unpadded base64 tokens without mixed case and digits show as Text.
- **Copy:**
  - Markdown copies unsanitised HTML; it's only shown inside the sandboxed iframe.
  - Spreadsheets always copy the first sheet.
  - Non-text base64 copies nothing.
- **PDF:**
  - The module is about 4 MB and runs on the engine thread, so a heavy PDF delays other pastes.
  - Page sizes are read for every page when the file opens.
  - Fonts are drawn as paths, so soft masks are approximate.
- **Spreadsheets:** legacy `.xls` files in non-Latin codepages may show garbled text, because
  SheetJS's codepage tables aren't loaded.
- **SQLite:**
  - There's no read-only query box.
  - `OFFSET` paging slows down deep into very large tables.
- **Media:**
  - Raw ADTS AAC files aren't detected.
  - WebM/MKV videos have no rotation.
  - Recordings made with `MediaRecorder` show no duration.
- **XML:** with a `<?xml` prolog, the tree includes a `?xml` key.
- **NDJSON:** invalid lines are only reported after line 200, because detection requires the first 200
  to parse.
- **JWT:** relative times round down, e.g. "expires in 1h" at 1h59m.
- **Theme:** there are more kinds than distinct palette hues, so a few unrelated kinds share a chip
  colour.
- **Testing:** the SQLite lazy load through the engine is only covered by e2e tests, not unit tests.

## Process notes

- **Parallel agents:** large batches were split across parallel Claude agents, each in its own git
  worktree. Each agent used its own e2e ports via `CLIPBOX_DEV_PORT`/`CLIPBOX_PREVIEW_PORT`, so test
  servers don't collide, and the branches were merged into `main` afterwards. Expect small conflicts in
  the shared registration files: `interpreters/index.ts`, `kinds.ts`, `theme.ts`, the Inspector
  `Preview` switch, `modules/registry.ts`, `workerLoaders.ts` and `vite.config.ts`.
- **Usage limits:** agents have hit usage limits mid-task; resuming each one with "continue from
  `git status`" worked.
