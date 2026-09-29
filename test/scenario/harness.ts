import type { Page } from '@playwright/test';
import type { DistributiveOmit } from '../../src/infra/util';

export type SelectCase =  { select: string;  ref?: QuerySourceRef; } & CaseBase;
export type ByIdCase =    { byId: string;    ref?: QuerySourceRef; } & CaseBase;
export type ByTagCase =   { byTag: string;   ref?: QuerySourceRef; } & CaseBase;
export type ByClassCase = { byClass: string; ref?: QuerySourceRef; } & CaseBase;
export type FirstCase =   { first: string;   ref?: QuerySourceRef; } & CaseBase;
export type MatchCase =   { match: string;   ref:  QuerySourceRef; } & CaseBase;
export type ClosestCase = { closest: string; ref:  QuerySourceRef; } & CaseBase;
export type ByTagNsCase = { byTagNs: { ns: string | null; local: string; }; ref?: QuerySourceRef; } & CaseBase;
export type ComputedStyleCase = { computedStyle: string; pseudo?: string; ref: QuerySourceRef; } & CaseBase;
export type CssomCase = { cssom: CssomProbe; ref?: QuerySourceRef; } & CaseBase;
export type SupportsCase = { supports: SupportsProbe; ref?: QuerySourceRef; } & CaseBase;

type CaseBase = {
  expect?: Expectation;
  status?: CaseStatus;
  browsers?: BrowserName[];
  engines?: Engine[];
  debug?: boolean;
};

export type CssomProbe =
  | { target: 'sheet.cssRules'; sheet?: number; }
  | { target: 'sheet.cssRules.item'; sheet?: number; rule: number; }
  | { target: 'rule.style'; sheet?: number; rule: number; }
  | { target: 'style.property'; sheet?: number; rule?: number; name: string; };

export type SupportsProbe =
  | { property: string; value: string; }
  | { condition: string; };

export type TestCase =
  | SelectCase | MatchCase | FirstCase | ClosestCase
  | ByIdCase | ByTagCase | ByClassCase | ByTagNsCase
  | ComputedStyleCase | CssomCase | SupportsCase;

export type Scenario = {
  name: string;
  status?: ScenarioStatus;
  markup: string;
  markupMode?: MarkupMode;
  url?: string;
  browsers?: BrowserName[];
  engines?: Engine[];
  steps?: ScenarioStep[];
  timeout?: number;

  // Playwright-only setup for scenarios that need direct page manipulation.
  setupPage?: (page: Page) => void | Promise<void>;
  cases?: TestCase[];
};

export type MarkupMode = 'html-body' | 'html-document' | 'xml-document';

export type ScenarioStep = {
  setupPage?: (page: Page) => void | Promise<void>;
  cases: TestCase[];
};

export type Expectation = {
  count?: number;
  ids?: string[];
  includesIds?: string[];
  excludesIds?: string[];
  classes?: string[];
  includesClasses?: string[];
  excludesClasses?: string[];
  throws?: boolean;
  equivalentCase?: EquivalentCase;
  value?: string;
  cssom?: unknown[] | Record<string, unknown> | null;
  supported?: boolean;
};

export type EquivalentCase = DistributiveOmit<
  TestCase,
  'expect' | 'status' | 'browsers' | 'engines'
>;

export const BROWSER_NAMES = ['chromium', 'firefox', 'webkit'] as const;
export type BrowserName = typeof BROWSER_NAMES[number];

export type ScenariosStatus = 'normal' | 'skip' | 'only';
export type ScenarioStatus = 'normal' | 'skip' | 'only' | 'fixme' | 'fail';
export type CaseStatus = 'normal' | 'skip' | 'fixme' | 'fail' | 'only';

export const ENGINES = ['native', 'selectlet'] as const;
export type Engine = typeof ENGINES[number];

export type QuerySourceRef =
  | { by: 'document'; }
  | { by: 'id'; id: string; home?: QuerySourceHome; within?: QuerySourceRef; }
  | { by: 'first'; selector: string; home?: QuerySourceHome; within?: QuerySourceRef; }
  | { by: 'documentElement'; home?: QuerySourceHome; }
  | { by: 'iframe'; id: string; within?: QuerySourceRef; }
  | { by: 'template'; id: string; within?: QuerySourceRef; }
  | { by: 'shadowRoot'; id: string; within?: QuerySourceRef; };

export type QuerySourceHome = 'document' | 'detached' | 'fragment';

export type RunScenariosOptions = {
  parallel?: boolean;
};

export type RunScenarios = (
  label: string,
  status: ScenariosStatus,
  scenarios: Scenario[],
  options?: RunScenariosOptions,
) => void;
