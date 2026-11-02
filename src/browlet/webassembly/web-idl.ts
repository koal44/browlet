import {
  webAssemblyCompileOptionsIDL, webAssemblyIDL, webAssemblyModuleIDL, webAssemblyInstanceIDL, webAssemblyInstantiatedSourceIDL,
} from './webassembly';

/** WebAssembly namespace and its browser-boundary argument declarations. */
export const webAssemblyIDLDefinitions = [
  webAssemblyModuleIDL, webAssemblyInstanceIDL, webAssemblyCompileOptionsIDL, webAssemblyInstantiatedSourceIDL, webAssemblyIDL,
];
