import { InternalError, TypeError, internalType, type InternalPromise } from '../infra/index';
import {
  arg, atArg, defineInterface, DOMExceptionImpl, DOMExceptionNames, idlType, impl, implementationType,
  invokeWith, op, promise, reference,
} from '../web-idl/core/index';

import type { PermissionEnvironment } from './environment';
import type { PermissionDescriptor, PermissionState } from './store';

/** Permission algorithms owned by one environment and exposed through its Navigator. */
// https://w3c.github.io/permissions/#permissions-interface
export class PermissionsImpl {
  /** Relevant settings used by this object's permission operations. */
  env: PermissionEnvironment;

  constructor(env: PermissionEnvironment) {
    this.env = env;
  }

  /** Read a named permission using its base descriptor. */
  // https://w3c.github.io/permissions/#dfn-getting-the-current-permission-state
  getCurrentPermissionState(name: string): PermissionState {
    return this.getPermissionState({ name });
  }

  /** Resolve effective state without prompting or changing stored decisions. */
  // https://w3c.github.io/permissions/#dfn-permission-state
  getPermissionState<D extends PermissionDescriptor>(descriptor: D): PermissionState {
    const env = this.env;
    if (!env.isSecureContext) return 'denied';

    const store = env.userAgent.permissionStore;
    const feature = store.getFeature(descriptor.name);
    if (feature === undefined) throw new InternalError(`Unknown permission feature: ${descriptor.name}`);
    if (feature.policyControlled && !env.isAllowedToUse(feature.name)) return 'denied';

    if (env.topLevelOrigin === null) throw new InternalError('Permission state requires a top-level origin');
    const key = feature.key.generate(env.topLevelOrigin, env.origin);
    const entry = store.getEntry(descriptor, key);
    if (entry !== null) return entry.state;

    // Browlet records host decisions explicitly. With no entry, use the feature's
    // default rather than inferring user intent from browsing history or other signals.
    return feature.constrainState(feature.defaultState, descriptor, env);
  }

  /** Request a named permission using its base descriptor. */
  // https://w3c.github.io/permissions/#dfn-request-permission-to-use
  requestPermissionToUse(name: string): InternalPromise<PermissionDecision> {
    return this.requestPermission({ name });
  }

  /** Ask only when state is prompt; recording the answer is a separate task. */
  // https://w3c.github.io/permissions/#dfn-request-permission-to-use
  // SPEC_MISMATCH: request permission to use descriptor -> PermissionState.
  // Consent is asynchronous; callers can continue before the queued store update.
  requestPermission<D extends PermissionDescriptor>(descriptor: D): InternalPromise<PermissionDecision> {
    const env = this.env;
    const P = env.userAgent.HostPromise;
    return P.try(() => {
      const state = this.getPermissionState(descriptor);
      if (state !== 'prompt') return state;

      const store = env.userAgent.permissionStore;
      const feature = store.getFeature(descriptor.name)!; // State lookup already validated the feature.
      if (feature.canRequest(descriptor, env) === false) return 'denied';

      return env.userAgent.promptForPermission(descriptor, env).then((allowed) => {
        const decision = allowed ? 'granted' : 'denied';
        if (env.topLevelOrigin === null) throw new InternalError('Permission request requires a top-level origin');
        const key = feature.key.generate(env.topLevelOrigin, env.origin);
        env.queueTask('permissions', { run: () => { store.setEntry(descriptor, key, decision); } });
        return decision;
      }, undefined, internalType<PermissionDecision>());
    }, internalType<PermissionDecision>());
  }

  /** Ask the host to select offered values without changing the permission store. */
  // https://w3c.github.io/permissions/#dfn-prompt-the-user-to-choose
  // SPEC_MISMATCH: prompt the user to choose(options, descriptor, allowMultiple = false) -> "denied" or selection.
  // Return an InternalPromise; selections are arrays, including a single choice.
  // Extra prompt information from the calling algorithm is passed explicitly.
  promptUserToChoose<T>(
    options: T[], descriptor: PermissionDescriptor | string, allowMultiple = false, extraInformation: unknown = undefined,
  ): InternalPromise<PermissionSelection<T>> {
    const env = this.env;
    const P = env.userAgent.HostPromise;
    return P.try(() => {
      if (typeof descriptor === 'string') descriptor = { name: descriptor };
      const state = this.getPermissionState(descriptor);
      if (state === 'denied') return 'denied';
      const feature = env.userAgent.permissionStore.getFeature(descriptor.name)!;
      if (state === 'prompt' && feature.canRequest(descriptor, env) === false) return 'denied';

      // Keep the offered set stable while the host waits, including if it edits its own list.
      const offered = new Set(options);
      // §5.3 permits prompting even when granted. Always ask; there is no silent-selection cache.
      return env.userAgent.choosePermissionOptions({
        descriptor, options: [...offered], allowMultiple, extraInformation,
      }, env).then((selection) => {
        if (selection === 'denied') return selection;
        if (!Array.isArray(selection)) throw new InternalError('Permission chooser must return an array or denied');
        if (selection.length === 0) return 'denied';
        if (!allowMultiple && selection.length !== 1) {
          throw new InternalError('Permission chooser must select a single option');
        }
        const selected = new Set<T>();
        for (const option of selection) {
          if (!offered.has(option) || selected.has(option)) {
            throw new InternalError('Permission chooser must select distinct offered options');
          }
          selected.add(option);
        }
        return [...selected];
      });
    }, internalType<PermissionSelection<T>>());
  }

  /** Select the converted descriptor's feature for both initial and subsequent query results. */
  runPermissionQuery(descriptor: PermissionDescriptor, status: PermissionStatusData): void {
    const feature = this.env.userAgent.permissionStore.getFeature(descriptor.name);
    if (!feature) throw new InternalError('The converted permission name must identify a supported feature');
    feature.query(descriptor, status, this.env);
  }

  /** Read permission without prompting; deliver a fresh status on the receiver's task queue. */
  // https://w3c.github.io/permissions/#dom-permissions-query
  query(permissionDesc: object, currentEnv: PermissionEnvironment): InternalPromise<PermissionStatusData> {
    // Web IDL turns preflight/conversion exceptions into rejected promises.
    if (this.env.isWindow && !currentEnv.isAssociatedDocumentFullyActive()) {
      throw new DOMExceptionImpl('The current Document is not fully active', DOMExceptionNames.invalidState);
    }

    // These are two conversions of the original object, including two reads of name.
    const store = currentEnv.userAgent.permissionStore;
    const root = currentEnv.convertPermissionDescriptor(permissionDesc, 'PermissionDescriptor');
    const feature = store.getFeature(root.name);
    if (!feature) throw new TypeError(`Unsupported permission: ${root.name}`);
    const descriptor = currentEnv.convertPermissionDescriptor(permissionDesc, feature.descriptorType);
    const result = currentEnv.InternalPromise.withResolvers(permissionStatusType);
    // SPEC_CLASH(permissions-query-parallel-allocation): Permissions §6.2.1 creates a realm-owned status in parallel.
    // Follow HTML §8.1.7.5's task boundary and the browsers' owning-context allocation.
    // Binding eagerly creates the Platform object; our installed query only reads
    // local state. Keep creation, the synchronous query hook, and settlement in
    // one permissions task rather than a separate background turn. See ROADMAP.md, §6.2.
    this.env.queueTask('permissions', {
      run: () => {
        try {
          const status = currentEnv.createPermissionStatus(descriptor);
          currentEnv.permissions.runPermissionQuery(descriptor, status);
          result.resolve(status);
        } catch (error) {
          result.reject(error);
        }
      },
    });
    return result.promise;
  }
}

/** Query state shared with the browser's EventTarget-derived PermissionStatus implementation. */
export interface PermissionStatusData {
  /** Converted descriptor retained in the status's [[query]] slot. */
  query: PermissionDescriptor;
  /** Most recent value supplied by the feature's permission query algorithm. */
  state: PermissionState;
}

/** A completed request has existing consent or a grant/denial from the host. */
export type PermissionDecision = Exclude<PermissionState, 'prompt'>;

/** One or more original option values, or denial; an option named "denied" is still an array element. */
export type PermissionSelection<T> = T[] | 'denied';

/** Values presented to the host for one chooser interaction. */
export interface PermissionChoiceRequest<T> {
  /** Converted descriptor; the host must not mutate it. */
  descriptor: PermissionDescriptor;
  /** Snapshot of offered values; option objects retain their original identities. */
  options: T[];
  /** Whether the host may select more than one distinct option. */
  allowMultiple: boolean;
  /** Feature-owned prompt details supplied by the calling algorithm. */
  extraInformation: unknown;
}

const permissionStatusType = implementationType<PermissionStatusData>(reference('PermissionStatus'));

/*
 * [Exposed=(Window,Worker)]
 * interface Permissions {
 *   Promise<PermissionStatus> query(object permissionDesc);
 * };
 */
export const permissionsIDL = defineInterface<PermissionEnvironment>({
  name: 'Permissions',
  exposed: ['Window', 'Worker'],
  implementation: impl(PermissionsImpl, { constructWith: [atArg(0, (env) => env)] }),
  members: [op('query', promise(reference('PermissionStatus')),
    [arg('permissionDesc', idlType.object)],
    invokeWith(atArg(1, (_env, currentEnv) => currentEnv)),
  )],
});
