import type { Snapshot as _Snapshot } from '../src/selectlet/snapshot';
import type {
  createSelectlet as _createSelectlet, Selectlet as _Selectlet,
  QueryContext as _QueryContext,
} from '../src/selectlet/selectlet';
import type {
  createStylelet as _createStylelet,
  Stylelet as _Stylelet,
} from '../src/stylelet/stylelet';
import type { PwHelpers } from './harness/browser/browser';
import type { PerfHelpers } from './selectlet/perf/harness/perf-scenario';

export {};

declare global {
  type Selectlet = _Selectlet;
  type Stylelet = _Stylelet;
  type Snapshot = _Snapshot;
  type QueryContext = _QueryContext;

  var selectlet: undefined | (Selectlet & { snapshot: Snapshot; });
  var stylelet: undefined | Stylelet;
  var createSelectlet: typeof _createSelectlet;
  var createStylelet: typeof _createStylelet;

  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Window {
    __pwHelpers: PwHelpers;
    __pwXml: XMLDocument;
    __pwArg: unknown;
    __perfHelpers: PerfHelpers;
    __perfXml: XMLDocument | undefined;
  }
}
