# Clipbox

Paste anything (text/JSON/CSV/HTML/image/file), inspect it (interpretations, preview, stats, schema), and later transform it with a typed node graph. Web app, Chromium only, no backend.

Plan: `~/.claude/plans/hi-claude-i-d-like-linked-hare.md` (Deliverable 1a done; next: 1b canvas + persistence).

## Commands
- `pnpm dev` — Vite dev server
- `pnpm test` — Vitest unit tests (`tests/unit`)
- `pnpm test:e2e` — Playwright (Chromium, `tests/e2e`); synthetic `ClipboardEvent`/`DragEvent`
- `pnpm typecheck`, `pnpm lint` (zero warnings), `pnpm build`

Node lives under nvm: `export PATH=~/.nvm/versions/node/v26.11.1/bin:$PATH`.

## Architecture
- `src/core/` — pure TS, no React. `types.ts` (Summary, Schema, ValueHandle, SliceRequest), `interpreters/` (one file per kind: detect → parse → label/summarise/slice/export), `schema.ts` (inference + TS rendering), `magic.ts` (format + dimensions from headers).
- `src/engine/` — `Engine` runs in a Web Worker via Comlink (`engine.worker.ts`). The main thread never parses. `valueHandle.ts`: values are copied back and sliced locally. Previews only use `ValueHandle.getSlice`, so values can later stay in the worker without UI changes.
- `src/capture/` — capture sources (paste, read, drop, file) → `captureStore.add()`. Future Electron source plugs in here.
- `src/state/` — Zustand stores (`captureStore`, `uiStore`).
- `src/components/` — Emotion CSS, dark theme tokens in `src/theme.ts`; previews in `components/previews/`.

## Gotchas
- Import `{ Icon }` from `@mdi/react` (named), the default import breaks under Vite 8.
- TypeScript pinned to 6.x: typescript-eslint doesn't support TS 7 yet.
- Playwright's `request` event fires for CSP-blocked requests too; check `requestfailed` errorText `csp`.
