import type { ExtendedAttributeHooks } from '../../../web-idl/index';

import type { BrowletEnvironment } from '../../environment';

import { prepareReflectedAttribute } from './reflection';

/** HTML-owned annotation behavior supplied to Browlet's binding world. */
export const htmlExtendedAttributeHooks: ExtendedAttributeHooks<BrowletEnvironment> = {
  // Declaration tests establish the owner contracts; erase receiver types only at the generic registry boundary.
  prepareReflectedAttribute: prepareReflectedAttribute as ExtendedAttributeHooks<BrowletEnvironment>['prepareReflectedAttribute'],
};
