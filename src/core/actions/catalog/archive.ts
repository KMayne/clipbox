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

/** The recognised package manifest (jar, extension, APK, wheel, npm, RPM, …) as JSON. */
export const archiveManifest = defineAction({
  id: 'archive.manifest',
  title: 'Manifest as JSON',
  group: 'Extract',
  kinds: ['archive'],
  params: z.object({}),
});

/** Java archives: each class file's major version and the Java release it targets. */
export const archiveClassVersions = defineAction({
  id: 'archive.classVersions',
  title: 'Class versions',
  group: 'Extract',
  kinds: ['archive'],
  params: z.object({}),
});

/** RPM %pre/%post/… scriptlets and triggers, one after another. */
export const archiveScriptlets = defineAction({
  id: 'archive.scriptlets',
  title: 'Scriptlets as text',
  group: 'Extract',
  kinds: ['archive'],
  params: z.object({}),
});

export const archiveActions = [
  archiveListing,
  archiveManifest,
  archiveClassVersions,
  archiveScriptlets,
];
