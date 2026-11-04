export {
  WasmImpl, type WebAssemblyCompileOptions, type MemoryDescriptor, type TableDescriptor, type GlobalDescriptor,
  type TagType, type ValueType, type WasmEnvironment,
} from './webassembly';
export { wasmIDLDefinitions } from './web-idl';
export { WasmModuleImpl } from './module';
export { WasmExceptionImpl } from './exception';
export { WasmInstanceImpl, wrapWasmInstance } from './instance';
export { WasmMemoryImpl, WasmTableImpl, WasmGlobalImpl, WasmTagImpl, type WasmObjectImpl } from './objects';
