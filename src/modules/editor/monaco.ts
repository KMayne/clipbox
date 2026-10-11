import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/languages/definitions/register.all';
import 'monaco-editor/languages/features/json/register';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import { theme } from '../../theme';

self.MonacoEnvironment = {
  getWorker: (_id: string, label: string) =>
    label === 'json' ? new JsonWorker() : new EditorWorker(),
};

monaco.editor.defineTheme('clipbox-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': theme.bg,
    'editor.lineHighlightBackground': '#00000000',
    'editorLineNumber.foreground': '#6a6a6a',
    'minimap.background': theme.bg,
  },
});

export { monaco };
