import type { BindingContext } from '../web-idl/projection';
import { idlType, promise, reference } from '../web-idl/declaration/index';

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
