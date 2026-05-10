import type { PwHelpers } from './browser/harness/browser';
import type { PerfHelpers } from './perf/harness/perf-scenario';

export {};

declare global {
  interface Window {
    __pwHelpers: PwHelpers;
    __pwXml: XMLDocument;
    __pwArg: unknown;
    __perfHelpers: PerfHelpers;
    __perfXml: XMLDocument;
  }
}
