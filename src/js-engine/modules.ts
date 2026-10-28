import * as vm from 'node:vm';

import { InternalError } from '../infra/internal-error';

import { addon, isAddonContextHandle } from './node-addons';
import type { VMContext } from './runtime';

/** The shared Node VM surface used by HTML, supplied by Node or the addon. */
export type CompiledModule = SourceTextModule | SyntheticModule;

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
  moduleRequests: readonly ModuleRequest[];
  linkRequests(modules: CompiledModule[]): void;
  instantiate(): void;
}

export interface SyntheticModule extends Module {
  setExport(name: string, value: unknown): void;
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
}

/** A dependency reported by the engine, before host resolution and loading. */
export interface ModuleRequest {
  /** Original import or re-export specifier. */
  specifier: string;
  /** Parsed import attributes; the host validates their meaning. */
  attributes: Readonly<Record<string, string>>;
  /** Source, ordinary evaluation, or deferred evaluation request. */
  phase: 'source' | 'evaluation' | 'defer';
}

export function compileModule(source: string, context: VMContext, filename: string): SourceTextModule {
  if (isAddonContextHandle(context)) {
    if (!addon.SourceTextModule) throw new InternalError('Node backend does not provide SourceTextModule');
    return new addon.SourceTextModule(source, { context, identifier: filename });
  }
  requireVMModules();
  return new vm.SourceTextModule(source, { context, identifier: filename }) as unknown as SourceTextModule;
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

export function moduleRequests(module: CompiledModule): readonly ModuleRequest[] {
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

const suppliedRequests = new WeakSet<SourceTextModule>();

function requireVMModules(): void {
  if (typeof vm.SourceTextModule !== 'function' || typeof vm.SyntheticModule !== 'function') {
    throw new InternalError('Stock Node module execution requires --experimental-vm-modules');
  }
  if (typeof Reflect.get(vm.SourceTextModule.prototype, 'linkRequests') !== 'function') {
    throw new InternalError('Stock Node module execution requires the synchronous VM module linking API');
  }
}
