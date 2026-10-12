import { z } from 'zod';
import { defineAction } from '../types';

export const playlistResolveUrls = defineAction({
  id: 'playlist.resolveUrls',
  title: 'Resolve URLs',
  group: 'Convert',
  kinds: ['playlist'],
  params: z.object({
    base: z.string().default('').meta({
      title: 'Base URL',
      description:
        "The playlist's own http(s) URL, e.g. https://cdn.example.com/hls/master.m3u8; empty leaves relative URIs as they are",
    }),
  }),
  label: ({ base }) => (base.trim() ? `Resolve URLs (${base.trim()})` : 'Resolve URLs'),
});

export const playlistSegmentsCsv = defineAction({
  id: 'playlist.segmentsCsv',
  title: 'Segments as CSV',
  group: 'Extract',
  kinds: ['playlist'],
  params: z.object({}),
});

export const playlistSegmentsJson = defineAction({
  id: 'playlist.segmentsJson',
  title: 'Segments as JSON',
  group: 'Extract',
  kinds: ['playlist'],
  params: z.object({}),
});

export const playlistVariantsJson = defineAction({
  id: 'playlist.variantsJson',
  title: 'Variants as JSON',
  group: 'Extract',
  kinds: ['playlist'],
  params: z.object({}),
});

export const playlistUrls = defineAction({
  id: 'playlist.urls',
  title: 'URL list',
  group: 'Extract',
  kinds: ['playlist'],
  params: z.object({}),
});

export const playlistActions = [
  playlistResolveUrls,
  playlistSegmentsCsv,
  playlistSegmentsJson,
  playlistVariantsJson,
  playlistUrls,
];
