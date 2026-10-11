import { z } from 'zod';

/**
 * Effects that actions ask the UI to perform instead of adding a capture (`ActionInfo.effect`).
 * They come from the worker, so they're validated here before anything happens.
 */
const effectSchema = z.discriminatedUnion('effect', [
  z.object({
    effect: z.literal('open-url'),
    // Only web pages: never javascript:, data:, file: or similar
    url: z.url({ protocol: /^https?$/, normalize: true }),
  }),
]);

export type UiEffect = z.infer<typeof effectSchema>;

export function parseEffect(raw: unknown): UiEffect {
  const parsed = effectSchema.safeParse(raw);
  if (!parsed.success) throw new Error('The action returned an unsupported effect');
  return parsed.data;
}

/** Validates and carries out an action's effect. */
export function performEffect(raw: unknown): void {
  const effect = parseEffect(raw);
  switch (effect.effect) {
    case 'open-url': {
      // noopener: the new page gets no handle on this one
      window.open(effect.url, '_blank', 'noopener,noreferrer');
      return;
    }
  }
}
