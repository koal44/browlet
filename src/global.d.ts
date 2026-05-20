import type { Rex as RexType } from './rex';
import type { Snapshot as SnapshotType } from './snapshot';

export {};

declare global {

type Glob = typeof globalThis

interface AmdDefine {
  (factory: unknown): void;
  (deps: string[], factory: unknown): void;
  amd?: unknown;
}

var define: AmdDefine | undefined;

var NW: {
  Dom?: DomApi;
  [key: string]: unknown;
} | undefined;

type NwsConfig = Record<ConfigKey, boolean>;
type ConfigKey = 'NODE_LIST' | 'MUTATE_IDS';
type NwsExtensions = {
  combinators: string[];
  operators: string[];
}

type Rex = RexType;
type Snapshot = SnapshotType;

type QueryContext = Document | Element | DocumentFragment;
type QueryCallback = (element: Element) => boolean | void;

type SeedKey = '#' | '*' | '.';
type GetCandidates = (ctx: QueryContext) => Element[];

type CandidateSeed = {
  key: SeedKey;
  query: string;
  compileQuery: string;
  getCandidates: GetCandidates;
  lambda: SelectLambda;
};

type CandidatePlan = {
  key: SeedKey;
  query: string;
  compileQuery: string;
};

type MatchLambda = (
  element: Element,
  h: HashCache | null,
) => boolean;

type SelectLambda = (
  list: Element[],
  callback: QueryCallback | null,
  context: QueryContext,
  nodes: Element[],
  h: HashCache,
) => Stopped

type Stopped = boolean;

type MatchResolver = {
  lambdas: MatchLambda[];
  usesScope: boolean;
};

type SelectResolver = {
  hasCb: boolean;
  seeds: CandidateSeed[];
  usesScope: boolean;
};

type IndexedNodeList = NodeListOf<Element> & { length: number; [index: number]: Element };
type ElementList = Element[] | IndexedNodeList;

type AttrMatcherParts = { p1: string; p2: string; p3: boolean; };

type SelectorExtension = {
  Expression: RegExp;
  Callback: SelectorExtFn;
};

type SelectorExtFn = (
    match: RegExpMatchArray | null,
    source: string,
    mode: boolean | null,
  ) => {
    match?: RegExpMatchArray | null,
    modvar?: string,
    source: string,
    status: boolean,
  };

type ByTagFn = (tag: string, context?: QueryContext) => ElementList;
type ByTagNsFn = (ns: string | null, local: string, context?: QueryContext) => ElementList;
type ByClassFn = (cls: string, context?: QueryContext) => ElementList;
type ByIdFn = (id: string, context?: QueryContext) => Element | null;
type SelectFn = (selectors: string, context?: QueryContext, callback?: QueryCallback | null) => ElementList;

type FirstFn = (selectors: string, context?: QueryContext) => Element | null;
type MatchFn = (selectors: string, element: Element) => boolean;
type AncestorFn = (selectors: string, element: Element) => Element | null;
type ClosestFn = AncestorFn;

type CombinatorCompiler = (source: string) => string;
type RegisterCombinatorFn = (combinator: string, compiler: CombinatorCompiler) => void;
type RegisterOperatorFn = (operator: string, resolver: AttrMatcherParts) => void;
type RegisterSelectorFn = (name: string, rexp: RegExp, func: SelectorExtFn) => void;

type DomApi = {
  version: string;
  extensions: NwsExtensions;
  config: NwsConfig;
  snapshot: Snapshot;

  byId: ByIdFn;
  byTag: ByTagFn;
  byTagNs: ByTagNsFn;
  byClass: ByClassFn;

  first: FirstFn;
  match: MatchFn;
  select: SelectFn;
  closest: ClosestFn;

  configure: (option?: ConfigKey | Partial<Record<ConfigKey, boolean>> | undefined, clear?: boolean) => boolean | NwsConfig;

  install: (all?: boolean) => void;
  uninstall: () => void;

  registerCombinator: RegisterCombinatorFn;
  registerOperator: RegisterOperatorFn;
  registerSelector: RegisterSelectorFn;

  setDebug: (enabled: boolean) => void;
  clearDebug: () => void;
  printDebug: () => string;
};

type DebugSelect = {
  kind: 'select';
  isApiEntry: boolean;
  selector: string;
  callback?: QueryCallback | null;
  context?: QueryContextDescription;
  build: DebugSelectBuildStep[];
  run: DebugSelectRunStep[];
  error?: string;
};

type DebugSelectRunStep = {
  seedKey: SeedKey;
  seedQuery: string;
  compileQuery: string;
  candidates: string[];
  lambdaSource: string;
  results: string[];
};

type DebugSelectBuildStep = {
  selector: string;
  seedKey: SeedKey;
  seedQuery: string;
  compileQuery: string;
};

type DebugMatch = {
  kind: 'match';
  isApiEntry: boolean;
  element?: QueryContextDescription;
  selector?: string;
  parsed?: string[];
  lambdaSource?: string[];
  result?: boolean;
  error?: string;
};

type QueryContextDescription = {
  kind: 'document' | 'fragment' | 'element' | 'unknown';
  summary: string;
  preview?: string;
}

type QsaKey =
  'closest' | 'matches' | 'querySelector' | 'querySelectorAll' |
  'querySelectorDoc' | 'querySelectorAllDoc';

// --- parsing ---

type CompileSelectorResult = {
  source: string;
  post: string;
  modvar: string[];
};

type SelectorList = {
  kind: 'selector-list';
  source: string;
  selectors: ComplexSelector[];
};

type ComplexSelector = {
  kind: 'complex';
  source: string;
  steps: ComplexStep[];
};

type ComplexStep = {
  kind: 'step';
  combinator: SelectorCombinator | null;
  compound: CompoundSelector;
};

type SelectorCombinator = ' ' | '>' | '+' | '~';

type CompoundSelector = {
  kind: 'compound';
  source: string;
};

type RelativeSelectorList = {
  kind: 'relative-selector-list';
  source: string;
  selectors: RelativeSelector[];
};

type RelativeSelector = {
  kind: 'relative';
  source: string;
  steps: RelativeStep[];
};

type RelativeStep = {
  kind: 'relative-step';
  combinator: SelectorCombinator;
  compound: CompoundSelector;
};

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
