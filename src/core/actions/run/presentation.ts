import { presentationInterpreter } from '../../interpreters/presentation';
import { isImageFormatsService } from '../../../modules/imageformats/types';
import {
  deckImages,
  slidesJson,
  slidesMarkdown,
  type LegacyConverter,
} from '../../presentation/output';
import {
  presentationExtractImages,
  presentationExtractText,
  presentationSlidesJson,
} from '../catalog/presentation';
import { MAX_EXTRACTED, parseRange, truncatedNote } from '../extract';
import { implement } from '../types';
import { textResult, withExtension } from './util';

const value = presentationInterpreter.isValue;

export const presentationImpls = [
  implement(presentationExtractImages, {
    value,
    applies: ({ value }) => value.media.length > 0,
    async run({ value }, { slides, convert }, ctx) {
      const picked = parseRange(slides, value.slides.length, 'slide');
      let converter: LegacyConverter | undefined;
      if (convert) {
        const service = await ctx.service('imageformats', isImageFormatsService);
        if (!service) throw new Error('The image formats module is unavailable');
        converter = (bytes, name) => service.toPng(bytes, name);
      }
      const { images, truncated } = await deckImages(
        value,
        picked ? new Set(picked) : undefined,
        MAX_EXTRACTED,
        converter,
      );
      return truncated ? [...images, truncatedNote('slide')] : images;
    },
  }),
  implement(presentationExtractText, {
    value,
    run: ({ value, content }, { notes }) =>
      textResult(
        slidesMarkdown(value, notes),
        'text/markdown',
        withExtension(content.name, 'md', 'slides'),
      ),
  }),
  implement(presentationSlidesJson, {
    value,
    run: ({ value, content }) =>
      textResult(
        JSON.stringify(slidesJson(value), null, 2),
        'application/json',
        withExtension(content.name, 'json', 'slides'),
      ),
  }),
];
