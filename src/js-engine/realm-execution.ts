import type { AsyncExecution } from '../infra/execution';
import type { RuntimeBuffers } from './buffers';
import type { GlobalObject } from './realm';

/** JavaScript execution and allocation facilities for one owning realm/global. */
export interface RealmExecution extends AsyncExecution {
  /** The owning global object, including when selected as an HTML task destination. */
  global: GlobalObject;
  /** Captured JavaScript constructor for native Promise resolution. */
  NativePromise: PromiseConstructor;
  /** Captured constructors for errors whose realm must be fixed before delivery. */
  TypeError: TypeErrorConstructor;
  RangeError: RangeErrorConstructor;
  buffers: RuntimeBuffers;

  queueMicrotask(steps: () => void): void;
  /** Parse JSON in the owner's realm without calling an author-replaced JSON.parse. */
  parseJSON(text: string): unknown;
  /** Serialize using the owner's captured JSON intrinsic. */
  stringifyJSON(value: unknown): string | undefined;
}
