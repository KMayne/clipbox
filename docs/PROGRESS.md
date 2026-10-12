# Clipbox progress

Last updated: 11 October 2026. For the architecture and conventions, see `CLAUDE.md`. For what the app
does and how to run it, see `README.md`.

## Picking this up on another machine

1. Clone `git@github.com:KMayne/clipbox.git`.
2. Install Node 26 (this machine uses nvm: `~/.nvm/versions/node/v26.11.1`) and pnpm 10.14
   (`packageManager` in `package.json` pins it).
3. Run `pnpm install`. This also applies `patches/@vscode__vscode-languagedetection@1.0.23.patch`.
4. Run `pnpm exec playwright install chromium` for the e2e tests.
5. If your shell exports `NODE_ENV=development`, `pnpm build` still produces a production build
   (the script pins it), but plain `vite build` won't.
6. Check everything works: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`. All should pass:
   314 unit tests and 54 e2e tests.

Claude Code context that lives outside the repo and won't come with it:

- the original plan, `~/.claude/plans/hi-claude-i-d-like-linked-hare.md`, whose remaining items are copied
  below;
- one saved preference: plans should spell out the first deliverable in detail (UI, files,
  verification) and list risks up front.

## Done

- **Deliverable 1a: paste intake and the Inspector.**
  - Capture from paste, Read clipboard, drag and drop, and Open file.
  - The Inspector shows every clipboard format's interpretations, with Preview, Split and Raw views
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
  - Colour schemes with a switcher in Settings → Appearance: Nord (default), Tokyo Night, Catppuccin
    Mocha, One Dark and Gruvbox. `?theme=<id>` previews one without saving. All five palettes (MIT) are
    credited in `NOTICE`.
  - The KianMayne.co.uk credit, and a "Source" link to the GitHub repo beside it (also in the README).
    Both are at least 4.5:1 contrast against the panel in every scheme.
  - README, NOTICE and the MIT licence.
- **Push:** `main` matched `origin` as of 11 October 2026. Commits made locally after that (the Vite
  config fix, the GitHub link, the merged colour schemes, the credit contrast fix, the detection and
  copy fixes and the Settings → Modules rework) are unpushed.
  `feat/theme-switcher` is merged into `main`; its copy on `origin` is stale and can be deleted.
- **Detection and copy fixes:**
  - HTML fragments rank above XML, Markdown with a pipe table ranks above Records, and short base64
    tokens that decode to words are recognised.
  - The `<?xml?>` declaration moved from the tree to stats.
  - JWT and timestamp relative times round to the nearest unit.
  - NDJSON tolerates up to a tenth of invalid lines and reports them all.
  - Copy takes the spreadsheet sheet that's showing, and copies decoded base64 images as PNG.
- **Settings → Modules, simplified:**
  - Each module row shows its library and version (read into `modules-manifest.json` at build time),
    size and status. There are no per-module controls.
  - The per-module Auto/Preload/Off policies are gone, along with the `'off'` status and the "module
    off" chip. One **Module downloads** setting (`clipbox.moduleDownloads`) replaces them and the
    background toggle: Automatic (default), On demand (metered connections) or Everything now.
  - The footer shows the app version and build date, with **Check for updates** and **Repair offline
    cache**.
- **Actions (framework):** done on `feat/actions`, not yet merged into `main`.
  - Catalog and worker implementations in `src/core/actions/`, engine `actions`/`runAction`, settings
    validated in the worker, forms generated from the Zod settings schemas.
  - A right sidebar (toggle with `A` or the top bar's panel icon) with collapsible **Info** (the
    stats; `I` toggles it), **Actions** and **Schema** sections.
  - Layout: Paste, Open file and Clear all (with a confirmation) in the Pastes heading; the Pastes
    panel collapses (`P`); keyboard shortcuts listed in a sidebar section; source and site links in
    a page footer. The video preview no longer repeats the stats beside the player.
  - The Inspector's tabs became **per-kind view buttons**: e.g. HTML has Text | Preview | Split |
    Hex dump, JSON Text | Tree | Split | Hex dump, images Image | Hex dump. Text-based kinds open in
    Split, binary ones in their rendered view; each class remembers its choice (1–4 by position).
  - Actions can return several results, which arrive as one collection capture.
  - Ten proof actions: JSON format, minify, sort keys, to YAML and TypeScript types; text change case,
    sort lines and find & replace; hash (any kind); image convert.
- **Deployment:** to be served at `kianmayne.co.uk/clipbox/`, built with `BASE_PATH=/clipbox/`.
  A separate Claude session handled the site side and a local preview (port 8080), and it needs a
  rebuild to show recent changes.

## Remaining work

### Actions batch 2

Choose the next actions from the candidate list in [`docs/ACTIONS.md`](ACTIONS.md) (copied from the
actions plan, `~/.claude/plans/ok-next-i-want-delegated-nest.md`, with the done ones marked). The plan
is to split them across parallel agents by kind area (text/encode, structured data, documents/media,
identifiers/web/crypto), on top of the merged framework, following "New actions" in `CLAUDE.md`.

### Original roadmap (from the plan)

1. **Deliverable 1b: the canvas.**
   - Add a React Flow canvas between the Pastes pane and the Inspector.
   - Source nodes are created from a chip with "+" or Enter.
   - Shift+Enter replaces a source's data with the latest paste.
   - Undo/redo with `zundo`.
   - Save the graph (history persistence already exists), and pin each source node's blob so expiry
     can't remove it.
2. **Deliverable 2: ops and edges.**
   - Op registry: input and output kinds, Zod params, and async `run(inputs, params, { signal })`.
   - Engine `setGraph` with reactive, debounced re-evaluation that cancels stale runs.
   - Per-node results; when a node errors, the nodes downstream show as blocked.
   - Parameter forms generated from the Zod schemas, with field dropdowns from the inferred `Schema`.
   - Ops: pick/rename, filter, sort, group by, flatten, count/unique, to Markdown, to CSV/TSV,
     stringify, split lines, regex replace.
   - Palette: typing an op name adds it after the selected node.
3. **Spike, then Deliverable 3: inline TypeScript node.**
   - Monaco in the existing `editor` module.
   - Inject the upstream value's `Schema` as `declare const input: …` for type checking.
   - Transpile with sucrase and run in a disposable sandbox worker with a timeout.
4. **Deliverable 4: quick-task UX.**
   - Tab on a node opens the op picker, filtered by output kind, which auto-wires the chosen op.
   - Auto-layout.
   - Saved pipelines as templates.
5. **Extras:**
   - Diffing two inputs.
   - Image ops (HTML→Markdown and JSONPath are done as actions).
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
- **Detection:** plain `Label: value` notes stay YAML or Text, on purpose: they have no Markdown
  syntax. Notes of `**Label:** value` lines rank Markdown. A unit test records the reasoning.
- **Copy:**
  - Markdown copies unsanitised HTML; it's only shown inside the sandboxed iframe.
  - Base64 that decodes to non-image binary copies the base64 text, because browsers can't put
    arbitrary bytes on the clipboard. Open as → Decode gives the raw bytes.
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
- **Theme:** there are more kinds than distinct palette hues, so a few unrelated kinds share a chip
  colour.
- **Actions:** a few candidates in `docs/ACTIONS.md` are still open (e.g. JSON to XML, JSON Schema,
  unflatten, slugify).
- **Testing:** the SQLite lazy load through the engine is only covered by e2e tests, not unit tests.

## Process notes

- **Parallel agents:** large batches were split across parallel Claude agents, each in its own git
  worktree. Each agent used its own e2e ports via `CLIPBOX_DEV_PORT`/`CLIPBOX_PREVIEW_PORT`, so test
  servers don't collide, and the branches were merged into `main` afterwards. Expect small conflicts in
  the shared registration files: `interpreters/index.ts`, `kinds.ts`, `theme.ts`, the Inspector
  `Preview` switch, `modules/registry.ts`, `workerLoaders.ts` and `vite.config.ts`. For actions, each area has its own
  catalog and `run/` file, so only the one-line spreads in `core/actions/catalog/index.ts` and
  `core/actions/run/index.ts` are shared.
- **Usage limits:** agents have hit usage limits mid-task; resuming each one with "continue from
  `git status`" worked.
