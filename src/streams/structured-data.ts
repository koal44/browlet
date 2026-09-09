import { defineCapability } from '../web-idl/capability';

/** HTML-owned structured cloning required by tee's clone-for-branch-2 path. */
export const streamStructuredData = defineCapability<StreamStructuredData>(
  'Streams structured data',
);

export type StreamStructuredData = {
  clone(global: object, value: unknown): unknown;
};
