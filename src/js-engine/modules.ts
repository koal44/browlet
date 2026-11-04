import * as vm from 'node:vm';

import { InternalError } from '../infra/internal-error';

import { addon, isAddonContextHandle } from './node-addons';
import type { JSWasmInstance, JSWasmModule } from './built-in-primitives';
import type { VMContext } from './runtime';

/** The shared Node VM surface used by HTML, supplied by Node or the addon. */
export type CompiledModule = SourceTextModule | SyntheticModule | WebAssemblyModule;

interface Module {
  /** Context selected when the module was constructed. */
  context: VMContext;
  /** Source identifier used in diagnostics. */
  identifier: string;
  /** Current linking or evaluation state. */
  status: 'unlinked' | 'linking' | 'linked' | 'evaluating' | 'evaluated' | 'errored';
  /** Original evaluation failure; reading before failure throws. */
  error: unknown;
  /** Live export bindings, available after instantiation. */
  namespace: object;
  evaluate(): Promise<unknown>;
}

// These declarations describe our supported subset. Node's synchronous linking
// API is newer than the workspace's @types/node declarations.
export interface SourceTextModule extends Module {
  /** Unresolved imports and re-exports, in engine request order. */
  moduleRequests: ModuleRequest[];
  linkRequests(modules: CompiledModule[]): void;
  instantiate(): void;
}

export interface SyntheticModule extends Module {
  setExport(name: string, value: unknown): void;
}

/** The addon's retained Wasm record, distinct from its native Module source object. */
export interface WebAssemblyModule extends Module {
  /** Realm-owned compiled source, available before linking or evaluation. */
  source: JSWasmModule;
  /** The single evaluated Instance, absent until instantiation succeeds. */
  instance: JSWasmInstance | undefined;
  /** External dependencies only, with the bridge's private helper omitted. */
  moduleRequests: ModuleRequest[];
  linkRequests(modules: CompiledModule[]): void;
  instantiate(): void;
}

export interface ModuleOptions {
  /** Existing context in which the module will execute. */
  context: VMContext;
  /** Source identifier used in diagnostics. */
  identifier?: string;
}

export interface SourceTextModuleOptions extends ModuleOptions {
  /** Offset added to reported source line numbers. */
  lineOffset?: number;
  /** Populate the engine-created metadata object lazily, using Node's callback shape. */
  initializeImportMeta?: (meta: object, module: SourceTextModule) => void;
  /** Load, link, and evaluate a dependency using Node's dynamic-import callback contract. */
  importModuleDynamically?: ImportModuleDynamically<SourceTextModule>;
}

/** Host instantiation supplies callback lifecycle while the bridge retains the graph and bindings. */
export interface WasmModuleOptions extends ModuleOptions {
  createInstance?: WasmInstanceFactory;
  /** Public exports of the created instance; native dependencies retain their engine objects. */
  getExports?: () => object;
  /** Public source object for static/dynamic source imports; defaults to the native Module. */
  getSource?: () => object;
}

/** Host instantiation of a retained Wasm source with its resolved imports. */
export type WasmInstanceFactory = (module: JSWasmModule, imports: object) => JSWasmInstance;

/** Node's import callback; returning a Module leaves namespace conversion to the backend. */
export type ImportModuleDynamically<Referrer extends object> = (
  specifier: string, referrer: Referrer, attributes: Record<string, string>, phase: ModuleRequestPhase,
) => CompiledModule | Promise<CompiledModule>;

/** Node module options other than the context and source identifier already supplied by the realm. */
export type ModuleCompilationOptions = Omit<SourceTextModuleOptions, keyof ModuleOptions>;

/** A dependency reported by the engine, before host resolution and loading. */
export interface ModuleRequest {
  /** Original import or re-export specifier. */
  specifier: string;
  /** Parsed import attributes; the host validates their meaning. */
  attributes: Record<string, string>;
  /** Source, ordinary evaluation, or deferred evaluation request. */
  phase: ModuleRequestPhase;
}

/** The requested stage of module loading: source, ordinary evaluation, or deferred evaluation. */
export type ModuleRequestPhase = 'source' | 'evaluation' | 'defer';

export function compileModule(
  source: string, context: VMContext, filename: string, options: ModuleCompilationOptions = {},
): SourceTextModule {
  if (isAddonContextHandle(context)) {
    if (!addon.SourceTextModule) throw new InternalError('Node backend does not provide SourceTextModule');
    return new addon.SourceTextModule(source, { ...options, context, identifier: filename });
  }
  requireVMModules();
  // @types/node predates phases and synchronous linking. Both supported Node
  // bases implement this Node-shaped subset; no callback argument rewriting is needed.
  const SourceTextModuleConstructor = vm.SourceTextModule as unknown as
    new (source: string, options: SourceTextModuleOptions) => SourceTextModule;
  return new SourceTextModuleConstructor(source, { ...options, context, identifier: filename });
}

export function createDefaultExportModule(value: unknown, context: VMContext): CompiledModule {
  if (isAddonContextHandle(context)) {
    if (!addon.SyntheticModule) throw new InternalError('Node backend does not provide SyntheticModule');
    return new addon.SyntheticModule(['default'], function() {
      this.setExport('default', value);
    }, { context });
  }
  requireVMModules();
  return new vm.SyntheticModule(['default'], function() {
    this.setExport('default', value);
  }, { context }) as unknown as SyntheticModule;
}

/** Parse Wasm with the ESM builtin options and reserved-name checks, without instantiating it. */
export function compileWebAssemblyModule(
  bytes: Uint8Array, context: VMContext, filename: string,
  createInstance?: WasmInstanceFactory, getExports?: () => object, getSource?: () => object,
): WebAssemblyModule {
  // Stock Node has no corresponding public VM class. Do not silently substitute
  // a standalone Instance or a synthetic namespace for a cyclic Wasm record.
  if (!isAddonContextHandle(context) || !addon.WebAssemblyModule) {
    throw new InternalError('WebAssembly ESM parsing requires the compatibility addon');
  }
  return new addon.WebAssemblyModule(bytes, { context, identifier: filename, createInstance, getExports, getSource });
}

export function moduleRequests(module: CompiledModule): ModuleRequest[] {
  return 'moduleRequests' in module ? module.moduleRequests : [];
}

/** Link an already loaded graph. Dependencies follow each referrer's request order. */
export function linkModule(
  root: CompiledModule, graph: Map<CompiledModule, CompiledModule[]>,
): void {
  if (root.status !== 'unlinked') return;
  for (const [referrer, dependencies] of graph) {
    if (!('moduleRequests' in referrer) || referrer.status !== 'unlinked' || suppliedRequests.has(referrer)) continue;
    referrer.linkRequests(dependencies);
    suppliedRequests.add(referrer);
  }
  if ('moduleRequests' in root) {
    if (!suppliedRequests.has(root)) {
      root.linkRequests([]);
      suppliedRequests.add(root);
    }
    root.instantiate();
  }
}

/** Evaluation returns the engine Promise and never performs an explicit checkpoint. */
export function evaluateModule(module: CompiledModule): Promise<unknown> {
  return module.evaluate();
}

export function moduleNamespace(module: CompiledModule): object {
  return module.namespace;
}

const suppliedRequests = new WeakSet<SourceTextModule | WebAssemblyModule>();

function requireVMModules(): void {
  if (typeof vm.SourceTextModule !== 'function' || typeof vm.SyntheticModule !== 'function') {
    throw new InternalError('Stock Node module execution requires --experimental-vm-modules');
  }
  if (typeof Reflect.get(vm.SourceTextModule.prototype, 'linkRequests') !== 'function') {
    throw new InternalError('Stock Node module execution requires the synchronous VM module linking API');
  }
}
