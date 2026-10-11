import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/languages/definitions/register.all';
import 'monaco-editor/languages/features/json/register';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import { gruvbox, theme, withAlpha } from '../../theme';

self.MonacoEnvironment = {
  getWorker: (_id: string, label: string) =>
    label === 'json' ? new JsonWorker() : new EditorWorker(),
};

// Monaco token colours take hex without '#'
const c = (hex: string) => hex.slice(1);

monaco.editor.defineTheme('clipbox-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: c(gruvbox.fg1) },
    { token: 'comment', foreground: c(gruvbox.gray), fontStyle: 'italic' },
    { token: 'keyword', foreground: c(gruvbox.red) },
    { token: 'operator', foreground: c(gruvbox.fg1) },
    { token: 'delimiter', foreground: c(gruvbox.fg4) },
    { token: 'string', foreground: c(gruvbox.green) },
    { token: 'string.escape', foreground: c(gruvbox.orange) },
    { token: 'regexp', foreground: c(gruvbox.orange) },
    { token: 'number', foreground: c(gruvbox.purple) },
    { token: 'constant', foreground: c(gruvbox.purple) },
    { token: 'type', foreground: c(gruvbox.yellow) },
    { token: 'type.identifier', foreground: c(gruvbox.yellow) },
    { token: 'identifier', foreground: c(gruvbox.fg1) },
    { token: 'variable', foreground: c(gruvbox.blue) },
    { token: 'variable.predefined', foreground: c(gruvbox.orange) },
    { token: 'predefined', foreground: c(gruvbox.aqua) },
    { token: 'annotation', foreground: c(gruvbox.aqua) },
    { token: 'tag', foreground: c(gruvbox.aqua) },
    { token: 'metatag', foreground: c(gruvbox.aqua) },
    { token: 'attribute.name', foreground: c(gruvbox.yellow) },
    { token: 'attribute.value', foreground: c(gruvbox.green) },
    { token: 'key', foreground: c(gruvbox.blue) },
    { token: 'string.key.json', foreground: c(gruvbox.blue) },
    { token: 'string.value.json', foreground: c(gruvbox.green) },
    { token: 'keyword.json', foreground: c(gruvbox.orange) },
  ],
  colors: {
    'editor.background': theme.bg,
    'editor.foreground': gruvbox.fg1,
    'editor.lineHighlightBackground': '#00000000',
    'editor.selectionBackground': gruvbox.bg2,
    'editor.inactiveSelectionBackground': gruvbox.bg1,
    'editorCursor.foreground': gruvbox.fg1,
    'editorLineNumber.foreground': theme.faint,
    'editorLineNumber.activeForeground': gruvbox.fg4,
    'editorIndentGuide.background1': gruvbox.bg1,
    'editorWhitespace.foreground': gruvbox.bg2,
    'minimap.background': theme.bg,
    'scrollbarSlider.background': withAlpha(gruvbox.bg2, 0.6),
    'scrollbarSlider.hoverBackground': gruvbox.bg3,
  },
});

export { monaco };
