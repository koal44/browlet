import { InternalPromise, internalType } from '../../src/infra/index';
import { BindingWorld } from '../../src/web-idl/index';
import { readableStreamReadResultIDL } from '../../src/streams/index';
import { obtainURLOrigin, parseURL } from '../../src/url/index';
import {
  PermissionStore, PermissionsImpl, type PermissionEnvironment, type PermissionUserAgent,
} from '../../src/permissions/index';

import { createEnvironment, type TestEnvironment } from './environment';
import { TestRealm } from './web-idl-realm';

/** Browser-owned decisions with explicit host interactions for each test to configure. */
export function createPermissionUserAgent(permissionStore = new PermissionStore([])): PermissionUserAgent {
  return {
    permissionStore,
    HostPromise: InternalPromise,
    promptForPermission() { return InternalPromise.resolve(true, internalType<boolean>()); },
    choosePermissionOptions() { throw new Error('This fixture has no permission chooser'); },
  };
}

/** Bind the real realm facilities; unit algorithms receive converted descriptors and host policy answers. */
export function createPermissionEnvironment(
  userAgent = createPermissionUserAgent(), top = 'https://top.test/', embedded = 'https://requesting.test/',
): PermissionTestEnvironment {
  const realm = new TestRealm();
  let permissions: PermissionsImpl | undefined;
  return new BindingWorld<PermissionTestEnvironment>([readableStreamReadResultIDL])
    .register(realm, (binding) => ({
      ...createEnvironment(realm, binding),
      userAgent,
      get permissions(): PermissionsImpl { return permissions ??= new PermissionsImpl(this); },
      isWindow: false,
      isSecureContext: true,
      topLevelOrigin: obtainURLOrigin(parseURL(top).url!),
      origin: obtainURLOrigin(parseURL(embedded).url!),
      isAllowedToUse: () => true,
      isAssociatedDocumentFullyActive: () => false,
      convertPermissionDescriptor() { throw new Error('Descriptor conversion is tested through the browser binding'); },
      createPermissionStatus() { throw new Error('PermissionStatus allocation is tested through the browser binding'); },
    })).getEnvironment();
}

/** One bound owner shared by Permissions and the ordinary test realm facilities. */
export interface PermissionTestEnvironment extends PermissionEnvironment, TestEnvironment {
  /** Realm supplied by the shared Binding test infrastructure. */
  realm: TestRealm;
}
