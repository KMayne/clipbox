import { parseAllDocuments } from 'yaml';
import { formatCount } from '../../format';
import { yamlInterpreter } from '../../interpreters/yaml';
import { yamlFormat, yamlToJson } from '../catalog/yaml';
import { implement } from '../types';
import { textResult, withExtension } from './util';

const value = yamlInterpreter.isValue;

/** Re-emits every document with `indent` spaces, keeping comments, anchors and markers. */
export function formatYaml(source: string, indent: number): string {
  const docs = parseAllDocuments(source, { merge: true });
  if (!Array.isArray(docs)) throw new Error('Not valid YAML');
  const error = docs.flatMap(d => d.errors)[0];
  if (error) throw new Error(`Not valid YAML: ${error.message}`);
  return docs
    .map((d, i) => {
      const text = d.toString({ indent, lineWidth: 0 });
      // Later documents need a `---` separator even if the source omitted it
      return i > 0 && !text.startsWith('---') ? `---\n${text}` : text;
    })
    .join('');
}

export const yamlImpls = [
  implement(yamlFormat, {
    value,
    run: ({ value, content }, { indent }) =>
      textResult(
        formatYaml(value.source, indent),
        'application/yaml',
        withExtension(content.name, 'yaml', 'data'),
      ),
  }),
  implement(yamlToJson, {
    value,
    // Several documents become one JSON array (the order kept), so the result stays one value
    run: ({ value, content }) => ({
      ...textResult(
        JSON.stringify(value.root, null, 2),
        'application/json',
        withExtension(content.name, 'json', 'data'),
      ),
      ...(value.documentCount > 1 && {
        note: `${formatCount(value.documentCount)} documents as an array`,
      }),
    }),
  }),
];
