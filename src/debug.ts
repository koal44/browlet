import { type ComplexSelector } from "./parser/parser";
import { isDocument, isDocumentFragment, isElement } from "./utils/dom";

function previewText(s: string, max = 240): string {
  s = s.replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : s.slice(0, max) + '…';
}

export function describeElement(el: Element | null | undefined): string {
  if (!el) return '(missing)';
  const id = el.getAttribute('id');
  const cls = el.getAttribute('class');
  return `<${el.tagName.toLowerCase()}${id ? ` id='${id}'` : ''}${cls ? ` class='${cls}'` : ''}>`;
}

function describeElements(els: Element[], max = 10): string[] {
  const out = els.slice(0, max).map(describeElement);
  if (els.length > max) out.push(`… (${els.length - max} more)`);
  return out;
}

export function describeContext(ctx: QueryContext): QueryContextDescription {
  if (isDocument(ctx)) {
    const root = ctx.documentElement;
    const body = ctx.body;
    return {
      kind: 'document',
      summary: '#document',
      preview: previewText(body?.outerHTML || root?.outerHTML || ''),
    };
  }

  if (isDocumentFragment(ctx)) {
    const children = Array.from(ctx.childNodes)
      .map((n) => {
        if (isElement(n)) return n.outerHTML;
        if (n.nodeType === Node.TEXT_NODE) return n.textContent ?? '';
        return '';
      }).join('');
    return {
      kind: 'fragment',
      summary: '#document-fragment',
      preview: previewText(children),
    };
  }

  if (isElement(ctx)) {
    return {
      kind: 'element',
      summary: describeElement(ctx),
      preview: previewText(ctx.outerHTML),
    };
  }

  return {
    kind: 'unknown',
    summary: '(unknown context)',
  };
}

export function initDebugMatch(snap: Snapshot, selectors: string, element: Element, isApiEntry: boolean): void {
  snap.debugStack.length = 0;
  const dbg: DebugMatch = {
    kind: 'match',
    isApiEntry,
    element: describeContext(element),
    selector: selectors,
  };

  snap.debugMatch = dbg;
  snap.debugStack.push(dbg);
}

export function updateDebugMatch(snap: Snapshot, resolver: MatchResolver, result: boolean): void {
  if (snap.debugMatch) {
    snap.debugMatch.lambdaSource = String(resolver.lambda);
    snap.debugMatch.result = result;
  }
}

export function initDebugSelect(snap: Snapshot, sel: string, cb: QueryCallback | null, ctx: QueryContext, isApiEntry: boolean): void {
  if (isApiEntry) snap.debugStack.length = 0;
  const dbgSelect: DebugSelect = {
    kind: 'select',
    isApiEntry,
    selector: sel,
    callback: cb,
    context: describeContext(ctx),
    build: [],
    run: [],
  };
  snap.debugSelect = dbgSelect;
  snap.debugStack.push(dbgSelect);
}

export function updateDebugSelectRun(snap: Snapshot, arm: SelectArm, candidates: Element[], results: Element[]): void {
  snap.debugSelect?.run.push({
    strategy: arm.plan.strategy,
    lookupQuery: arm.plan.lookupQuery,
    candidates: describeElements(candidates),
    matcherSrcText: String(arm.matcher),
    results: describeElements(results),
  });
}

export function updateDebugSelectBuild(snap: Snapshot, complex: ComplexSelector, plan: CandidatePlan, matcher: SelectLambda): void {
  snap.debugSelect?.build.push({
    selector: complex.source,
    hasSeed: complex.hasSeed === true,
    usesScope: complex.usesScope === true,
    strategy: plan.strategy,
    lookupQuery: plan.lookupQuery,
    matcherSrcText: snap.debugCompile ?? matcher.toString(),
  });
  snap.debugCompile = undefined;
}
