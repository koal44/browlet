import { defineCapability } from '../web-idl/capability';
import type { BindingContext } from '../web-idl/projection';
import type { StreamAbortController } from './abort';

/** DOM-owned AbortController construction supplied at the binding boundary. */
export const streamAbortController = defineCapability<
  StreamAbortControllerCapability
>('Streams AbortController');

// BINDING_INTEGRATION: construct a DOM AbortController for the stream's relevant realm.
export function createStreamAbortController(context: BindingContext): StreamAbortController {
  const global = context.resolvePlatformObject(context.realm.global);
  const capability = global && context.getCapability(
    global.primaryInterface.definition,
    streamAbortController,
  );
  if (!global || !capability) {
    throw new Error('The stream realm has no AbortController capability');
  }
  return capability.create(context);
}

export type StreamAbortControllerCapability = {
  // BINDING_INTEGRATION: the composing browser supplies this construction step.
  create(context: BindingContext): StreamAbortController;
};
