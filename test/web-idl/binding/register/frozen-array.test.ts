import { describe, expect, it } from 'vitest';

import {
  arg, defineInterface, frozenArray, idlType, impl, nullable, op, reference, roAttr,
} from '../../../../src/web-idl/core/index';
import { BindingWorld } from '../../../../src/web-idl/binding/world';

import { installTestBindings } from '../../../support/web-idl-binding';

describe('Web IDL frozen-array attribute adaptation', () => {
  it('projects list entries once and retains each snapshot when the list is replaced', () => {
    const { context, realm } = installTestBindings(new BindingWorld(definitions));
    const entry = new EntryImpl();
    const implementation = new SnapshotImpl();
    implementation.entries = [entry];
    const object = context.project(SnapshotImpl, implementation) as Snapshot;
    const first = object.entries!;

    expect(first).toHaveLength(1);
    expect(first[0]).toBe(context.project(EntryImpl, entry));
    expect(Object.getPrototypeOf(first)).toBe(realm.Array.prototype);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[0])).toBe(false);
    expect(Object.isFrozen(implementation.entries)).toBe(false);
    expect(object.entries).toBe(first);
    expect(implementation.reads).toBe(2);

    implementation.entries = [];
    const empty = object.entries;
    expect(empty).toEqual([]);
    expect(empty).not.toBe(first);
    expect(object.entries).toBe(empty);
    expect(Object.isFrozen(empty)).toBe(true);
    expect(first).toHaveLength(1);

    implementation.entries = null;
    expect(object.entries).toBeNull();
  });

  it('shares the receiver-owned snapshot with borrowed getters, including the first read', () => {
    const world = new BindingWorld(definitions);
    const first = installTestBindings(world);
    const second = installTestBindings(world);
    const sharedList = [new EntryImpl()];
    const firstImplementation = new SnapshotImpl();
    const secondImplementation = new SnapshotImpl();
    firstImplementation.entries = secondImplementation.entries = sharedList;
    const firstObject = first.context.project(SnapshotImpl, firstImplementation) as Snapshot;
    const secondObject = second.context.project(SnapshotImpl, secondImplementation) as Snapshot;
    const First = Reflect.get(first.globalObject, 'Snapshot') as { prototype: object; };
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Apply the borrowed getter with its explicit receiver.
    const getter = Object.getOwnPropertyDescriptor(First.prototype, 'entries')!.get!;
    const borrowed = Reflect.apply(getter, secondObject, []) as readonly object[];

    expect(Object.getPrototypeOf(borrowed)).toBe(second.realm.Array.prototype);
    expect(secondObject.entries).toBe(borrowed);
    expect(Reflect.apply(getter, secondObject, [])).toBe(borrowed);
    const local = firstObject.entries!;
    expect(Object.getPrototypeOf(local)).toBe(first.realm.Array.prototype);
    expect(local).not.toBe(borrowed);
    expect(local[0]).toBe(borrowed[0]);
    expect(Object.getPrototypeOf(local[0])).toBe(
      (Reflect.get(second.globalObject, 'Entry') as { prototype: object; }).prototype,
    );
    expect(() => { Reflect.apply(getter, {}, []); }).toThrow(first.realm.TypeError);
  });

  it('keeps snapshot caches separate across binding worlds using the same declarations', () => {
    const first = installTestBindings(new BindingWorld(definitions));
    const second = installTestBindings(new BindingWorld(definitions));
    const sharedList: EntryImpl[] = [];
    const firstImplementation = new SnapshotImpl();
    const secondImplementation = new SnapshotImpl();
    firstImplementation.entries = secondImplementation.entries = sharedList;
    const firstObject = first.context.project(SnapshotImpl, firstImplementation) as Snapshot;
    const secondObject = second.context.project(SnapshotImpl, secondImplementation) as Snapshot;

    expect(Object.getPrototypeOf(firstObject.entries)).toBe(first.realm.Array.prototype);
    expect(Object.getPrototypeOf(secondObject.entries)).toBe(second.realm.Array.prototype);
    expect(firstObject.entries).not.toBe(secondObject.entries);
  });

  it('projects a frozen implementation list without mistaking it for a converted array', () => {
    const { context, realm } = installTestBindings(new BindingWorld(definitions));
    const entry = new EntryImpl();
    const implementation = new SnapshotImpl();
    implementation.entries = Object.freeze([entry]);
    const object = context.project(SnapshotImpl, implementation) as Snapshot;

    expect(object.entries).not.toBe(implementation.entries);
    expect(object.entries![0]).toBe(context.project(EntryImpl, entry));
    expect(Object.getPrototypeOf(object.entries)).toBe(realm.Array.prototype);
    expect(Object.isFrozen(object.entries)).toBe(true);
  });

  it('preserves an input-converted array and its realm when a borrowed method stores it', () => {
    const world = new BindingWorld(definitions);
    const first = installTestBindings(world);
    const second = installTestBindings(world);
    const entry = first.context.project(EntryImpl, new EntryImpl());
    const implementation = new ConvertedSnapshotImpl();
    const object = second.context.project(ConvertedSnapshotImpl, implementation) as Snapshot;
    const First = Reflect.get(first.globalObject, 'ConvertedSnapshot') as { prototype: object; };
    const store = Reflect.get(First.prototype, 'store') as (entries: readonly object[]) => void;
    Reflect.apply(store, object, [[entry]]);
    const converted = implementation.entries!;

    expect(Object.isFrozen(converted)).toBe(true);
    expect(Object.getPrototypeOf(converted)).toBe(first.realm.Array.prototype);
    expect(object.entries).toBe(converted);
    expect(object.entries![0]).toBe(entry);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Apply the borrowed getter with its explicit receiver.
    const getter = Object.getOwnPropertyDescriptor(First.prototype, 'entries')!.get!;
    expect(Reflect.apply(getter, object, [])).toBe(converted);

    Reflect.apply(store, object, [converted]);
    expect(implementation.entries).not.toBe(converted);
    expect(object.entries).toBe(implementation.entries);
    expect(object.entries![0]).toBe(entry);
  });

  it('preserves an array created explicitly by another realm binding', () => {
    const world = new BindingWorld(definitions);
    const first = installTestBindings(world);
    const second = installTestBindings(world);
    const type = world.getRealmBinding(first.realm)!.assembly.getIDLType(frozenArray(reference('Entry')));
    const converted = first.context.createFrozenArray([new EntryImpl()], type);
    const implementation = new ConvertedSnapshotImpl();
    implementation.entries = converted as readonly object[];
    const object = second.context.project(ConvertedSnapshotImpl, implementation) as Snapshot;

    expect(object.entries).toBe(converted);
    expect(Object.getPrototypeOf(object.entries)).toBe(first.realm.Array.prototype);
    expect(object.entries![0]).toBe(converted[0]);
  });
});

class EntryImpl { value = 'entry'; }

class SnapshotImpl {
  entries: readonly EntryImpl[] | null = null;
  reads = 0;

  get values() {
    this.reads++;
    return this.entries;
  }
}

class ConvertedSnapshotImpl {
  entries: readonly object[] | null = null;

  store(entries: readonly object[]) { this.entries = entries; }
}

interface Snapshot { entries: readonly object[] | null; }

/*
 * [Exposed=*]
 * interface Entry { readonly attribute DOMString value; };
 */
const entryIDL = defineInterface({
  name: 'Entry', exposed: '*', implementation: impl(EntryImpl),
  members: [roAttr('value', idlType.DOMString)],
});

/*
 * [Exposed=*]
 * interface Snapshot { readonly attribute FrozenArray<Entry>? entries; };
 */
const snapshotIDL = defineInterface({
  name: 'Snapshot', exposed: '*', implementation: impl(SnapshotImpl),
  members: [roAttr('entries', nullable(frozenArray(reference('Entry'))), {
    overrideGet() { return (this as SnapshotImpl).values; },
  })],
});

/*
 * [Exposed=*]
 * interface ConvertedSnapshot {
 *   readonly attribute FrozenArray<Entry>? entries;
 *   undefined store(FrozenArray<Entry> entries);
 * };
 */
const convertedSnapshotIDL = defineInterface({
  name: 'ConvertedSnapshot', exposed: '*', implementation: impl(ConvertedSnapshotImpl),
  members: [
    roAttr('entries', nullable(frozenArray(reference('Entry')))),
    op('store', idlType.undefined, [arg('entries', frozenArray(reference('Entry')))]),
  ],
});

const definitions = [entryIDL, snapshotIDL, convertedSnapshotIDL];
