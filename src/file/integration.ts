import { defineCapability } from '../web-idl/capability';

/*
 * File's integration boundary. File defines the capabilities it consumes;
 * the composing browser registers their values against the interface which
 * consumes them. Native line ending is immutable platform policy read by
 * Blob construction. RuntimeContext supplies file-reading task delivery.
 */
export const nativeLineEnding =
  defineCapability<NativeLineEnding>('native line ending');
export type NativeLineEnding = '\n' | '\r\n';
