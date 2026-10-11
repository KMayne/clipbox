import { z } from 'zod';
import { defineAction } from '../types';

/** Path, size, compressed size, modified and type of every entry. */
export const archiveListing = defineAction({
  id: 'archive.listing',
  title: 'Listing as CSV',
  group: 'Extract',
  kinds: ['archive'],
  params: z.object({}),
});

export const archiveActions = [archiveListing];
