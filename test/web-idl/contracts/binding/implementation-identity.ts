import type { AssembledInterfaceDefinition, DefinitionAssembly } from '../../../../src/web-idl/assembly';
import { convertBufferSourceToIDL, convertBufferSourceToJavaScript } from '../../../../src/web-idl/buffer-source';
import type { StampedImplInstance, PlatformRecord, WebIDLType } from '../../../../src/web-idl/index';
import {
  associatePlatformObject, getImplementationRecord, getPlatformRecord,
  stampImplementation,
} from '../../../../src/web-idl/platform-object';
import type { RealmBinding } from '../../../../src/web-idl/realm-binding';
import { getUnannotatedType } from '../../../../src/web-idl/types';

declare const binding: RealmBinding;
const primaryInterface: AssembledInterfaceDefinition = binding.resolveInterface('Example');
declare const definitions: DefinitionAssembly;
declare const type: WebIDLType;
declare const authorValue: unknown;
const implInst = { count: 1 };
const platformObject = { authorProperty: true };

const projected: PlatformRecord<typeof implInst> = binding.projectPlatformObject(implInst, primaryInterface);
const created: PlatformRecord = binding.createPlatformRecord(primaryInterface);
const global: PlatformRecord<typeof implInst> = binding.projectGlobalObject(implInst, primaryInterface);
const paired: PlatformRecord<typeof implInst> = binding.initializePlatformObject(platformObject, primaryInterface, implInst);
// @ts-expect-error The implementation must be supplied separately from the platform object.
binding.initializePlatformObject(platformObject, primaryInterface);
const registered: PlatformRecord<typeof implInst> = associatePlatformObject(platformObject, implInst, primaryInterface, binding);
const found: StampedImplInstance<typeof implInst> | undefined = getImplementationRecord(implInst)?.implInst;
const stamped = stampImplementation(implInst, primaryInterface, binding);
const foundStamped: StampedImplInstance<typeof implInst> | undefined = getImplementationRecord(stamped)?.implInst;
// @ts-expect-error Name lookup accepts a name, not an already assembled definition.
binding.resolveInterface(primaryInterface);
// @ts-expect-error Internal creation requires the already assembled primary interface.
binding.createPlatformRecord('Example');
// @ts-expect-error Internal projection requires the already assembled primary interface.
binding.projectGlobalObject(implInst, 'Example');
binding.context.projectGlobalObject(implInst, 'Example');
// @ts-expect-error The external projection boundary accepts an interface name.
binding.context.projectGlobalObject(implInst, primaryInterface);
projected.implInst.count.toFixed();
// @ts-expect-error The record retains the implementation shape, not the platform shape.
paired.implInst.authorProperty;
// @ts-expect-error An unknown incoming value does not identify a concrete implementation type.
getImplementationRecord(authorValue)?.implInst.count;
// @ts-expect-error A platform-object lookup cannot infer the shape of its implementation from its key.
getPlatformRecord(platformObject)?.implInst.authorProperty;

const buffer: ArrayBufferLike | ArrayBufferView = convertBufferSourceToIDL(authorValue, 'Uint8Array', []);
const returnedBuffer: ArrayBufferLike | ArrayBufferView = convertBufferSourceToJavaScript(authorValue, 'ArrayBuffer');
buffer.byteLength.toFixed();
returnedBuffer.byteLength.toFixed();
// @ts-expect-error Outer annotations have been removed from the result.
const annotation: 'annotated' = getUnannotatedType(type, definitions).kind;
