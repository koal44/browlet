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
  #assembly: DefinitionAssembly;
  #realmBindings = new WeakMap<JSRealm, RealmBinding>();

  constructor(definitions: Definition<Env>[]) {
    this.#assembly = new DefinitionAssembly([
      ...webIDLCommonDefinitions,
      // BindingWorld restricts registration to the environment required by these callbacks.
      // Assembly itself only combines declarations; it does not invoke the callbacks.
      ...(definitions as Definition[]),
    ]);
  }

  /** Compose a realm's environment and binding context, reusing an existing registration. */
  register(
    realm: Env['realm'],
    createEnvironment: (ctx: BindingContext<Env>) => Env,
  ): BindingContext<Env> {
    const registered = this.forRealm(realm);
    if (registered) return registered;

    const binding = new RealmBinding<Env>(
      this.#assembly,
      realm,
      // Realm bindings retain world identity and registry operations. Registration
      // above is the boundary that checks the declaration's environment contract.
      this as unknown as BindingWorld,
      createEnvironment,
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

  /** Retrieve the implementation paired with a platform object in this world. */
  unwrap(platformObject: object): StampedImplInstance | undefined {
    const record = getPlatformRecord(platformObject);
    return record?.binding.world === this ? record.implInst : undefined;
  }

  /** Retrieve or create a platform object if its implementation is already associated with this world. */
  project(implInst: object): StampedPlatformObject | undefined {
    const record = getImplementationRecord(implInst);
    return record?.binding.world === this ? record.project() : undefined;
  }

  /** Find the owning realm from an implementation or platform object associated with this world. */
  getRealm(value: object): WebIDLRealm | undefined {
    const record = getPlatformRecord(value) ?? getImplementationRecord(value);
    return record?.binding.world === this ? record.realm : undefined;
  }
}
