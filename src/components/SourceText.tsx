import { Suspense, use } from 'react';
import type { EntryId, Kind } from '../core/types';
import { engine } from '../engine/engineClient';
import { useModuleStore } from '../state/moduleStore';
import { FallbackBoundary } from './ModulePreview';
import { RawView } from './RawView';
import { ui } from './ui';
import { useAsync } from './useAsync';

/** Above this the editor gets sluggish; the plain view (truncated) takes over. */
const EDITOR_MAX_BYTES = 5 * 1024 * 1024;

/** The editor's language for a kind's source; anything unlisted is plain text. */
const LANGUAGES: Record<string, string> = {
  json: 'json',
  ndjson: 'json',
  yaml: 'yaml',
  xml: 'xml',
  html: 'html',
  markdown: 'markdown',
};

/**
 * A value's original text, highlighted for its kind in the editor module; plain text while that
 * loads, if it can't, or for very large values.
 */
export function SourceText({ entryId, kind }: { entryId: EntryId; kind: Kind }) {
  const raw = useAsync(entryId, () => engine.raw(entryId, EDITOR_MAX_BYTES));
  const plain = <RawView entryId={entryId} />;
  if (raw.status === 'loading') return <div className={ui.empty}>Loading…</div>;
  if (raw.status === 'error' || raw.value.text === undefined || raw.value.truncated) return plain;
  return (
    <FallbackBoundary fallback={plain}>
      <Suspense fallback={plain}>
        <Highlighted text={raw.value.text} language={LANGUAGES[kind] ?? 'plaintext'} />
      </Suspense>
    </FallbackBoundary>
  );
}

function Highlighted({ text, language }: { text: string; language: string }) {
  // loadUi caches its promise per module, so use() sees a stable promise
  const { SourceView } = use(useModuleStore.getState().loadUi('editor'));
  if (!SourceView) throw new Error('The editor module has no source view');
  return <SourceView text={text} language={language} />;
}
