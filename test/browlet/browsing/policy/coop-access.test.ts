import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { createDocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import { Navigable } from '../../../../src/browlet/browsing/navigation/navigable';
import { OpenerPolicy } from '../../../../src/browlet/browsing/policy/coop';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import { CrossOriginObjectBinding } from '../../../../src/browlet/integration/web-idl/bindings/cross-origin';
import { createOpaqueOrigin, obtainURLOrigin, parseHost, parseURL, type Origin } from '../../../../src/url/index';
import { getBindingContext, unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('COOP access-report eligibility', () => {
  it.each([
    'document', 'fetch', 'then', '00', '-0', '0.0', '4294967295',
    Symbol.toStringTag, Symbol.hasInstance, Symbol.isConcatSpreadable, Symbol('self'),
  ])('ignores the non-reportable property %s before consulting context state', (property) => {
    const { binding, reports } = createPair();
    binding.checkAccessShouldBeReported(new BrowsingContext(), new BrowsingContext(), property);
    expect(reports).not.toHaveBeenCalled();
  });

  it.each([
    'window', 'self', 'location', 'close', 'closed', 'frames', 'length',
    'top', 'opener', 'parent', 'postMessage', '0', '4294967294',
  ])('forwards the declared cross-origin name or array index %s', (property) => {
    const { accessor, accessed, binding, reports } = createPair();
    binding.checkAccessShouldBeReported(accessor.context, accessed.context, property);
    expect(reports).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      relationship: 'none', propertyName: property,
      accessorInitialURL: null, accessedInitialURL: null,
      accessorCreatorOrigin: null, accessedCreatorOrigin: null,
    }), accessor.document.env);
  });

  it.each(['accessor', 'accessed'] as const)('requires the %s document to be fully active', (side) => {
    const pair = createPair();
    pair[side].document.browsingContext = null;
    expect(() => pair.binding.checkAccessShouldBeReported(pair.accessor.context, pair.accessed.context, 'self'))
      .toThrow('COOP access reporting requires fully active documents');
    expect(pair.reports).not.toHaveBeenCalled();
  });

  it('compares top-level virtual groups rather than child or physical group identities', () => {
    const { accessor, accessed, binding, reports } = createPair();
    const first = createChild(accessor);
    const second = createChild(accessed);
    first.context.virtualBrowsingContextGroupID = 30;
    second.context.virtualBrowsingContextGroupID = 40;
    accessed.context.virtualBrowsingContextGroupID = accessor.context.virtualBrowsingContextGroupID;
    expect(accessor.context.group).not.toBe(accessed.context.group);

    binding.checkAccessShouldBeReported(first.context, second.context, 'closed');
    expect(reports).not.toHaveBeenCalled();

    accessed.context.virtualBrowsingContextGroupID++;
    first.context.virtualBrowsingContextGroupID = second.context.virtualBrowsingContextGroupID;
    binding.checkAccessShouldBeReported(first.context, second.context, 'closed');
    expect(reports).toHaveBeenCalledOnce();
  });

  it.each(['accessor', 'accessed'] as const)('rejects a cross-origin intermediate ancestor on the %s side', (side) => {
    const pair = createPair();
    const top = pair[side];
    const middle = createChild(top, createOpaqueOrigin());
    const leaf = createChild(middle, top.document.origin);
    const accessor = side === 'accessor' ? leaf : pair.accessor;
    const accessed = side === 'accessed' ? leaf : pair.accessed;

    pair.binding.checkAccessShouldBeReported(accessor.context, accessed.context, 'self');
    expect(pair.reports).not.toHaveBeenCalled();

    // Consult the active origin at access time, not initialized ancestor-origin snapshots.
    middle.document.origin = top.document.origin;
    pair.binding.checkAccessShouldBeReported(accessor.context, accessed.context, 'self');
    expect(pair.reports).toHaveBeenCalledOnce();
  });

  it('uses exact origin equality even when ancestor documents have relaxed their domain', () => {
    const { accessor, accessed, binding, reports } = createPair();
    const topOrigin = obtainURLOrigin(parseURL('https://a.example.test/').url!);
    const childOrigin = obtainURLOrigin(parseURL('https://b.example.test/').url!);
    if (topOrigin.kind !== 'tuple' || childOrigin.kind !== 'tuple') throw new Error('Expected tuple origins');
    topOrigin.domain = childOrigin.domain = parseHost('example.test').host!;
    accessor.document.origin = topOrigin;
    const child = createChild(accessor, childOrigin);

    binding.checkAccessShouldBeReported(child.context, accessed.context, 'self');
    expect(reports).not.toHaveBeenCalled();
  });
});

describe('COOP access-report inputs', () => {
  it.each(['accessor-is-opener', 'accessor-is-openee', 'none'] as const)('classifies %s through inclusive ancestors', (relationship) => {
    const { accessor, accessed, binding, reports } = createPair();
    const first = createChild(accessor);
    const second = createChild(accessed);
    if (relationship === 'accessor-is-opener') accessed.context.openerBrowsingContext = accessor.context;
    if (relationship === 'accessor-is-openee') accessor.context.openerBrowsingContext = accessed.context;
    if (relationship === 'none') {
      const unrelated = createWindow();
      accessed.context.openerBrowsingContext = unrelated.context;
      accessor.context.openerBrowsingContext = unrelated.context;
    }

    binding.checkAccessShouldBeReported(first.context, second.context, 'postMessage');
    expect(reports.mock.calls[0]![0].relationship).toBe(relationship);
  });

  it('recognizes an opener that is the participating child context itself', () => {
    const { accessor, accessed, binding, reports } = createPair();
    const first = createChild(accessor);
    accessed.context.openerBrowsingContext = first.context;

    binding.checkAccessShouldBeReported(first.context, accessed.context, 'self');
    expect(reports.mock.calls[0]![0].relationship).toBe('accessor-is-opener');
  });

  it('retains leaf URLs and origins, top-level policy state, and the invoking binding environment', () => {
    const { accessor, accessed, reports } = createPair();
    const first = createChild(accessor);
    const second = createChild(accessed);
    const binding = new CrossOriginObjectBinding(getBindingContext(first.document.env.realm));
    accessor.document.openerPolicy.reportOnlyValue = 'same-origin';
    accessed.document.openerPolicy.reportOnlyValue = 'same-origin-plus-COEP';
    accessor.document.referrer = 'https://referrer.test/first';
    accessed.document.referrer = 'https://referrer.test/second';
    accessor.context.initialURL = parseURL('https://initial.test/first').url!;
    accessed.context.initialURL = parseURL('https://initial.test/second').url!;
    accessor.context.openerOriginAtCreation = createOpaqueOrigin();
    accessed.context.openerOriginAtCreation = createOpaqueOrigin();
    first.document.url = parseURL('https://user:pass@first.test/frame#fragment').url!;
    second.document.url = parseURL('https://second.test/frame#fragment').url!;

    binding.checkAccessShouldBeReported(first.context, second.context, 'location');

    expect(reports).toHaveBeenCalledExactlyOnceWith({
      relationship: 'none',
      accessorCOOP: accessor.document.openerPolicy,
      accessedCOOP: accessed.document.openerPolicy,
      accessorURL: first.document.url,
      accessedURL: second.document.url,
      accessorInitialURL: accessor.context.initialURL,
      accessedInitialURL: accessed.context.initialURL,
      accessorOrigin: first.document.origin,
      accessedOrigin: second.document.origin,
      accessorCreatorOrigin: accessor.context.openerOriginAtCreation,
      accessedCreatorOrigin: accessed.context.openerOriginAtCreation,
      accessorReferrer: accessor.document.referrer,
      accessedReferrer: accessed.document.referrer,
      propertyName: 'location',
    }, first.document.env);
  });
});

function createPair() {
  const accessor = createWindow();
  const accessed = createWindow();
  accessor.context.virtualBrowsingContextGroupID = 1;
  accessed.context.virtualBrowsingContextGroupID = 2;
  const binding = new CrossOriginObjectBinding(getBindingContext(accessor.document.env.realm));
  // Capture the dispatcher boundary; report bodies and delivery are outside this slice.
  const reports = vi.spyOn(OpenerPolicy, 'queueAccessReports').mockImplementation(() => {});
  return { accessor, accessed, binding, reports };
}

function createWindow(): { document: DocumentImpl; context: BrowsingContext; } {
  const browser = new Browlet({ route: () => '' });
  const document = unwrap<DocumentImpl>(browser.document);
  return { document, context: document.browsingContext! };
}

function createChild(parent: ReturnType<typeof createWindow>, origin: Origin = parent.document.origin) {
  const container = parent.document.createElement('iframe') as HTMLIFrameElementImpl;
  const [context, document] = BrowsingContext.createTopLevel(parent.document.env.userAgent);
  document.origin = origin;
  const navigable = new Navigable(createDocumentState(document), parent.document.getNodeNavigable());
  // Child creation is unfinished; connect actual implementations at the retained association.
  container.contentNavigable = navigable;
  parent.document.body!.appendChild(container);
  return { context, document };
}
