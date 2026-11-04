import type { ExtendedAttributeHooks } from '../../../../web-idl/index';

import type { BrowletEnvironment } from '../../../environment/index';

import { prepareReflectedAttribute } from './reflection';
import { prepareCustomElementConstructor } from './html-constructor';
import { prepareCrossOriginSecurityCheck } from './cross-origin';
import { prepareLocationObject } from './location';
import { prepareWindowProjectionOverride } from './window-proxy';

/** HTML-owned creation, projection, and annotation behavior supplied to Browlet's binding world. */
export const htmlExtendedAttributeHooks: ExtendedAttributeHooks<BrowletEnvironment> = {
  // Declaration tests establish the owner contracts; erase receiver types only at the generic registry boundary.
  prepareAttribute: prepareReflectedAttribute as ExtendedAttributeHooks<BrowletEnvironment>['prepareAttribute'],
  // HTML constructor declarations are exposed only in Window environments.
  prepareHTMLConstructor: prepareCustomElementConstructor as ExtendedAttributeHooks<BrowletEnvironment>['prepareHTMLConstructor'],
  prepareSecurityCheck: prepareCrossOriginSecurityCheck,
  preparePlatformObject: prepareLocationObject,
  prepareProjectionOverride: prepareWindowProjectionOverride as ExtendedAttributeHooks<BrowletEnvironment>['prepareProjectionOverride'],
};
