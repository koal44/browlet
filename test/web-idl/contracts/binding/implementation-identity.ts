import type { DefinitionAssembly, AssembledInterface } from '../../../../src/web-idl/assembly/index';

import { idlType, type StampedImplInstance, type StampedPlatformObject, type WebIDLType } from '../../../../src/web-idl/index';
import {
  getImplementationRecord, getPlatformRecord,
  stampImplementation, PlatformRecord,
} from '../../../../src/web-idl/binding/platform';
import type { RealmBinding } from '../../../../src/web-idl/binding/realm';

declare const binding: RealmBinding;
const assembled: AssembledInterface = binding.resolveInterface('Example');
declare const assembly: DefinitionAssembly;
declare const type: WebIDLType;
declare const authorValue: unknown;
const implInst = { count: 1 };
const platformObject = { authorProperty: true };

const record: PlatformRecord<typeof implInst> = new PlatformRecord(implInst, assembled, binding);
const projected: StampedPlatformObject = record.project();
const created: PlatformRecord = binding.allocatePlatformRecord(assembled);
binding.getImplementationBinding(assembled);
// @ts-expect-error Realm binding caches use assembled definitions, not their declarations.
binding.getImplementationBinding(assembled.primary);
const global: PlatformRecord<typeof implInst> = binding.projectGlobalRecord(implInst, assembled);
const paired: PlatformRecord<typeof implInst> = binding.initializePlatformObject(platformObject, assembled, implInst);
// @ts-expect-error The implementation must be supplied separately from the platform object.
binding.initializePlatformObject(platformObject, assembled);
const found: StampedImplInstance<typeof implInst> | undefined = getImplementationRecord(implInst)?.implInst;
const stamped = stampImplementation(implInst, assembled, binding);
const foundStamped: StampedImplInstance<typeof implInst> | undefined = getImplementationRecord(stamped)?.implInst;
// @ts-expect-error Name lookup accepts a name, not an already assembled definition.
binding.resolveInterface(assembled);
// @ts-expect-error Internal creation requires the already assembled primary interface.
binding.allocatePlatformRecord('Example');
// @ts-expect-error Internal projection requires the already assembled primary interface.
binding.projectGlobalRecord(implInst, 'Example');
binding.projectGlobalObject(implInst, 'Example');
// @ts-expect-error The external projection boundary accepts an interface name.
binding.projectGlobalObject(implInst, assembled);
record.implInst.count.toFixed();
// @ts-expect-error The record retains the implementation shape, not the platform shape.
paired.implInst.authorProperty;
// @ts-expect-error An unknown incoming value does not identify a concrete implementation type.
getImplementationRecord(authorValue)?.implInst.count;
// @ts-expect-error A platform-object lookup cannot infer the shape of its implementation from its key.
getPlatformRecord(platformObject)?.implInst.authorProperty;

const buffer: ArrayBufferLike | ArrayBufferView = binding.getConverter(binding.assembly.getIDLType(idlType.Uint8Array)).jsToIDL(authorValue);
const returnedBuffer: ArrayBufferLike | ArrayBufferView = binding.getConverter(binding.assembly.getIDLType(idlType.ArrayBuffer)).idlToJS(authorValue);
buffer.byteLength.toFixed();
returnedBuffer.byteLength.toFixed();
// @ts-expect-error Outer annotations have been removed from the result.
const annotation: 'annotated' = assembly.getIDLType(type).kind;
