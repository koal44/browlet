import type { ImportMap, SpecifierResolutionRecord } from './import-map';

/** Internal state shared by HTML's Window, worker, and worklet global implementations. */
// https://html.spec.whatwg.org/multipage/webappapis.html#realms-settings-objects-global-objects
// These fields are not Web IDL members and are not projected as author properties.
export interface BrowletGlobalObject {
  /** Prevent recursively reporting an exception while this global dispatches its error event. */
  inErrorReportingMode: boolean;
  /** Rejected promises already reported as unhandled and still awaiting a handler. */
  outstandingRejectedPromises: WeakSet<Promise<unknown>>;
  /** Rejected promises waiting for the next unhandled-rejection notification pass. */
  aboutToBeNotifiedRejectedPromises: Promise<unknown>[];
  /** Registered module specifier mappings and integrity metadata for this global. */
  importMap: ImportMap;
  /** Completed resolutions that later import maps must preserve. */
  resolvedModuleSet: Set<SpecifierResolutionRecord>;
  /** Merge into this global's existing import map, preserving its completed resolutions. */
  mergeImportMap(newImportMap: ImportMap): void;
}
