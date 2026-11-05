import { defineIncludes, type Definition } from '../../web-idl/core/index';
import { navigatorPermissionsIDL } from '../../permissions/index';

import { navigatorClipboardIDL } from '../interaction/clipboard/index';
import type { BrowletEnvironment } from '../environment/index';

import { navigatorIDL } from './navigator';
import { workerNavigatorIDL } from './worker-navigator';

// TODO(HTML §10): Worker NavigatorStorage and workerNavigatorPermissionsIDL need worker settings/startup.
export const navigatorIDLDefinitions: Definition<BrowletEnvironment>[] = [
  navigatorIDL,
  workerNavigatorIDL,
  navigatorPermissionsIDL,
  navigatorClipboardIDL,
  defineIncludes({ interface: 'Navigator', mixin: 'NavigatorStorage' }),
];
