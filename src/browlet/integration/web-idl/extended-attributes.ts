import type { ExtendedAttributeHooks } from '../../../web-idl/index';

import type { BrowletEnvironment } from '../../environment';

import { prepareReflectedAttribute } from './reflection';
import { prepareCustomElementConstructor } from './html-constructor';
import { prepareCrossOriginSecurityCheck } from './cross-origin';

/** HTML-owned annotation behavior supplied to Browlet's binding world. */
export const htmlExtendedAttributeHooks: ExtendedAttributeHooks<BrowletEnvironment> = {
  // Declaration tests establish the owner contracts; erase receiver types only at the generic registry boundary.
  prepareReflectedAttribute: prepareReflectedAttribute as ExtendedAttributeHooks<BrowletEnvironment>['prepareReflectedAttribute'],
  // HTML constructor declarations are exposed only in Window environments.
  prepareHTMLConstructor: prepareCustomElementConstructor as ExtendedAttributeHooks<BrowletEnvironment>['prepareHTMLConstructor'],
  prepareSecurityCheck: prepareCrossOriginSecurityCheck,
};
