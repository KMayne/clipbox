import { css } from '@emotion/css';
import { useEffect, useRef } from 'react';
import { MOBILE_QUERY } from '../../components/ui';
import { useUiStore } from '../../state/uiStore';
import { theme } from '../../theme';
import { monaco } from './monaco';

const container = css`
  position: absolute;
  inset: 0;
`;

/** Read-only Monaco editor showing `text`. */
export function MonacoView({ text, language }: { text: string; language: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const wrap = useUiStore(s => s.wrap);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const model = monaco.editor.createModel(text, language);
    const editor = monaco.editor.create(el, {
      model,
      readOnly: true,
      domReadOnly: true,
      theme: 'clipbox-dark',
      automaticLayout: true,
      fontFamily: theme.mono,
      fontSize: 12,
      // No room for the minimap on a phone
      minimap: { enabled: !matchMedia(MOBILE_QUERY).matches },
      scrollBeyondLastLine: false,
      wordWrap: useUiStore.getState().wrap ? 'on' : 'off',
      renderLineHighlight: 'none',
      contextmenu: false,
    });
    editorRef.current = editor;
    return () => {
      editor.dispose();
      model.dispose();
      editorRef.current = null;
    };
  }, [text, language]);

  useEffect(() => {
    editorRef.current?.updateOptions({ wordWrap: wrap ? 'on' : 'off' });
  }, [wrap]);

  return <div ref={ref} className={container} data-testid="monaco-view" />;
}
