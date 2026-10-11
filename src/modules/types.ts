import type { ComponentType } from 'react';
import type { EntryContent } from '../core/content';
import type { AnyInterpreter } from '../core/interpreter';
import type { Kind, ValueHandle } from '../core/types';
import type { ModuleLibrary } from './libraries';

export type ModuleId = 'core' | 'editor' | 'langdetect' | (string & {});

/** Cheap, synchronous detection for a kind owned by a lazily-loaded module. Lives in core. */
export interface Detector {
  kind: Kind;
  module: ModuleId;
  detect(c: EntryContent): number;
}

export interface ModuleInfo {
  id: ModuleId;
  title: string;
  description: string;
  /** Approximate download size, shown in Settings until the build manifest says otherwise. */
  approxBytes: number;
  /** Main third-party library, shown in Settings with the version from the build manifest. */
  library?: ModuleLibrary;
  /** Which halves exist. */
  hasWorker: boolean;
  hasUi: boolean;
}

/** Lazily-imported worker half of a module. */
export interface WorkerModule {
  interpreters?: AnyInterpreter[];
  /** Service exposed to interpreters via ctx.service(moduleId). */
  service?: unknown;
}

export interface PreviewProps {
  handle: ValueHandle;
}

/** Lazily-imported UI half of a module. */
export interface UiModule {
  previews?: Partial<Record<Kind, ComponentType<PreviewProps>>>;
}
