import { browletBindingWorld } from '../../src/browlet/bindings';
import { Realm, type BrowletEnvironment, type WindowRealm } from '../../src/browlet/scripting/index';
import type { NodeImpl } from '../../src/browlet/dom/nodes/index';
import type { WindowImpl } from '../../src/browlet/browsing/window/index';
import type { Node, Window } from '../../src/browlet/platform';
import type { BindingContext, StampedImplInstance, StampedPlatformObject } from '../../src/web-idl/index';

// Binding tests inspect the same world used by Browlet's composition root.
// Implementation algorithms instead retain their environment and typed objects.

/** Retrieve the main-world binding for a fixture's already composed realm. */
export function getBindingContext(realm: Realm): BindingContext<BrowletEnvironment> {
  const context = browletBindingWorld.getBindingContext(realm);
  if (!context) throw new Error('Fixture realm has no Browlet binding');
  return context;
}

/** Inspect the relevant realm of a fixture's implementation or author-visible object. */
export function getRelevantRealm(value: Window | WindowImpl | Node | NodeImpl): WindowRealm;
export function getRelevantRealm(value: object): Realm;
export function getRelevantRealm(value: object): Realm {
  const realm = browletBindingWorld.getRealm(value) ?? Realm.getAssociatedRealm(value);
  if (!(realm instanceof Realm)) throw new Error('Fixture object has no relevant Realm');
  return realm;
}

/** Project a fixture's already associated implementation in Browlet's main world. */
export function project(value: object): StampedPlatformObject {
  const platform = browletBindingWorld.project(value);
  if (!platform) throw new Error('Fixture implementation has no Browlet binding');
  return platform;
}

/** Inspect the implementation paired with a fixture's main-world platform object. */
export function unwrap<Value extends object>(value: object): StampedImplInstance<Value> {
  const implementation = browletBindingWorld.unwrap(value);
  if (!implementation) throw new Error('Fixture value is not a Browlet platform object');
  return implementation as StampedImplInstance<Value>;
}
