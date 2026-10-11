import type { ModelResult } from '@vscode/vscode-languagedetection';
import { isRecord } from '../../core/guards';
import { fromGuesslang, type Language } from './languages';

export interface Detection {
  language: Language;
  confidence: number;
}

export interface LanguageDetector {
  detect(text: string): Promise<Detection | null>;
}

export const isLanguageDetector = (s: unknown): s is LanguageDetector =>
  isRecord(s) && typeof s.detect === 'function';

const MIN_CHARS = 20;
const SAMPLE_CHARS = 10_000;
const MIN_CONFIDENCE = 0.15;
/** Top result must beat the runner-up by this factor; guesslang confidences are low but well separated. */
const MIN_MARGIN = 2;

/** Accepts the model's top guess only when it is confident and clearly ahead. */
export function pickLanguage(results: ModelResult[]): Detection | null {
  const [top, second] = results;
  if (!top || top.confidence < MIN_CONFIDENCE) return null;
  if (second && top.confidence < second.confidence * MIN_MARGIN) return null;
  const language = fromGuesslang(top.languageId);
  return language ? { language, confidence: top.confidence } : null;
}

export function createDetector(model: {
  runModel(text: string): Promise<ModelResult[]>;
}): LanguageDetector {
  return {
    async detect(text) {
      if (text.trim().length < MIN_CHARS) return null;
      return pickLanguage(await model.runModel(text.slice(0, SAMPLE_CHARS)));
    },
  };
}
