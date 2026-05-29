import type { Snapshot as SnapshotType } from './snapshot';
import type { Selectlet, SelectletConfig } from './selectlet';

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

  type SelectletOptions = {
    config?: Partial<SelectletConfig>;
    caps?: SelectletCaps;
  };

  type SelectletCaps<
    E extends Element = Element,
    D extends Document = Document,
    F extends DocumentFragment = DocumentFragment,
  > = {
    doc?: DocumentCaps<E, D>;
    frag?: FragmentCaps<E, F>;
    // element?: RootCaps<E, E>;
  };

  type DocumentCaps<E extends Element, D extends Document> = {
    cachedIds?: (doc: D, id: string) => Iterable<E>;
    cachedClasses?: (doc: D, classes: readonly string[]) => Iterable<E>;
    designMode?: (doc: D) => string | undefined;
  };

  type FragmentCaps<E extends Element, F extends DocumentFragment> = {
    cachedIds?: (frag: F, id: string) => Iterable<E>;
    cachedClasses?: (frag: F, classes: readonly string[]) => Iterable<E>;
  };

  // type ElementCaps<E extends Element> = {
  //   // nada yet
  // };
}
