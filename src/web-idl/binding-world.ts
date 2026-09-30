import { DefinitionAssembly } from './assembly';
import { RealmBinding } from './realm-binding';
import type { BindingContext } from './binding-context';
import { webIDLCommonDefinitions } from './common-definitions';
import type { Definition } from './core/index';
import type { WebIDLEnvironment, WebIDLRealm } from './realm';
import {
  getImplementationRecord, getPlatformRecord,
  type StampedImplInstance, type StampedPlatformObject,
} from './platform-object';
import { registerDefinitionBindings } from './implementation-binding';
import type { JSRealm } from '../js-engine/index';
import { InternalError } from '../infra/internal-error';

/**
 * Owns definitions and platform-object identity across registered realms.
 * Each realm binding owns its initial objects and implementation steps.
 */
// A weaker world type would permit registrations its declarations cannot use.
export class BindingWorld<in out Env extends WebIDLEnvironment = WebIDLEnvironment> {
  #definitions: DefinitionAssembly;
  #realmBindings = new WeakMap<JSRealm, RealmBinding>();

  // Project helper: compose definitions shared across realm bindings.
  constructor(definitions: Definition<Env>[]) {
    this.#definitions = new DefinitionAssembly([
      ...webIDLCommonDefinitions,
      // BindingWorld restricts registration to the environment required by these callbacks.
      // Assembly itself only combines declarations; it does not invoke the callbacks.
      ...(definitions as Definition[]),
    ]);
  }

  /**
   * Register an environment, returning its realm's shared binding context.
   * Use a factory when composing execution requires the new context.
   */
  register(env: Env): BindingContext<Env>;
  register(
    realm: Env['realm'], createEnvironment: (context: BindingContext<Env>) => Env,
  ): BindingContext<Env>;
  register(
    envOrRealm: Env | Env['realm'],
    createEnvironment?: (context: BindingContext<Env>) => Env,
  ): BindingContext<Env> {
    const realm = createEnvironment ? envOrRealm as Env['realm'] : (envOrRealm as Env).realm;
    const compose = createEnvironment ?? (() => envOrRealm as Env);
    const registered = this.forRealm(realm);
    if (registered) return registered;

    const binding = new RealmBinding<Env>(
      this.#definitions,
      realm,
      // Realm bindings retain world identity and registry operations. Registration
      // above is the boundary that checks the declaration's environment contract.
      this as unknown as BindingWorld,
      compose,
    );
    registerDefinitionBindings(binding);
    return binding.context;
  }

  /** Find a realm's binding context in this world without registering it. */
  forRealm(realm: Env['realm']): BindingContext<Env> | undefined {
    // Registration checked the environment retained by this realm's context.
    return this.#realmBindings.get(realm)?.context as BindingContext<Env> | undefined;
  }

  /** Publish a realm binding after its declaration setup succeeds. */
  registerRealm(binding: RealmBinding): void {
    if (this.#realmBindings.has(binding.realm)) {
      throw new InternalError('Realm already has a registered binding');
    }
    this.#realmBindings.set(binding.realm, binding);
  }

  /** Find a realm's binding, including for constructor prototype selection. */
  getRealmBinding(realm: JSRealm): RealmBinding | undefined {
    return this.#realmBindings.get(realm);
  }

  // Project helper: retrieve the implementation paired with a platform object in this world.
  unwrap(platformObject: object): StampedImplInstance | undefined {
    const record = getPlatformRecord(platformObject);
    return record?.binding.world === this ? record.implInst : undefined;
  }

  // Project helper: project an associated implementation using its owning realm.
  project(implInst: object): StampedPlatformObject | undefined {
    const record = getImplementationRecord(implInst);
    return record?.binding.world === this ? record.project() : undefined;
  }

  // Project helper: retrieve the owning realm from either object identity.
  getRealm(value: object): WebIDLRealm | undefined {
    const record = getPlatformRecord(value) ?? getImplementationRecord(value);
    return record?.binding.world === this ? record.realm : undefined;
  }
}
