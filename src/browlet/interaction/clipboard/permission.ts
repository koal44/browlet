import { defineDictionary, dictMember, idlType } from '../../../web-idl/core/index';
import {
  PermissionFeature, originPermissionKey, type PermissionDescriptor, type PermissionEnvironment,
  type PermissionState, type PermissionStatusData,
} from '../../../permissions/index';

/** Clipboard's two consent levels share the existing permission store and query lifecycle. */
// https://w3c.github.io/clipboard-apis/#permissions-integration
export class ClipboardWritePermission extends PermissionFeature<ClipboardPermissionDescriptor> {
  constructor() {
    super('clipboard-write', originPermissionKey, {
      descriptorType: 'ClipboardPermissionDescriptor',
      // Base descriptors also mean allowWithoutGesture=false.
      descriptorsEqual: (a, b) => (a.allowWithoutGesture === true) === (b.allowWithoutGesture === true),
    });
  }

  /** Resolve Clipboard's descriptor relationship without changing the stored decisions. */
  getState(allowWithoutGesture: boolean, env: PermissionEnvironment): PermissionState {
    const withGesture = env.permissions.getPermissionState({ name: this.name, allowWithoutGesture: false });
    // SPEC_GAP(clipboard-permission-conflicting-decisions): A weaker denial overrides
    // a contradictory stronger grant. The specifications do not resolve conflicting entries.
    if (withGesture === 'denied') return 'denied';
    const withoutGesture = env.permissions.getPermissionState({ name: this.name, allowWithoutGesture: true });
    if (withoutGesture === 'granted') return 'granted';
    return allowWithoutGesture ? withoutGesture : withGesture;
  }

  override query(descriptor: ClipboardPermissionDescriptor, status: PermissionStatusData, env: PermissionEnvironment): void {
    status.state = this.getState(descriptor.allowWithoutGesture, env);
  }
}

export const clipboardWritePermission = new ClipboardWritePermission();

export interface ClipboardPermissionDescriptor extends PermissionDescriptor {
  allowWithoutGesture: boolean;
}

/*
 * dictionary ClipboardPermissionDescriptor : PermissionDescriptor {
 *   boolean allowWithoutGesture = false;
 * };
 */
export const clipboardPermissionDescriptorIDL = defineDictionary({
  name: 'ClipboardPermissionDescriptor', inherits: 'PermissionDescriptor',
  members: [dictMember('allowWithoutGesture', idlType.boolean, { default: false })],
});
