import { describe, expect, test } from 'vitest';
import type {
  QuerySourceRef, Expectation, RunScenariosOptions, Scenario, ScenariosStatus,
  ScenarioStep, TestCase,
} from '../harness';
import { Browlet } from '../../../src/browlet/browlet';
import { isElement } from '../../selectlet/util';
import { createSelectlet, type Selectlet as SelectletAPI } from '../../../src/selectlet/selectlet';

type Selectlet = SelectletAPI<Node, Element, Document, DocumentFragment>;

const STACK_TRACE = false;
const ONLY = process.env.ONLY;

export function runScenarios(
  label: string,
  status: ScenariosStatus,
  scenarios: Scenario[],
  _options: RunScenariosOptions = {},
): void {
  const describeFn = getDescribeFn(status);
  const hasAnyOnly = scenarios.some((scenario) => scenarioHas(scenario, 'only'));
  const respectOnly = !!ONLY || hasAnyOnly;

  if (ONLY && !hasAnyOnly) {
    test.skip(`browlet/${label} [!ONLY]`, () => {});
    return;
  }

  describeFn(`browlet/${label}`, () => {
    for (const scenario of scenarios) {
      const hasOnly = scenarioHas(scenario, 'only');
      if (respectOnly && !hasOnly) continue;

      const skipReason = getScenarioSkipReason(scenario);
      const testFn = skipReason ? test.skip : getTestFn(scenario.status);
      const name = skipReason ? `${scenario.name} [${skipReason}]` : scenario.name;

      testFn(name, () => runScenario(scenario), scenario.timeout);
    }
  });
}

async function runScenario(scenario: Scenario): Promise<void> {
  if (scenario.steps?.length && scenario.cases?.length) {
    throw new Error(`${scenario.name}: use either steps or top-level cases, not both`);
  }

  const steps: ScenarioStep[] = scenario.steps ?? (
    scenario.cases?.length ? [{ cases: scenario.cases }] : []
  );
  const hasOnlyCases = steps.some(
    (step) => step.cases.some((testCase) => testCase.status === 'only'),
  );
  const source = scenario.markupMode === 'html-document'
    ? scenario.markup
    : `<!doctype html><html><body>${scenario.markup}</body></html>`;
  const browlet = new Browlet({ route: () => source });
  await browlet.navigate(scenario.url ?? 'https://example.test/');
  const document = browlet.document;
  const selectlet = createSelectlet(document);

  for (const [stepIndex, step] of steps.entries()) {
    for (const [caseIndex, testCase] of step.cases.entries()) {
      if (hasOnlyCases && testCase.status !== 'only') continue;
      if (shouldSkipCase(testCase)) continue;

      const info: CaseInfo = {
        scenario,
        testCase,
        stepIndex,
        caseIndex,
      };

      try {
        runCase(document, selectlet, testCase);
      } catch (error) {
        throw new Error(
          `${formatCaseHeader(info)}\n${thrownMessage(error, STACK_TRACE)}`,
        );
      }
    }
  }
}

function runCase(
  document: Document,
  selectlet: Selectlet,
  testCase: TestCase,
): void {
  let threw = false;
  let nodes: Element[] = [];
  let thrown: unknown;

  try {
    const source = resolveQuerySource(document, selectlet, caseRef(testCase));
    if (!source) throw new Error('No query source provided');

    if ('select' in testCase) {
      nodes = [...selectlet.select(testCase.select, source)];
    } else if ('first' in testCase) {
      const element = selectlet.first(testCase.first, source);
      nodes = element ? [element] : [];
    } else if ('byTag' in testCase) {
      nodes = [...selectlet.byTag(testCase.byTag, source)];
    } else if ('byTagNs' in testCase) {
      nodes = [...selectlet.byTagNs(
        testCase.byTagNs.ns,
        testCase.byTagNs.local,
        source,
      )];
    } else if ('byClass' in testCase) {
      nodes = [...selectlet.byClass(testCase.byClass, source)];
    } else if ('byId' in testCase) {
      const element = selectlet.byId(testCase.byId, source);
      nodes = element ? [element] : [];
    } else if ('match' in testCase) {
      if (!isElement(source)) {
        throw new Error(`Query source for 'match' case must be an Element`);
      }
      nodes = selectlet.matches(testCase.match, source)
        ? [source]
        : [];
    } else if ('closest' in testCase) {
      if (!isElement(source)) {
        throw new Error(`Query source for 'closest' case must be an Element`);
      }
      const element = selectlet.closest(testCase.closest, source);
      nodes = element ? [element] : [];
    } else {
      throw new Error('Browlet harness does not support this case');
    }
  } catch (error) {
    threw = true;
    thrown = error;
  }

  assertExpectation(caseQuery(testCase), nodes, threw, testCase.expect, thrown);
}

type QuerySource = Document | Element;

function resolveQuerySource(
  document: Document,
  selectlet: Selectlet,
  ref?: QuerySourceRef,
): QuerySource | null {
  if (!ref || ref.by === 'document') return document;

  const base = 'within' in ref && ref.within
    ? resolveQuerySource(document, selectlet, ref.within)
    : document;
  if (!base) return null;

  if (ref.by === 'id') {
    return selectlet.byId(ref.id, base);
  }

  if (ref.by === 'first') {
    return selectlet.first(ref.selector, base);
  }

  if (ref.by === 'documentElement') {
    return document.documentElement;
  }
  return null;
}

function assertExpectation(
  label: string,
  nodes: Element[],
  threw: boolean,
  expectation: Expectation | undefined,
  thrownError: unknown,
): void {
  if (threw) {
    if (expectation?.throws) return;
    throw new Error(`Unexpected error for ${label}: ${thrownMessage(thrownError, STACK_TRACE)}`);
  }

  if (expectation?.throws) {
    throw new Error(`Expected throw for ${label}, but no error was thrown`);
  }

  const ids = nodes.map((element) => element.getAttribute('id') ?? '');
  const classNames = nodes.map((element) => element.getAttribute('class') ?? '');
  const classTokens = classNames.flatMap(splitOnAsciiWhitespace);

  if (expectation?.count !== undefined) {
    expect(nodes.length, `count for ${label}`).toBe(expectation.count);
  }
  if (expectation?.ids !== undefined) {
    expect(ids, `ids for ${label}`).toEqual(expectation.ids);
  }
  if (expectation?.includesIds !== undefined) {
    expect(ids, `includesIds for ${label}`).toEqual(
      expect.arrayContaining(expectation.includesIds),
    );
  }
  if (expectation?.excludesIds !== undefined) {
    for (const id of expectation.excludesIds) {
      expect(ids, `excludesIds for ${label}`).not.toContain(id);
    }
  }
  if (expectation?.classes !== undefined) {
    expect(classNames, `classes for ${label}`).toEqual(expectation.classes);
  }
  if (expectation?.includesClasses !== undefined) {
    expect(classTokens, `includesClasses for ${label}`).toEqual(
      expect.arrayContaining(expectation.includesClasses),
    );
  }
  if (expectation?.excludesClasses !== undefined) {
    for (const className of expectation.excludesClasses) {
      expect(classTokens, `excludesClasses for ${label}`).not.toContain(className);
    }
  }
}

function getDescribeFn(status: ScenariosStatus) {
  if (status === 'skip') return describe.skip;
  if (status === 'only') return describe.only;
  return describe;
}

function getTestFn(status: Scenario['status']) {
  if (status === 'skip' || status === 'fixme' || status === 'fail') return test.skip;
  if (status === 'only') return test.only;
  return test;
}

function getScenarioSkipReason(scenario: Scenario): string | null {
  if (scenario.status === 'skip') return 'scenario marked skip';
  if (scenario.status === 'fixme') return 'scenario marked fixme';
  if (scenario.status === 'fail') return 'scenario marked fail';
  if (scenario.browsers?.length) return 'browser-specific scenario';
  if (scenario.engines?.length) return 'engine-specific scenario';
  if (scenario.markupMode === 'xml-document') return 'XML documents are unsupported';
  if (/<template[\s>]/i.test(scenario.markup)) {
    return 'template contents and document fragments are unsupported';
  }
  if (scenario.setupPage || scenario.steps?.some((step) => step.setupPage)) {
    return 'page setup is unsupported';
  }
  return null;
}

function shouldSkipCase(testCase: TestCase): boolean {
  if (
    testCase.status === 'skip' ||
    testCase.status === 'fixme' ||
    testCase.status === 'fail' ||
    testCase.browsers?.length ||
    testCase.engines?.length
  ) {
    return true;
  }

  if ('computedStyle' in testCase || 'cssom' in testCase || 'supports' in testCase) {
    return true;
  }

  const ref = caseRef(testCase);
  return !!ref && !supportsQuerySourceRef(ref);
}

function supportsQuerySourceRef(ref: QuerySourceRef): boolean {
  if ('home' in ref && ref.home && ref.home !== 'document') return false;
  if ('within' in ref && ref.within && !supportsQuerySourceRef(ref.within)) return false;
  return ref.by === 'document' || ref.by === 'id' ||
    ref.by === 'first' || ref.by === 'documentElement';
}

function scenarioHas(scenario: Scenario, status: 'only' | 'fixme'): boolean {
  return scenario.status === status ||
    !!scenario.cases?.some((testCase) => testCase.status === status) ||
    !!scenario.steps?.some(
      (step) => step.cases.some((testCase) => testCase.status === status),
    );
}

type CaseInfo = {
  scenario: Scenario;
  testCase: TestCase;
  stepIndex: number;
  caseIndex: number;
};

function formatCaseHeader(info: CaseInfo): string {
  return [
    info.scenario.name,
    `Step #${info.stepIndex + 1}, Case #${info.caseIndex + 1}`,
    `Query: ${caseQuery(info.testCase)}`,
    `Query source: ${refLabel(caseRef(info.testCase))}`,
  ].join('\n');
}

function caseQuery(testCase: TestCase): string {
  if ('select' in testCase) return testCase.select;
  if ('first' in testCase) return testCase.first;
  if ('match' in testCase) return testCase.match;
  if ('closest' in testCase) return testCase.closest;
  if ('byId' in testCase) return `byId(${testCase.byId})`;
  if ('byTag' in testCase) return `byTag(${testCase.byTag})`;
  if ('byClass' in testCase) return `byClass(${testCase.byClass})`;
  if ('byTagNs' in testCase) {
    return `byTagNs(${testCase.byTagNs.ns}, ${testCase.byTagNs.local})`;
  }
  return '<unsupported case>';
}

function caseRef(testCase: TestCase): QuerySourceRef | undefined {
  return 'ref' in testCase ? testCase.ref : undefined;
}

function refLabel(ref: QuerySourceRef | undefined): string {
  if (!ref || ref.by === 'document') return 'document';
  if (ref.by === 'id') return `#${ref.id}`;
  if (ref.by === 'first') return `first(${ref.selector})`;
  if (ref.by === 'documentElement') return 'documentElement';
  if (ref.by === 'iframe') return `iframe#${ref.id}`;
  if (ref.by === 'template') return `template#${ref.id}`;
  return `shadowRoot#${ref.id}`;
}

function thrownMessage(error: unknown, stackTrace: boolean): string {
  if (!stackTrace) {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
  return String(error);
}

function splitOnAsciiWhitespace(value: string): string[] {
  return value.match(/[^\t\n\f\r ]+/g) ?? [];
}
