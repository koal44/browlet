import { InternalError, type InternalPromise } from '../../infra/index';
import type { ModuleRequestPhase } from '../../js-engine/index';
import { idlType } from '../../web-idl/core/index';

import type { BrowletEnvironment } from '../environment/index';

import type { CompiledModule } from './script';
import { getSupportedImportAttributes, type ModuleRequest } from './module-request';

/** One ECMAScript graph traversal, with dependency loading supplied by the host. */
// https://tc39.es/ecma262/#table-graphloadingstate-record
export class ModuleLoadingState {
  /** Whether this traversal can still settle its completion. */
  isLoading = true;
  /** Outstanding module visits, including the initial root. */
  pendingModulesCount = 1;
  /** Cyclic records already visited by this traversal. */
  visited = new Set<CompiledModule>();
  /** Completion observed by HTML's fetch-descendants-and-link algorithm. */
  promise: InternalPromise<void>;
  /** Host import handler, independent of traversal and settlement. */
  #imports: ModuleDependencyLoader;
  #resolve: () => void;
  #reject: (reason: unknown) => void;

  constructor(imports: ModuleDependencyLoader, env: BrowletEnvironment) {
    this.#imports = imports;
    const capability = env.InternalPromise.withResolvers(idlType.undefined);
    this.promise = capability.promise;
    this.#resolve = () => capability.resolve(undefined);
    this.#reject = capability.reject;
  }

  /** Visit a source record once, or recursively load an evaluation graph. */
  // https://tc39.es/proposal-source-phase-imports/#sec-InnerModuleLoading
  load(module: CompiledModule, loadType: 'single' | 'recursive-load' = 'recursive-load'): void {
    if (!this.isLoading) throw new InternalError('Cannot visit a module after graph loading has finished');
    if (loadType === 'recursive-load' && !module.isSynthetic() && !module.requestedModulesLoaded &&
      module.code.status === 'unlinked' && !this.visited.has(module)) {
      this.visited.add(module);
      this.pendingModulesCount += module.requestedModules.length;
      const supportedAttributes = getSupportedImportAttributes();
      for (const request of module.requestedModules) {
        if (request.phase === 'defer') {
          // TODO: Deferred evaluation needs its own graph and namespace lifecycle.
          throw new InternalError('Deferred module loading is not implemented');
        }
        if (request.attributes.some((attribute) => !supportedAttributes.includes(attribute.key))) {
          this.continue(request.phase, { type: 'throw', value: new module.realm.SyntaxError('Unsupported import attribute') });
        } else {
          const loaded = module.getLoadedModule(request);
          if (loaded !== undefined) this.load(loaded, request.phase === 'source' ? 'single' : 'recursive-load');
          else this.#imports.load(module, request, (completion) => { this.continue(request.phase, completion); });
        }
        // Loading may synchronously re-enter continue() and settle this graph.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (!this.isLoading) return;
      }
    }
    if (this.pendingModulesCount < 1) throw new InternalError('Module loading count underflow');
    this.pendingModulesCount--;
    if (this.pendingModulesCount === 0) {
      this.isLoading = false;
      for (const loaded of this.visited) loaded.requestedModulesLoaded = true;
      this.#resolve();
    }
  }

  /** Resume after a request completes, ignoring work arriving after settlement. */
  // https://tc39.es/proposal-source-phase-imports/#sec-ContinueModuleLoading
  continue(phase: ModuleRequestPhase, completion: ModuleLoadingCompletion): void {
    if (!this.isLoading) return;
    if (completion.type === 'normal') {
      this.load(completion.value, phase === 'source' ? 'single' : 'recursive-load');
    } else {
      this.isLoading = false;
      this.#reject(completion.value);
    }
  }
}

/** Load one dependency and report completion, including synchronously cached results. */
export interface ModuleDependencyLoader {
  load(referrer: CompiledModule, request: ModuleRequest, onComplete: (completion: ModuleLoadingCompletion) => void): void;
}

/** The loaded record or exception consumed by ContinueModuleLoading. */
export type ModuleLoadingCompletion =
  | { type: 'normal'; value: CompiledModule; }
  | { type: 'throw'; value: unknown; };
