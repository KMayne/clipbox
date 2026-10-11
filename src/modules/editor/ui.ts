import type { UiModule } from '../types';
import { HtmlSourcePreview, MarkdownSourcePreview, TextPreview } from './previews';

export const previews: UiModule['previews'] = {
  text: TextPreview,
  html: HtmlSourcePreview,
  markdown: MarkdownSourcePreview,
};
