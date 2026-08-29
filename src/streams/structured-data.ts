import { defineCapability } from '../web-idl/capability';
import type { BindingContext } from '../web-idl/projection';

/** HTML-owned structured cloning required by tee's clone-for-branch-2 path. */
export const streamStructuredData = defineCapability<StreamStructuredData>(
  'Streams structured data',
);

export type StreamStructuredData = {
  clone(global: object, value: unknown): unknown;
};

export function cloneStreamValue(
  context: BindingContext,
  value: unknown,
): unknown {
  const global = context.resolvePlatformObject(context.realm.global);
  const structuredData = global && context.getCapability(
    global.primaryInterface.definition,
    streamStructuredData,
  );
  if (!global || !structuredData) {
    throw new Error('The stream realm has no structured-data capability');
  }
  try {
    return structuredData.clone(global.implementation, value);
  } catch (exception) {
    throw context.realizeException(exception);
  }
}
