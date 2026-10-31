import { defineInterfaceMixin, reference, roAttr, xattr, type Definition } from '../web-idl/core/index';

import type { StorageEnvironment } from './environment';
import { storageEstimateIDL, storageManagerIDL } from './manager';

/*
 * [SecureContext]
 * interface mixin NavigatorStorage {
 *   [SameObject] readonly attribute StorageManager storage;
 * };
 * Navigator includes NavigatorStorage;
 * WorkerNavigator includes NavigatorStorage;
 */
// HTML supplies Navigator's forwarding getter and includes this mixin in its declarations.
export const navigatorStorageIDL = defineInterfaceMixin({
  name: 'NavigatorStorage',
  ...xattr('SecureContext'),
  members: [roAttr('storage', reference('StorageManager'), xattr('SameObject'))],
});

/** Storage declarations supplied to the host binding. */
export const storageIDLDefinitions: Definition<StorageEnvironment>[] = [
  navigatorStorageIDL, storageManagerIDL, storageEstimateIDL,
];
