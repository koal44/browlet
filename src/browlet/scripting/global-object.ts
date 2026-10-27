import type { ImportMap, SpecifierResolutionRecord } from './import-map';

/** Internal state shared by HTML's Window, worker, and worklet global implementations. */
// https://html.spec.whatwg.org/multipage/webappapis.html#realms-settings-objects-global-objects
// These fields are not Web IDL members and are not projected as author properties.
export interface BrowletGlobalObject {
  inErrorReportingMode: boolean;
  outstandingRejectedPromises: WeakSet<Promise<unknown>>;
  aboutToBeNotifiedRejectedPromises: Promise<unknown>[];
  importMap: ImportMap;
  resolvedModuleSet: Set<SpecifierResolutionRecord>;
}
