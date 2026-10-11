import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/languages/definitions/register.all';
import 'monaco-editor/languages/features/json/register';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import { palette, theme } from '../../theme';

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
    { token: '', foreground: c(theme.text) },
    { token: 'comment', foreground: c(palette.gray), fontStyle: 'italic' },
    { token: 'keyword', foreground: c(palette.hue.red) },
    { token: 'operator', foreground: c(theme.text) },
    { token: 'delimiter', foreground: c(theme.muted) },
    { token: 'string', foreground: c(palette.hue.green) },
    { token: 'string.escape', foreground: c(palette.hue.orange) },
    { token: 'regexp', foreground: c(palette.hue.orange) },
    { token: 'number', foreground: c(palette.hue.purple) },
    { token: 'constant', foreground: c(palette.hue.purple) },
    { token: 'type', foreground: c(palette.hue.yellow) },
    { token: 'type.identifier', foreground: c(palette.hue.yellow) },
    { token: 'identifier', foreground: c(theme.text) },
    { token: 'variable', foreground: c(palette.hue.blue) },
    { token: 'variable.predefined', foreground: c(palette.hue.orange) },
    { token: 'predefined', foreground: c(palette.hue.aqua) },
    { token: 'annotation', foreground: c(palette.hue.aqua) },
    { token: 'tag', foreground: c(palette.hue.aqua) },
    { token: 'metatag', foreground: c(palette.hue.aqua) },
    { token: 'attribute.name', foreground: c(palette.hue.yellow) },
    { token: 'attribute.value', foreground: c(palette.hue.green) },
    { token: 'key', foreground: c(palette.hue.blue) },
    { token: 'string.key.json', foreground: c(palette.hue.blue) },
    { token: 'string.value.json', foreground: c(palette.hue.green) },
    { token: 'keyword.json', foreground: c(palette.hue.orange) },
  ],
  colors: {
    'editor.background': theme.bg,
    'editor.foreground': theme.text,
    'editor.lineHighlightBackground': '#00000000',
    'editor.selectionBackground': theme.hover,
    'editor.inactiveSelectionBackground': theme.raised,
    'editorCursor.foreground': theme.text,
    'editorLineNumber.foreground': theme.faint,
    'editorLineNumber.activeForeground': theme.muted,
    'editorIndentGuide.background1': theme.raised,
    'editorWhitespace.foreground': theme.hover,
    'minimap.background': theme.bg,
    // Monaco only parses hex colours (an rgba() string renders red): #rrggbb plus 60% alpha
    'scrollbarSlider.background': `${theme.hover}99`,
    'scrollbarSlider.activeBackground': theme.border,
    'scrollbarSlider.hoverBackground': theme.border,
  },
});

export { monaco };
