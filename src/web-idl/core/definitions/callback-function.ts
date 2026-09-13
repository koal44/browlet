import type { ArgumentDefinition, ExtendedAttribute, WebIDLType } from '../definition';

export type CallbackFunctionDefinition = {
  kind: 'callback-function';
  name: string;
  returns: WebIDLType;
  arguments: ArgumentDefinition[];
  extendedAttributes?: ExtendedAttribute[];
};

// Project builder for Web IDL §2.10 Callback functions.
export function defineCallbackFunction(
  definition: Omit<CallbackFunctionDefinition, 'kind'>,
): CallbackFunctionDefinition {
  return { kind: 'callback-function', ...definition };
}
