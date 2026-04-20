interface AmdDefine {
  (factory: unknown): void;
  (deps: string[], factory: unknown): void;
  amd?: unknown;
}

declare var define: AmdDefine | undefined;

declare var NW: {
  Dom?: unknown;
  [key: string]: unknown;
} | undefined;

type NwsGlobal = typeof globalThis

type ConfigKey = 'IDS_DUPES' | 'FORGIVING' | 'NODE_LIST' | 'LOGERRORS' | 'USR_EVENT' | 'VERBOSITY';

type QueryContext = Document | Element | DocumentFragment;
type QueryCallback = (element: Element) => unknown;

type FakeNodeList = NodeListOf<Element> & { length: number; [index: number]: Element };

type OptimizerCompatKey = '#' | '*' | '.';
type CompatKey = '#' | '*' | '|' | '.';
type CompatThunk = () => Element[];
type CompatFactory = (c: QueryContext, n: string) => CompatThunk;
type CompatSeed = `${CompatKey}${string}`;

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
) => Element[];

type MatchResolver = {
  factory: MatchLambda[];
};

type SelectResolver = {
  callback: QueryCallback | null;
  context: QueryContext;
  factory: Array<SelectLambda | null>;
  htmlset: CompatThunk[];
  nodeset: CompatSeed[];
  results: Element[];
};

type toNodeListFn = (nodeArray: Element[]) => Element[] | NodeListOf<Element>;

type AttrMatcherParts = { p1: string; p2: string; p3: string; };

type SelectorExtension = {
  Expression: RegExp;
  Callback: SelectorExtFn;
};

type SelectorExtFn = (
    match: string[],
    source: string,
    mode: boolean | null,
    callback: QueryCallback | null
  ) => {
    match: string[] | null,
    modvar: string,
    source: string,
    status: boolean,
  }

