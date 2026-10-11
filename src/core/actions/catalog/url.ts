import { z } from 'zod';
import { defineAction } from '../types';

export const urlDecode = defineAction({
  id: 'url.decode',
  title: 'Percent-decode',
  group: 'Encode',
  kinds: ['url'],
  params: z.object({}),
});

export const urlEncode = defineAction({
  id: 'url.encode',
  title: 'Percent-encode',
  group: 'Encode',
  kinds: ['url'],
  params: z.object({}),
});

export const urlQueryJson = defineAction({
  id: 'url.queryJson',
  title: 'Query string → JSON',
  group: 'Extract',
  kinds: ['url'],
  params: z.object({}),
});

export const urlStripTracking = defineAction({
  id: 'url.stripTracking',
  title: 'Strip tracking params',
  group: 'Format',
  kinds: ['url'],
  params: z.object({
    extra: z.string().default('').meta({
      title: 'Extra params to strip',
      description: 'Comma or space separated; a trailing * matches a prefix, e.g. ref, aff_*',
    }),
  }),
});

/** Opens the URL in a new tab instead of adding a capture (an effect action). */
export const urlOpen = defineAction({
  id: 'url.open',
  title: 'Open in new tab',
  group: 'Inspect',
  kinds: ['url'],
  params: z.object({}),
  effect: 'open-url',
});

export const urlActions = [urlDecode, urlEncode, urlQueryJson, urlStripTracking, urlOpen];
