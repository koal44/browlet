import type { Definition } from '../../../../web-idl/index';

import { trustedHTMLIDL, trustedScriptIDL, trustedScriptURLIDL, trustedTypeIDL } from './value';
import {
  trustedTypePolicyIDL, trustedTypePolicyOptionsIDL, createHTMLCallbackIDL,
  createScriptCallbackIDL, createScriptURLCallbackIDL,
} from './policy';
import { trustedTypePolicyFactoryIDL } from './factory';

export { TrustedHTMLImpl, TrustedScriptImpl, TrustedScriptURLImpl, type TrustedTypeName } from './value';
export { TrustedTypePolicyImpl, type TrustedTypePolicyOptions } from './policy';
export { TrustedTypePolicyFactoryImpl } from './factory';

export const trustedTypesIDLDefinitions: Definition[] = [
  trustedHTMLIDL, trustedScriptIDL, trustedScriptURLIDL, trustedTypeIDL,
  trustedTypePolicyIDL, trustedTypePolicyOptionsIDL, createHTMLCallbackIDL,
  createScriptCallbackIDL, createScriptURLCallbackIDL, trustedTypePolicyFactoryIDL,
];
