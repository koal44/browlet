import { defineCapability } from '../web-idl/capability';
import type { BindingContext } from '../web-idl/projection';
import { idlType, promise, reference } from '../web-idl/declaration/index';
import type { StreamAbortController } from './abort';

/** BINDING_INTEGRATION: capture a stream dictionary after its other arguments convert. */
export function convertStreamCallbacks(
  context: BindingContext,
  object: unknown,
  dictionary: string,
  callbackNames: readonly string[],
): object {
  const record = context.convert(object, reference(dictionary)) as Record<string, unknown>;
  for (const name of callbackNames) {
    const callback = record[name] as ((...args: unknown[]) => unknown) | undefined;
    if (callback === undefined) continue;
    record[name] = (...args: unknown[]) => {
      const result = Reflect.apply(callback, object, args);
      // Start returns any; Streams subsequently resolves a promise with it.
      return name === 'start' ? context.convert(result, promise(idlType.any)) : result;
    };
  }
  return record;
}

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
