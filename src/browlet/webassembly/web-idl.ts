import {
  webAssemblyCompileOptionsIDL, webAssemblyIDL, webAssemblyModuleIDL,
  webAssemblyInstanceIDL, webAssemblyTagIDL, webAssemblyInstantiatedSourceIDL,
  webAssemblyAddressTypeIDL, webAssemblyAddressValueIDL,
  webAssemblyMemoryIDL, webAssemblyMemoryDescriptorIDL, webAssemblySharedMemoryDescriptorIDL,
  webAssemblyTableIDL, webAssemblyTableKindIDL, webAssemblyTableDescriptorIDL,
  webAssemblyGlobalIDL, webAssemblyValueTypeIDL, webAssemblyGlobalDescriptorIDL,
} from './webassembly';

/** WebAssembly namespace and its browser-boundary argument declarations. */
export const webAssemblyIDLDefinitions = [
  webAssemblyModuleIDL, webAssemblyInstanceIDL, webAssemblyMemoryIDL, webAssemblyTableIDL, webAssemblyGlobalIDL, webAssemblyTagIDL,
  webAssemblyAddressTypeIDL, webAssemblyAddressValueIDL,
  webAssemblyMemoryDescriptorIDL, webAssemblySharedMemoryDescriptorIDL,
  webAssemblyTableKindIDL, webAssemblyTableDescriptorIDL,
  webAssemblyValueTypeIDL, webAssemblyGlobalDescriptorIDL,
  webAssemblyCompileOptionsIDL, webAssemblyInstantiatedSourceIDL, webAssemblyIDL,
];
