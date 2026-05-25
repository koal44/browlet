import type { Snapshot as SnapshotType } from './snapshot';

export {};

declare global {

interface AmdDefine {
  (factory: unknown): void;
  (deps: string[], factory: unknown): void;
  amd?: unknown;
}

var define: AmdDefine | undefined;

var selectlet: SxltApi | undefined;

type SxltConfig = Record<ConfigKey, boolean>;
type ConfigKey = 'NODE_LIST' | 'MUTATE_IDS';

type CustomPseudoPredicate = (element: Element) => boolean;

type Snapshot = SnapshotType;

type QueryContext = Document | Element | DocumentFragment;
type QueryCallback = (element: Element) => boolean | void;

type CandidateStrategy = 'id' | 'class' | 'tag' | 'walk';
type CandidateLookup = (ctx: QueryContext) => Element[];

type CandidatePlan = {
  strategy: CandidateStrategy;
  lookupQuery: string;
  lookup: CandidateLookup;
};

type SelectArm = {
  plan: CandidatePlan;
  matcher: SelectLambda;
};

type MatchLambda = (
  candidate: Element,
  h: HashCache | null,
) => boolean;

type SelectLambda = (
  candidates: Element[],
  callback: QueryCallback | null,
  context: QueryContext,
  results: Element[],
  h: HashCache,
) => Stopped

type Stopped = boolean;

type MatchResolver = {
  lambda: MatchLambda;
  usesScope: boolean;
};

type SelectResolver = {
  arms: SelectArm[];
  hasCb: boolean;
  usesScope: boolean;
};

type IndexedNodeList = NodeListOf<Element> & { length: number; [index: number]: Element };
type ElementList = Element[] | IndexedNodeList;

type SxltApi = {
  version: string;
  config: SxltConfig;
  snapshot: Snapshot;

  byId: (id: string, context?: QueryContext) => Element | null;
  byTag: (tag: string, context?: QueryContext) => ElementList;
  byTagNs: (ns: string | null, local: string, context?: QueryContext) => ElementList
  byClass: (cls: string, context?: QueryContext) => ElementList;

  first: (selectors: string, context?: QueryContext) => Element | null;
  match: (selectors: string, element: Element) => boolean;
  select: (selectors: string, context?: QueryContext, cb?: QueryCallback | null) => ElementList;
  closest: (selectors: string, element: Element) => Element | null;

  configure: (option: Partial<Record<ConfigKey, boolean>>) => void;
  registerPseudo(name: string, predicate: CustomPseudoPredicate): void;
  clearCache: () => void;

  install: (all?: boolean) => void;
  uninstall: () => void;

  setDebug: (enabled: boolean) => void;
  clearDebug: () => void;
  printDebug: () => string;
};

type QsaKey =
  'closest' | 'matches' | 'querySelector' | 'querySelectorAll' |
  'querySelectorDoc' | 'querySelectorAllDoc';

// --- parsing ---

type SelectorCombinator = ' ' | '>' | '+' | '~';

type HashCache = {
  nthElement?: WeakMap<ParentNode, NthElementIndexMap>;
  nthOfType?: WeakMap<ParentNode, NthOfTypeParentMap>;
};

type NthElementIndexMap = WeakMap<Element, number>;

type NthOfTypeParentMap = Map<string, NthOfTypeIndexEntry>;
type NthOfTypeIndexEntry = {
  length: number;
  indexMap: WeakMap<Element, number>;
};

} // end global declaration
