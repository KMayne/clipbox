import * as Comlink from 'comlink';
import type { EngineApi } from './engine';

const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });

export const engine = Comlink.wrap<EngineApi>(worker);
