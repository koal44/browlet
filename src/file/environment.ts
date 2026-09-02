import { defineCapability } from '../web-idl/capability';
import type { BindingContext } from '../web-idl/projection';

/** Host services which File API algorithms cannot derive from ECMAScript. */
export const fileHost = defineCapability<FileHost>('File host');
export const fileClockHost = defineCapability<FileClockHost>(
  'File clock host',
);

export type FileHost = {
  getNativeLineEnding(global: object): NativeLineEnding;
  queueFileReadingTask(global: object, steps: () => void): void;
  runInParallel(global: object, steps: () => void): void;
};

export type FileClockHost = {
  currentUnixTime(global: object): number;
};

export type NativeLineEnding = '\n' | '\r\n';

export function getNativeLineEnding(
  context: BindingContext,
): NativeLineEnding {
  const { global, host } = requireFileHost(context);
  return host.getNativeLineEnding(global);
}

export function currentUnixTime(context: BindingContext): number {
  const global = requireFileGlobal(context);
  const host = context.getCapability(
    global.primaryInterface.definition,
    fileClockHost,
  );
  if (!host) throw new Error('The relevant global has no File clock host');
  return host.currentUnixTime(global.implementation);
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
  const global = requireFileGlobal(context);
  const host = context.getCapability(
    global.primaryInterface.definition,
    fileHost,
  );
  if (!host) {
    throw new Error('The relevant global has no File host capability');
  }
  return { global: global.implementation, host };
}

function requireFileGlobal(context: BindingContext) {
  const global = context.resolvePlatformObject(context.realm.global);
  if (!global) throw new Error('The relevant global is not a platform object');
  return global;
}
