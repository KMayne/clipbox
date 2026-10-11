import { XMLParser } from 'fast-xml-parser';
import { xmlInterpreter } from '../../interpreters/xml';
import { formatXml, minifyXml } from '../../xmlFormat';
import { xmlFormat, xmlMinify, xmlToJson } from '../catalog/xml';
import { implement } from '../types';
import { textResult, withExtension } from './util';

const value = xmlInterpreter.isValue;

const xmlName = (name: string | undefined) => withExtension(name, 'xml', 'data');

export const xmlImpls = [
  implement(xmlFormat, {
    value,
    run: ({ value, content }, { indent }) =>
      textResult(
        formatXml(value.source, indent === 'tab' ? '\t' : ' '.repeat(Number(indent))),
        'application/xml',
        xmlName(content.name),
      ),
  }),
  implement(xmlMinify, {
    value,
    run: ({ value, content }, { comments }) =>
      textResult(minifyXml(value.source, comments), 'application/xml', xmlName(content.name)),
  }),
  implement(xmlToJson, {
    value,
    run({ value, content }, { attributes, prefix, parseValues }) {
      const parser = new XMLParser({
        ignoreAttributes: attributes === 'ignore',
        attributeNamePrefix: prefix,
        ...(attributes === 'group' && { attributesGroupName: ':@' }),
        ignoreDeclaration: true,
        parseTagValue: parseValues,
        parseAttributeValue: parseValues,
      });
      const tree: unknown = parser.parse(value.source.replace(/^\uFEFF/, ''));
      return textResult(
        JSON.stringify(tree, null, 2),
        'application/json',
        withExtension(content.name, 'json', 'data'),
      );
    },
  }),
];
