import type { UiModule } from '../types';
import { HtmlSourcePreview, TextPreview } from './previews';

export const previews: UiModule['previews'] = {
  text: TextPreview,
  html: HtmlSourcePreview,
};
