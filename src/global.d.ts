import type { Snapshot as _Snapshot } from './snapshot';
import type { createSelectlet as _createSelectlet, Selectlet as _Selectlet, QueryContext as _QueryContext } from './selectlet';
import type { createStylelet as _createStylelet, Stylelet as _Stylelet } from './stylelet/stylelet';

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
}
