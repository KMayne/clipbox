/* 7z-wasm's types are declared for its package root; we import the ES module build directly. */

declare module '7z-wasm/7zz.es6.js' {
  export type {
    FileSystem,
    SevenZipModule,
    SevenZipModuleFactory,
    SevenZipModuleOptions,
  } from '7z-wasm';
  import type { SevenZipModuleFactory } from '7z-wasm';
  const factory: SevenZipModuleFactory;
  export default factory;
}
