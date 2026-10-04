import type {
  createSelectlet as _createSelectlet, Selectlet as _Selectlet,
  QuerySource as _QuerySource,
} from '../src/selectlet/selectlet';
import type {
  Stylelet as _Stylelet,
} from '../src/stylelet/stylelet';
import type { PwHelpers } from './scenario/playwright/page';
import type { PerfHelpers } from './selectlet/perf/harness/perf-scenario';

export {};

declare global {
  type Selectlet = _Selectlet<Node, Element, Document, DocumentFragment>;
  type Stylelet = _Stylelet;
  type QuerySource = _QuerySource<Document, Element, DocumentFragment>;

  var selectlet: undefined | Selectlet;
  var stylelet: undefined | Stylelet;
  var createSelectlet: typeof _createSelectlet;
  var Stylelet: typeof _Stylelet;

  interface Window {
    __pwHelpers: PwHelpers;
    __pwXml: XMLDocument;
    __pwArg: unknown;
    __perfHelpers: PerfHelpers;
    __perfXml: XMLDocument | undefined;
  }
}
