import type { Snapshot } from './nwsapi';

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
type ConfigKey = 'FORGIVING' | 'NODE_LIST' | 'LOGERRORS' | 'USR_EVENT' | 'VERBOSITY';
type NwsExtensions = {
  combinators: string[];
  operators: string[];
}

type QueryContext = Document | Element | DocumentFragment;
type QueryCallback = (element: Element) => boolean | void;

type SeedKey = '#' | '*' | '.';
type GetCandidates = () => Element[];

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
  callback: QueryCallback | null,
  context: null,
  results: false
) => boolean;

type SelectLambda = (
  list: Element[],
  callback: QueryCallback | null,
  context: QueryContext,
  nodes: Element[]
) => Stopped

type Stopped = boolean;

type MatchResolver = {
  lambdas: MatchLambda[];
  callback: QueryCallback | null;
};

type SelectResolver = {
  callback: QueryCallback | null;
  context: QueryContext;
  seeds: CandidateSeed[];
};

type IndexedNodeList = NodeListOf<Element> & { length: number; [index: number]: Element };
type ToNodeListFn = (nodeArray: Element[]) => IndexedNodeList;
type ElementList = Element[] | IndexedNodeList;

type AttrMatcherParts = { p1: string; p2: string; p3: string; };

type SelectorExtension = {
  Expression: RegExp;
  Callback: SelectorExtFn;
};

type SelectorExtFn = (
    match: RegExpMatchArray | null,
    source: string,
    mode: boolean | null,
    callback: QueryCallback | null
  ) => {
    match?: RegExpMatchArray | null,
    modvar?: string,
    source: string,
    status: boolean,
  };

type RawByTagFn = (tag: string, context: QueryContext) => Element[];
type RawByClassFn = (cls: string, context: QueryContext) => Element[];
type RawByIdFn = (id: string, context: QueryContext) => Element[];
type RawSelectFn = (selectors: string, context: QueryContext, callback: QueryCallback | null, snap: Snapshot) => Element[];
type RawFirstFn = (selectors: string, context: QueryContext, callback: QueryCallback | null, snap: Snapshot) => Element | null;
type RawMatchFn = (selectors: string, element: Element, callback: QueryCallback | null, snap: Snapshot) => boolean;
type RawAncestorFn = (selectors: string, element: Element, callback: QueryCallback | null, snap: Snapshot) => Element | null;

type ByTagFn = (tag: string, context?: QueryContext) => ElementList;
type ByClassFn = (cls: string, context?: QueryContext) => ElementList;
type ByIdFn = (id: string, context?: QueryContext) => Element | null;
type SelectFn = (selectors: string, context?: QueryContext, callback?: QueryCallback | null) => ElementList;

type FirstFn = (selectors: string, context?: QueryContext, callback?: QueryCallback | null) => Element | null;
type MatchFn = (selectors: string, element: Element, callback?: QueryCallback | null) => boolean;
type AncestorFn = (selectors: string, element: Element, callback?: QueryCallback | null) => Element | null;
type ClosestFn = AncestorFn;
type NthFn = (element: Element, dir: boolean | 2) => number;
type IsFocusableFn = (node: HTMLElement) => false | HTMLElement;
type IsContentEditableFn = (node: HTMLElement) => boolean;
type HasAttributeFn = (element: Element, ns: string | null, local: string) => boolean;
type GetAttributeFn = (element: Element, ns: string | null, local: string) => string | null;

type CompileFn = (selector: string, mode: boolean | null, cb: QueryCallback | null, snap: Snapshot) => SelectLambda | MatchLambda;
type CombinatorCompiler = (source: string) => string;
type RegisterCombinatorFn = (combinator: string, compiler: CombinatorCompiler) => void;
type RegisterOperatorFn = (operator: string, resolver: AttrMatcherParts) => void;
type RegisterSelectorFn = (name: string, rexp: RegExp, func: SelectorExtFn) => void;

type SelectLambdaEntry = { fn: SelectLambda; hasCallback: boolean; };
type MatchLambdaEntry = { fn: MatchLambda; hasCallback: boolean; };

type CssEscapeFn = (ident: string) => string;

type DomApi = {
  version: string;
  extensions: NwsExtensions;
  config: NwsConfig;
  snapshot: Snapshot;

  byId: ByIdFn;
  byTag: ByTagFn;
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
  callback?: QueryCallback | null;
  context?: QueryContextDescription;
  build?: DebugSelectBuildStep[];
  run?: DebugSelectRunStep[];
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
  callback?: QueryCallback | null;
  element?: QueryContextDescription;
  selector?: string;
  scopedSelector?: string;
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

type NodeLike = { nodeType: number; nodeName: string; };

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

} // end global declaration

