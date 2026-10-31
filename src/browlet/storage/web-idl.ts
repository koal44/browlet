import { defineIncludes } from '../../web-idl/core/index';

import { storageEventIDL, storageEventInitIDL } from './events/index';

import { storageIDL } from './storage';
import { windowSessionStorageIDL } from './window-session-storage';
import { windowLocalStorageIDL } from './window-local-storage';

/** HTML Web Storage declarations; distinct from the Storage Standard's management API. */
export const webStorageIDLDefinitions = [
  storageIDL, storageEventIDL, storageEventInitIDL,
  windowSessionStorageIDL, defineIncludes({ interface: 'Window', mixin: 'WindowSessionStorage' }),
  windowLocalStorageIDL, defineIncludes({ interface: 'Window', mixin: 'WindowLocalStorage' }),
];
