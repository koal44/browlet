import { InternalError, internalType, type InternalPromise } from '../infra/index';

import type { PermissionEnvironment, PermissionUserAgent } from './environment';
import type { PermissionFeature } from './features';

/**
 * An initially empty, ordered permission store owned by one user agent.
 * Callers retain converted descriptors and keys without mutating their identity.
 * removeEntry() is bookkeeping; revoke() additionally runs the installed feature's cleanup.
 */
// https://w3c.github.io/permissions/#permission-store
export class PermissionStore {
  /** Definitions installed by the user agent; their rules stay fixed for the store's lifetime. */
  #features = new Map<string, PermissionFeature>();
  /** At most one entry per equal descriptor/key pair; replacement retains list position. */
  #entries: PermissionStoreEntry[] = [];
  /** Browser-owned invalidation after a decision write or removal; this never dispatches author events. */
  #onChange: ((name: string) => void) | undefined;

  constructor(features: Iterable<PermissionFeature>, onChange?: (name: string) => void) {
    this.#onChange = onChange;
    for (const feature of features) {
      if (this.#features.has(feature.name)) {
        throw new InternalError(`Duplicate permission feature: ${feature.name}`);
      }
      this.#features.set(feature.name, feature);
    }
  }

  /** Number of retained decisions, including any explicitly stored prompt state. */
  get size(): number {
    return this.#entries.length;
  }

  /** Look up installed feature rules; unknown names are not implicitly supported. */
  getFeature(name: string): PermissionFeature | undefined {
    return this.#features.get(name);
  }

  /** Get an existing entry, or null; PermissionsImpl resolves effective state separately. */
  // https://w3c.github.io/permissions/#dfn-get-a-permission-store-entry
  getEntry<D extends PermissionDescriptor>(
    descriptor: D,
    key: unknown,
  ): PermissionStoreEntry<D> | null {
    const index = this.#findEntry(descriptor, key);
    // Matching descriptors have the installed feature's converted dictionary type.
    return index === -1 ? null : this.#entries[index] as PermissionStoreEntry<D>;
  }

  /** Replace the matching entry in place, or append a new entry. */
  // https://w3c.github.io/permissions/#dfn-set-a-permission-store-entry
  setEntry<D extends PermissionDescriptor>(
    descriptor: D,
    key: unknown,
    state: PermissionState,
  ): void {
    const entry: PermissionStoreEntry<D> = { descriptor, key, state };
    const index = this.#findEntry(descriptor, key);
    if (index === -1) this.#entries.push(entry);
    else this.#entries[index] = entry;
    this.#onChange?.(descriptor.name);
  }

  /** Remove the matching entry, leaving unrelated decisions in their current order. */
  // https://w3c.github.io/permissions/#dfn-remove-a-permission-store-entry
  removeEntry<D extends PermissionDescriptor>(
    descriptor: D,
    key: unknown,
  ): void {
    const index = this.#findEntry(descriptor, key);
    if (index !== -1) {
      this.#entries.splice(index, 1);
      this.#onChange?.(descriptor.name);
    }
  }

  /** React to withdrawn consent: run the feature's cleanup, then forget the matching decision. */
  // https://w3c.github.io/permissions/#dfn-react-to-the-user-revoking-permission
  // TODO(Permissions host integration): coordinate pending prompts and delayed decision writes with withdrawal.
  revoke<D extends PermissionDescriptor>(descriptor: D, key: unknown): void {
    const feature = this.#features.get(descriptor.name);
    if (feature === undefined) throw new InternalError(`Unknown permission feature: ${descriptor.name}`);
    if (!feature.key.isKey(key)) throw new InternalError(`Invalid permission key for: ${descriptor.name}`);
    // SPEC_CLASH(permissions-default-revocation-recursion): §4 defaults the hook to §5.4, which calls the hook.
    // With no feature-specific cleanup, remove the entry once rather than recursing.
    feature.revoke(descriptor, key);
    this.removeEntry(descriptor, key);
  }

  /** Retain a converted automation decision, resolving after any matching globals' permission tasks run. */
  // https://w3c.github.io/permissions/#dfn-set-a-permission
  // SPEC_MISMATCH: set a permission(descriptor, state, optional key, optional user agent) -> void.
  // The caller resolves the key and supplies settings for one selected user agent; completion is asynchronous.
  // TODO(WebDriver): Supply complete settings enumeration, default-key generation, and command cancellation.
  setPermission(
    descriptor: PermissionDescriptor, state: PermissionState, key: unknown,
    envs: Iterable<PermissionEnvironment>, userAgent: PermissionUserAgent,
  ): InternalPromise<void> {
    const P = userAgent.HostPromise;
    return P.try(() => {
      const feature = this.getFeature(descriptor.name);
      if (feature === undefined) throw new InternalError(`Unknown permission feature: ${descriptor.name}`);
      if (!feature.key.isKey(key)) throw new InternalError(`Invalid permission key for: ${descriptor.name}`);

      const targets: PermissionEnvironment[] = [];
      for (const env of envs) {
        if (env.userAgent !== userAgent) continue;
        if (env.topLevelOrigin === null) throw new InternalError('Permission automation requires a top-level origin');
        const envKey = feature.key.generate(env.topLevelOrigin, env.origin);
        if (feature.key.isKey(envKey) && feature.key.equals(envKey, key)) targets.push(env);
      }

      // SPEC_GAP(permissions-automation-state-application): Appendix B does not define how to retain the simulated state.
      // Use the shared decision store once; ordinary queries still enforce security/policy and refresh live results.
      const apply = () => {
        if (state !== 'granted') this.revoke(descriptor, key);
        this.setEntry(descriptor, key, state);
      };
      // SPEC_CLASH(permissions-automation-no-target): Appendix B only applies inside matching settings' tasks; Chromium and Firefox retain decisions without them.
      // Follow the browsers so automation can set a permission before navigation creates matching settings.
      if (targets.length === 0) return apply();

      const result = P.withResolvers(internalType<void>());
      let remaining = targets.length;
      let applied = false;
      for (const target of targets) {
        target.queueTask('permissions', {
          run: () => {
            if (result.isResolved) return;
            try {
              if (!applied) {
                apply();
                applied = true;
              }
              if (--remaining === 0) result.resolve(undefined);
            } catch (error) {
              result.reject(error);
            }
          },
        });
      }
      return result.promise;
    }, internalType<void>());
  }

  /** Iterate retained entries in permission-store order. */
  [Symbol.iterator](): IterableIterator<PermissionStoreEntry> {
    return this.#entries[Symbol.iterator]();
  }

  /** Match converted descriptor values before applying the feature's key type and comparison. */
  #findEntry(
    descriptor: PermissionDescriptor,
    key: unknown,
  ): number {
    const feature = this.#features.get(descriptor.name);
    if (feature === undefined) throw new InternalError(`Unknown permission feature: ${descriptor.name}`);
    return this.#entries.findIndex((entry) =>
      entry.descriptor.name === descriptor.name &&
      feature.descriptorsEqual(entry.descriptor, descriptor) &&
      feature.key.isKey(entry.key) && feature.key.isKey(key) &&
      feature.key.equals(entry.key, key));
  }
}

/** The user's recorded decision; prompt does not grant access to the feature. */
// https://w3c.github.io/permissions/#permission-state
export type PermissionState = 'granted' | 'denied' | 'prompt';

/** The default when a feature has not specified another state. */
// https://w3c.github.io/permissions/#default-permission-state
export const defaultPermissionState: PermissionState = 'prompt';

/** A converted permission descriptor; feature-specific dictionaries extend this record. */
// https://w3c.github.io/permissions/#dom-permissiondescriptor
export interface PermissionDescriptor {
  name: string;
}

/** One decision for a descriptor and a feature-defined permission key. */
// https://w3c.github.io/permissions/#dfn-permission-store-entry
export interface PermissionStoreEntry<D extends PermissionDescriptor = PermissionDescriptor, K = unknown> {
  descriptor: D;
  key: K;
  state: PermissionState;
}
