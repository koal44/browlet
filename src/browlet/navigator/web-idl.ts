import { defineIncludes, type Definition } from '../../web-idl/core/index';
import { navigatorPermissionsIDL } from '../../permissions/index';

import type { BrowletEnvironment } from '../environment';

import { navigatorIDL } from './navigator';

// TODO(HTML §10): WorkerNavigator, NavigatorStorage, and workerNavigatorPermissionsIDL need worker settings/startup.
export const navigatorIDLDefinitions: Definition<BrowletEnvironment>[] = [
  navigatorIDL,
  navigatorPermissionsIDL,
  defineIncludes({ interface: 'Navigator', mixin: 'NavigatorStorage' }),
];
