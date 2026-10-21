import type { Definition } from '../../../../web-idl/core/index';

import { trustedHTMLIDL, trustedScriptIDL, trustedScriptURLIDL, trustedTypeIDL } from './value';
import {
  trustedTypePolicyIDL, trustedTypePolicyOptionsIDL, createHTMLCallbackIDL,
  createScriptCallbackIDL, createScriptURLCallbackIDL,
} from './policy';
import { trustedTypePolicyFactoryIDL } from './factory';

/** Trusted Types declarations supplied to the browser binding. */
export const trustedTypesIDLDefinitions: Definition[] = [
  trustedHTMLIDL, trustedScriptIDL, trustedScriptURLIDL, trustedTypeIDL,
  trustedTypePolicyIDL, trustedTypePolicyOptionsIDL, createHTMLCallbackIDL,
  createScriptCallbackIDL, createScriptURLCallbackIDL, trustedTypePolicyFactoryIDL,
];
