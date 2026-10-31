import { InternalError } from '../infra/index';
import { areSameOrigin, type Origin } from '../url/index';

import type { PermissionEnvironment } from './environment';
import type { PermissionStatusData } from './permissions';
import { defaultPermissionState, type PermissionDescriptor, type PermissionState } from './store';

/** The rules and query algorithm shared by every descriptor of one powerful feature. */
// https://w3c.github.io/permissions/#specifying-a-powerful-feature
export class PermissionFeature<D extends PermissionDescriptor = PermissionDescriptor, K = unknown> {
  /** ASCII-lowercase name used to select this feature. */
  name: string;
  /** Web IDL dictionary used to convert author descriptors. */
  descriptorType: string;
  /** Web IDL interface used to allocate query results. */
  resultType: string;
  /** State before user intent is recorded or after the permission expires. */
  defaultState: PermissionState;
  /** Whether a policy-controlled feature with this name also exists. */
  policyControlled: boolean;
  /** Key type, generation, and comparison are supplied together. */
  key: PermissionKeyDefinition<K>;
  /** Feature-specific algorithms, with standard defaults implemented by this class. */
  #options: PermissionFeatureOptions<D, K>;

  constructor(name: string, key: PermissionKeyDefinition<K>, options: PermissionFeatureOptions<D, K> = {}) {
    if (/[\u0080-\uFFFF]/.test(name) || name !== name.toLowerCase()) {
      throw new InternalError('Permission feature names must be ASCII lowercase');
    }
    this.name = name;
    this.key = key;
    this.descriptorType = options.descriptorType ?? 'PermissionDescriptor';
    this.resultType = options.resultType ?? 'PermissionStatus';
    this.defaultState = options.defaultState ?? defaultPermissionState;
    this.policyControlled = options.policyControlled ?? false;
    this.#options = options;
  }

  /** Compare converted descriptors, including any feature-specific aspects. */
  descriptorsEqual(first: D, second: D): boolean {
    return this.#options.descriptorsEqual?.(first, second) ?? first.name === second.name;
  }

  /** Apply feature constraints when no recorded decision exists. */
  constrainState(state: PermissionState, descriptor: D, env: PermissionEnvironment): PermissionState {
    return this.#options.constrainState?.(state, descriptor, env) ?? state;
  }

  /** Check restrictions on new consent without overwriting a recorded decision. */
  canRequest(descriptor: D, env: PermissionEnvironment): boolean {
    return this.#options.canRequest?.(descriptor, env) ?? true;
  }

  /** Populate initial and subsequent status values using this feature's query algorithm. */
  // https://w3c.github.io/permissions/#dfn-permission-query-algorithm
  query(descriptor: D, status: PermissionStatusData, env: PermissionEnvironment): void {
    if (this.#options.query) this.#options.query(descriptor, status, env);
    else status.state = env.permissions.getPermissionState(descriptor);
  }

  /** Apply feature-owned cleanup before the matching entry is removed. */
  // SPEC_MISMATCH: permission revocation algorithm() -> void.
  // The withdrawn descriptor/key are explicit; the owner is bound when the feature is installed.
  revoke(descriptor: D, key: K): void {
    this.#options.revoke?.(descriptor, key);
  }
}

/** Feature-supplied key algorithms; custom keys require all three operations. */
export type PermissionKeyDefinition<K = unknown> = {
  /** Recognize an internal key before comparing values. */
  isKey(value: unknown): value is K;
  /** Generate a key from top-level and requesting origins, in that order. */
  generate(origin: Origin, embeddedOrigin: Origin): K;
  /** Compare keys that have passed the type check. */
  equals(first: K, second: K): boolean;
};

/** Optional metadata and algorithms supplied by the feature's specification. */
export type PermissionFeatureOptions<D extends PermissionDescriptor, K> = {
  /** Web IDL dictionary for this feature's converted descriptor. */
  descriptorType?: string;
  /** Web IDL interface for this feature's query result. */
  resultType?: string;
  /** State used when the store has no matching entry. */
  defaultState?: PermissionState;
  /** Whether to consult the environment's feature-policy answer. */
  policyControlled?: boolean;
  /** Apply feature restrictions to the default state. */
  constrainState?(state: PermissionState, descriptor: D, env: PermissionEnvironment): PermissionState;
  /** Whether this environment may ask for new consent. */
  canRequest?(descriptor: D, env: PermissionEnvironment): boolean;
  /** Populate feature-specific query results. */
  query?(descriptor: D, status: PermissionStatusData, env: PermissionEnvironment): void;
  /** Compare descriptors including feature-specific aspects. */
  descriptorsEqual?(first: D, second: D): boolean;
  /** Clean up resources before a recorded decision is removed. */
  revoke?(descriptor: D, key: K): void;
};

/** Standard top-level origin keys, compared by same-origin. */
// https://w3c.github.io/permissions/#dfn-default-permission-key-generation-algorithm
// https://w3c.github.io/permissions/#dfn-default-permission-key-comparison-algorithm
export const originPermissionKey: PermissionKeyDefinition<Origin> = {
  isKey: (value): value is Origin => typeof value === 'object' && value !== null &&
    'kind' in value && (value.kind === 'tuple' || value.kind === 'opaque'),
  generate: (origin) => origin,
  equals: areSameOrigin,
};
