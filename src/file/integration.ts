import { type Capability, defineCapability } from '../web-idl/capability';
import type { BindingContext } from '../web-idl/projection';

/*
 * File's integration boundary. File defines the capabilities it consumes;
 * the composing browser registers their values for each exposed global
 * interface. File reading bridges to HTML scheduling, while the native line
 * ending carries platform policy. The composing browser may delegate
 * runInParallel to its shared HTML policy or supply a feature-specific
 * implementation without File importing either one.
 */
export const nativeLineEnding =
  defineCapability<NativeLineEnding>('native line ending');
export const fileReading =
  defineCapability<FileReadingCapability>('File reading');

export type FileReadingCapability = {
  queueTask(global: object, steps: () => void): void;
  runInParallel(steps: () => void): void;
};

export type NativeLineEnding = '\n' | '\r\n';

export function getNativeLineEnding(
  context: BindingContext,
): NativeLineEnding {
  const [, value] = getGlobalCapability(context, nativeLineEnding);
  return value;
}

export function getFileReading(
  context: BindingContext,
): {
  queueTask(steps: () => void): void;
  runInParallel(steps: () => void): void;
} {
  const [global, capability] = getGlobalCapability(context, fileReading);
  return {
    queueTask: (steps) => capability.queueTask(global, steps),
    runInParallel: (steps) => capability.runInParallel(steps),
  };
}

/* Missing values indicate incomplete host composition, not optional state. */
function getGlobalCapability<Value>(
  context: BindingContext,
  capability: Capability<Value>,
): [global: object, value: Value] {
  const global = context.resolvePlatformObject(context.realm.global);
  if (!global) {
    throw new Error('The relevant global is not a platform object');
  }

  const value = context.getCapability(
    global.primaryInterface.definition,
    capability,
  );
  if (value === undefined) {
    throw new Error(`The relevant global has no ${capability.name}`);
  }
  return [global.implementation, value];
}
