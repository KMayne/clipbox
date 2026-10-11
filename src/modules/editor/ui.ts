import type { UiModule } from '../types';
import { MonacoView } from './MonacoView';
import { TextPreview } from './previews';

export const previews: UiModule['previews'] = {
  text: TextPreview,
};

export const SourceView: UiModule['SourceView'] = MonacoView;
