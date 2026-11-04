import {
  wasmCompileOptionsIDL, wasmIDL, wasmStreamingIDL,
  wasmInstanceIDL, wasmTagIDL, wasmInstantiatedSourceIDL,
  wasmAddressTypeIDL, wasmAddressValueIDL,
  wasmMemoryIDL, wasmMemoryDescriptorIDL, wasmSharedMemoryDescriptorIDL,
  wasmTableIDL, wasmTableKindIDL, wasmTableDescriptorIDL,
  wasmGlobalIDL, wasmValueTypeIDL, wasmGlobalDescriptorIDL, wasmTagTypeIDL,
  wasmExceptionIDL, wasmExceptionOptionsIDL,
} from './webassembly';
import {
  wasmModuleIDL, wasmImportExportKindIDL, wasmModuleExportDescriptorIDL, wasmModuleImportDescriptorIDL,
} from './module';

/** WebAssembly namespace and its browser-boundary argument declarations. */
export const wasmIDLDefinitions = [
  wasmModuleIDL, wasmInstanceIDL, wasmMemoryIDL, wasmTableIDL, wasmGlobalIDL, wasmTagIDL,
  wasmExceptionIDL, wasmExceptionOptionsIDL,
  wasmImportExportKindIDL, wasmModuleExportDescriptorIDL, wasmModuleImportDescriptorIDL,
  wasmAddressTypeIDL, wasmAddressValueIDL,
  wasmMemoryDescriptorIDL, wasmSharedMemoryDescriptorIDL,
  wasmTableKindIDL, wasmTableDescriptorIDL,
  wasmValueTypeIDL, wasmGlobalDescriptorIDL, wasmTagTypeIDL,
  wasmCompileOptionsIDL, wasmInstantiatedSourceIDL, wasmIDL, wasmStreamingIDL,
];
