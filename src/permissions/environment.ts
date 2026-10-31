import type { InternalPromise } from '../infra/index';
import type { JSEnvironment } from '../js-engine/index';
import type { Origin } from '../url/index';

import type { PermissionChoiceRequest, PermissionSelection, PermissionsImpl, PermissionStatusData } from './permissions';
import type { PermissionDescriptor, PermissionStore } from './store';

/** The Permissions-owned view of an existing browser environment. */
export interface PermissionEnvironment extends JSEnvironment {
  /** Browser owner retaining feature definitions, decisions, and host interactions. */
  userAgent: PermissionUserAgent;
  /** Permission algorithms and the object exposed by this environment's Navigator. */
  permissions: PermissionsImpl;
  /** HTML's secure-context determination, including ancestor restrictions. */
  isSecureContext: boolean;
  /** Top-level security origin; null means initialization has not supplied it. */
  topLevelOrigin: Origin | null;
  /** Requesting environment's security origin. */
  origin: Origin;
  /** Whether this environment has Window's query activity requirement. */
  isWindow: boolean;
  /** Apply the associated Document's feature policy; globals without a Document allow this check. */
  isAllowedToUse(feature: string): boolean;
  /** Whether the associated Document exists and is fully active. */
  isAssociatedDocumentFullyActive(): boolean;
  /** Convert the original author object using the selected feature's dictionary declaration. */
  convertPermissionDescriptor(value: object, type: string): PermissionDescriptor;
  /** Allocate the feature's result interface with this environment's binding ownership. */
  createPermissionStatus(descriptor: PermissionDescriptor): PermissionStatusData;
}

/** Browser-owned permission state, continuations, and host consent interactions. */
export interface PermissionUserAgent {
  /** One decision store for every installed powerful feature. */
  permissionStore: PermissionStore;
  /** Continuations that can outlive any particular page. */
  HostPromise: typeof InternalPromise;
  /** Ask for new consent; false means denied. This does not update the store. */
  promptForPermission(descriptor: PermissionDescriptor, env: PermissionEnvironment): InternalPromise<boolean>;
  /** Present options and prompt information, or return denied. */
  choosePermissionOptions<T>(request: PermissionChoiceRequest<T>, env: PermissionEnvironment): InternalPromise<PermissionSelection<T>>;
}
