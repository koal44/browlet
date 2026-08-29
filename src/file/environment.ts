import { defineCapability } from '../web-idl/capability';
import type { BindingContext } from '../web-idl/projection';

/** Host services which File API algorithms cannot derive from ECMAScript. */
export const fileHost = defineCapability<FileHost>('File host');

export type FileHost = {
  getNativeLineEnding(global: object): NativeLineEnding;
  queueFileReadingTask(global: object, steps: () => void): void;
  runInParallel(global: object, steps: () => void): void;
};

export type NativeLineEnding = '\n' | '\r\n';

export function getNativeLineEnding(
  context: BindingContext,
): NativeLineEnding {
  const { global, host } = requireFileHost(context);
  return host.getNativeLineEnding(global);
}

export function queueFileReadingTask(
  context: BindingContext,
  steps: () => void,
): void {
  const { global, host } = requireFileHost(context);
  host.queueFileReadingTask(global, steps);
}

export function runFileStepsInParallel(
  context: BindingContext,
  steps: () => void,
): void {
  const { global, host } = requireFileHost(context);
  host.runInParallel(global, steps);
}

function requireFileHost(context: BindingContext): {
  global: object;
  host: FileHost;
} {
  const global = context.resolvePlatformObject(context.realm.global);
  const host = global && context.getCapability(
    global.primaryInterface.definition,
    fileHost,
  );
  if (!global || !host) {
    throw new Error('The relevant global has no File host capability');
  }
  return { global: global.implementation, host };
}
