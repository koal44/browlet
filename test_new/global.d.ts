import type { PwHelpers } from './browser/harness/browser';

export {};

declare global {
  interface Window {
    __pwHelpers: PwHelpers;
    __pwXml: XMLDocument;
    __pwArg: unknown;
  }
}
