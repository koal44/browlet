import { defineIncludes, type Definition } from '../../web-idl/core/index';
import { navigatorPermissionsIDL } from '../../permissions/index';

import { navigatorClipboardIDL } from '../interaction/clipboard/index';
import type { BrowletEnvironment } from '../environment/index';

import { navigatorIDL } from './navigator';
import { navigatorIDIDL } from './identification';
import { navigatorLanguageIDL } from './language';
import { navigatorOnLineIDL } from './online';
import { navigatorContentUtilsIDL } from './protocol-handler';
import { workerNavigatorIDL } from './worker-navigator';

// TODO(HTML §10): Worker NavigatorStorage and workerNavigatorPermissionsIDL need worker settings/startup.
export const navigatorIDLDefinitions: Definition<BrowletEnvironment>[] = [
  navigatorIDL,
  workerNavigatorIDL,
  navigatorIDIDL,
  navigatorLanguageIDL,
  navigatorOnLineIDL,
  navigatorContentUtilsIDL,
  navigatorPermissionsIDL,
  navigatorClipboardIDL,
  defineIncludes({ interface: 'Navigator', mixin: 'NavigatorID' }),
  defineIncludes({ interface: 'WorkerNavigator', mixin: 'NavigatorID' }),
  defineIncludes({ interface: 'Navigator', mixin: 'NavigatorLanguage' }),
  defineIncludes({ interface: 'WorkerNavigator', mixin: 'NavigatorLanguage' }),
  defineIncludes({ interface: 'Navigator', mixin: 'NavigatorOnLine' }),
  defineIncludes({ interface: 'WorkerNavigator', mixin: 'NavigatorOnLine' }),
  defineIncludes({ interface: 'Navigator', mixin: 'NavigatorContentUtils' }),
  defineIncludes({ interface: 'Navigator', mixin: 'NavigatorStorage' }),
];
