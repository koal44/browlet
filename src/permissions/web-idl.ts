import {
  defineDictionary, defineEnumeration, definePartialInterface, dictMember, idlType, reference, roAttr, xattr, type Definition,
} from '../web-idl/core/index';

import type { PermissionEnvironment } from './environment';
import { permissionsIDL } from './permissions';

// https://w3c.github.io/permissions/#extensions-to-the-navigator-and-workernavigator-interfaces
// [Exposed=Window] partial interface Navigator {
//   [SameObject] readonly attribute Permissions permissions;
// };
export const navigatorPermissionsIDL = definePartialInterface({
  name: 'Navigator',
  exposed: 'Window',
  members: [roAttr('permissions', reference('Permissions'), xattr('SameObject'))],
});

// [Exposed=Worker] partial interface WorkerNavigator {
//   [SameObject] readonly attribute Permissions permissions;
// };
// TODO(HTML §10): Assemble this contribution when WorkerNavigator owns its Permissions object.
export const workerNavigatorPermissionsIDL = definePartialInterface({
  name: 'WorkerNavigator',
  exposed: 'Worker',
  members: [roAttr('permissions', reference('Permissions'), xattr('SameObject'))],
});

/** Shared interfaces; HTML assembles each Navigator contribution with its primary declaration. */
export const permissionsIDLDefinitions: Definition<PermissionEnvironment>[] = [
  permissionsIDL,
  defineDictionary({
    name: 'PermissionDescriptor',
    members: [dictMember('name', idlType.DOMString, { required: true })],
  }),
  defineEnumeration({ name: 'PermissionState', values: ['granted', 'denied', 'prompt'] }),
];
