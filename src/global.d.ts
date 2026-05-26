import type { Snapshot as SnapshotType } from './snapshot';
import type { Selectlet } from './selectlet';

export {};

declare global {
  type AmdDefine = {
    (factory: unknown): void;
    (deps: string[], factory: unknown): void;
    amd?: unknown;
  }

  var define: AmdDefine | undefined;
  var selectlet: Selectlet | undefined;

  type Snapshot = SnapshotType;
  type QueryContext = Document | Element | DocumentFragment;
  type QueryCallback = (element: Element) => boolean | void;
}
