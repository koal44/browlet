import type { AsyncExecution } from '../infra/execution';
import type { JSONValue, InfraValue } from '../infra/json';

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
  /** Parse JSON with the owner's captured intrinsic. */
  parseJSON(text: string): JSONValue;
  /** Call the captured JSON.stringify, including its undefined result. */
  stringifyJSON(value: unknown): string | undefined;
  /** Serialize JavaScript as JSON, throwing when it has no JSON representation. */
  serializeJavaScriptValueToJSONString(value: unknown): string;
  /** Parse JSON into realm-independent maps, lists, and primitives. */
  parseJSONStringToInfra(input: string): InfraValue;
  /** Serialize Infra data using this realm's intrinsics and allocation. */
  serializeInfraValueToJSONString(value: InfraValue): string;
  /** Convert Infra data to arrays and null-prototype objects in this realm. */
  convertInfraValueToJavaScript(value: InfraValue): JSONValue;
}
