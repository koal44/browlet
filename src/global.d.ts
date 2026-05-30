import type { Snapshot as _Snapshot } from './snapshot';
import type { createSelectlet as _createSelectlet, Selectlet as _Selectlet, QueryContext as _QueryContext } from './selectlet';

export {};

declare global {
  type Selectlet = _Selectlet;
  type Snapshot = _Snapshot;
  type QueryContext = _QueryContext;

  var selectlet: undefined | (Selectlet & { snapshot: Snapshot; });
  var createSelectlet: typeof _createSelectlet;
}
