import { z } from 'zod';
import { defineAction } from '../types';

export const ndjsonToJson = defineAction({
  id: 'ndjson.toJson',
  title: 'To JSON array',
  group: 'Convert',
  kinds: ['ndjson'],
  params: z.object({}),
});

export const ndjsonToCsv = defineAction({
  id: 'ndjson.toCsv',
  title: 'To CSV',
  group: 'Convert',
  kinds: ['ndjson'],
  params: z.object({}),
});

export const ndjsonInvalid = defineAction({
  id: 'ndjson.invalidLines',
  title: 'Extract invalid lines',
  group: 'Extract',
  kinds: ['ndjson'],
  params: z.object({}),
});

export const ndjsonActions = [ndjsonToJson, ndjsonToCsv, ndjsonInvalid];
