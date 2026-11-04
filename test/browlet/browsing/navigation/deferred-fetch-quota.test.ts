import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable } from '../../../../src/browlet/browsing/navigation/navigable';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import { PermissionsPolicy } from '../../../../src/browlet/browsing/policy/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import { DeferredFetchQuota, FetchRequest, FetchResponse } from '../../../../src/fetch/index';
import { obtainURLOrigin, parseURL } from '../../../../src/url/index';
import { unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('deferred fetch quota ownership', () => {
  it('shares only contiguous same-origin Documents and ignores document.domain relaxation', async () => {
    const { document } = await fixture();
    const same = child(document, 'https://a.example.test/child');
    const foreign = child(same.document, 'https://b.example.test/child');
    const nested = child(foreign.document, 'https://a.example.test/nested');
    expect(same.document.getDeferredFetchControlDocument()).toBe(document);
    expect(foreign.document.getDeferredFetchControlDocument()).toBe(foreign.document);
    expect(nested.document.getDeferredFetchControlDocument()).toBe(nested.document);
    for (const item of [document, same.document, foreign.document, nested.document]) {
      if (item.origin.kind === 'tuple') item.origin.domain = { kind: 'domain', value: 'example.test' };
    }
    expect(foreign.document.getDeferredFetchControlDocument()).toBe(foreign.document);
    expect(nested.document.getDeferredFetchControlDocument()).toBe(nested.document);
  });

  it('requires an active Document for quota queries', async () => {
    const { document } = await fixture();
    const inactive = document.env.createDocument();
    expect(() => inactive.getDeferredFetchControlDocument()).toThrow('Deferred fetch quota requires an active Document');
  });

  it('starts all four container types with zero reservation, without allocating it on ordinary elements', async () => {
    const { document } = await fixture();
    for (const name of ['iframe', 'object', 'embed', 'frame']) {
      const element = document.createElement(name);
      expect(element.isNavigableContainer()).toBe(true);
      if (element.isNavigableContainer()) expect(element.reservedDeferredFetchQuota).toBe(0);
    }
    expect(document.createElement('div')).not.toHaveProperty('reservedDeferredFetchQuota');
  });
});

describe('deferred fetch available quota', () => {
  it.each([
    { policy: '', used: 512 * 1024 - 11, remaining: 11 },
    { policy: 'deferred-fetch-minimal=()', used: 640 * 1024 - 13, remaining: 13 },
    { policy: 'deferred-fetch=()', used: 0, remaining: 0 },
  ])('applies the top-level pool: $policy', async ({ policy, used, remaining }) => {
    const { document } = await fixture();
    setPolicy(document, policy);
    if (used > 0) pending(document, used, 'https://other.test/');
    expect(document.getAvailableDeferredFetchQuota(null)).toBe(remaining);
  });

  it('charges only pending requests across shared Documents and caps each request origin independently', async () => {
    const { document } = await fixture();
    const same = child(document, 'https://a.example.test/child');
    const origin = obtainURLOrigin(parseURL('https://collect.test/').url!);
    pending(document, 20000, 'https://collect.test/');
    pending(same.document, 30000, 'https://collect.test/');
    pending(same.document, 40000, 'https://other.test/');
    const sent = pending(document, 10000, 'https://collect.test/');
    sent.invokeState = 'sent';
    const aborted = pending(document, 10000, 'https://collect.test/');
    aborted.invokeState = 'aborted';
    expect(document.getAvailableDeferredFetchQuota(origin)).toBe(65536 - 50000);
    expect(same.document.getAvailableDeferredFetchQuota(origin)).toBe(65536 - 50000);
    expect(document.getAvailableDeferredFetchQuota(null)).toBe(65536);
  });

  it('counts shadow-tree container reservations once and excludes foreign Documents\' requests', async () => {
    const { document } = await fixture();
    const host = document.createElement('div');
    document.body!.appendChild(host);
    const shadow = host.attachShadow({ mode: 'closed', delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false });
    const frame = document.createElement('iframe') as HTMLIFrameElementImpl;
    shadow.appendChild(frame);
    frame.reservedDeferredFetchQuota = DeferredFetchQuota.Normal;
    const foreign = child(document, 'https://foreign.test/');
    foreign.frame.reservedDeferredFetchQuota = DeferredFetchQuota.Minimal;
    pending(foreign.document, 8000, 'https://collect.test/');
    pending(document, 512 * 1024 - 65536 - 8192 - 7, 'https://other.test/');
    expect(document.getAvailableDeferredFetchQuota(null)).toBe(7);
    expect(foreign.document.getAvailableDeferredFetchQuota(null)).toBe(192);
  });

  it.each([
    [DeferredFetchQuota.None, '', 0],
    [DeferredFetchQuota.Minimal, '', 8192],
    [DeferredFetchQuota.Minimal, "deferred-fetch-minimal 'none'", 0],
    [DeferredFetchQuota.Normal, 'deferred-fetch *', 65536],
    [DeferredFetchQuota.Normal, '', 0],
  ])('applies child reservation %s and policy %s', async (quota, allow, expected) => {
    const { document } = await fixture();
    const nested = child(document, 'https://foreign.test/', allow);
    nested.frame.reservedDeferredFetchQuota = quota;
    expect(nested.document.getAvailableDeferredFetchQuota(null)).toBe(expected);
  });

  it('returns zero when reservations and requests exhaust the shared pool', async () => {
    const { document } = await fixture();
    pending(document, 512 * 1024 + 1, 'https://other.test/');
    expect(document.getAvailableDeferredFetchQuota(null)).toBe(0);
  });
});

describe('container quota reservation', () => {
  it('resets a previous reservation before checking capacity and respects denied inheritance', async () => {
    const { document } = await fixture();
    const nested = child(document, 'https://foreign.test/', 'deferred-fetch *');
    nested.frame.reservedDeferredFetchQuota = DeferredFetchQuota.Normal;
    pending(document, 512 * 1024 - 65536, 'https://other.test/');
    nested.frame.reserveDeferredFetchQuota(nested.document.origin);
    expect(nested.frame.reservedDeferredFetchQuota).toBe(65536);
    setPolicy(document, 'deferred-fetch=(), deferred-fetch-minimal=()');
    nested.frame.reserveDeferredFetchQuota(nested.document.origin);
    expect(nested.frame.reservedDeferredFetchQuota).toBe(0);
  });

  it('falls back to the separate minimal pool when normal capacity is unavailable', async () => {
    const { document } = await fixture();
    const nested = child(document, 'https://foreign.test/', 'deferred-fetch *');
    pending(document, 512 * 1024 - 65536 + 1, 'https://other.test/');
    nested.frame.reserveDeferredFetchQuota(nested.document.origin);
    expect(nested.frame.reservedDeferredFetchQuota).toBe(8192);
  });

  it('reserves from shared capacity without charging the navigation destination as a request origin', async () => {
    const { document } = await fixture();
    const nested = child(document, 'https://foreign.test/', 'deferred-fetch *');
    pending(document, 65536, 'https://foreign.test/');
    expect(document.getAvailableDeferredFetchQuota(nested.document.origin)).toBe(0);
    nested.frame.reserveDeferredFetchQuota(nested.document.origin);
    expect(nested.frame.reservedDeferredFetchQuota).toBe(65536);
  });

  it('does not overcommit normal quota across repeated child reservations', async () => {
    const { document } = await fixture();
    const frames = Array.from({ length: 9 }, () => child(document, 'https://foreign.test/', 'deferred-fetch *'));
    for (const nested of frames) nested.frame.reserveDeferredFetchQuota(nested.document.origin);
    expect(frames.slice(0, 8).map(({ frame }) => frame.reservedDeferredFetchQuota)).toEqual(Array(8).fill(65536));
    expect(frames[8]!.frame.reservedDeferredFetchQuota).toBe(8192);
  });

  it('limits minimal reservations to sixteen descendant navigables', async () => {
    const { document } = await fixture();
    const frames = Array.from({ length: 17 }, () => child(document, 'https://foreign.test/'));
    for (const nested of frames) nested.frame.reserveDeferredFetchQuota(nested.document.origin);
    expect(frames.slice(0, 16).map(({ frame }) => frame.reservedDeferredFetchQuota)).toEqual(Array(16).fill(8192));
    expect(frames[16]!.frame.reservedDeferredFetchQuota).toBe(0);
    frames[0]!.frame.reservedDeferredFetchQuota = DeferredFetchQuota.None;
    frames[16]!.frame.reserveDeferredFetchQuota(frames[16]!.document.origin);
    expect(frames[16]!.frame.reservedDeferredFetchQuota).toBe(8192);
  });

  it('does not delegate minimal quota from a foreign control Document', async () => {
    const { document } = await fixture();
    const foreign = child(document, 'https://foreign.test/');
    foreign.frame.reservedDeferredFetchQuota = DeferredFetchQuota.Minimal;
    const nested = child(foreign.document, 'https://another.test/');
    nested.frame.reserveDeferredFetchQuota(nested.document.origin);
    expect(nested.frame.reservedDeferredFetchQuota).toBe(0);
  });
});

describe('navigation quota integration', () => {
  it('reserves after navigate dispatch, only when the source is the container Document', async () => {
    const { document } = await fixture();
    const turns: (() => void)[] = [];
    vi.spyOn(document.env.userAgent, 'runInParallel').mockImplementation((steps) => { turns.push(steps); });
    const nested = child(document, 'https://a.example.test/child');
    const navigate = (source: DocumentImpl) => nested.navigable.navigate(parseURL('https://foreign.test/next').url!, source, {}, source.env);
    const beforeUnload = vi.spyOn(nested.document, 'fireBeforeUnload').mockReturnValue([true, true]);
    const fire = vi.spyOn(nested.navigable.activeWindow!.navigation, 'firePushReplaceReloadNavigateEvent').mockReturnValue(false);
    navigate(document);
    expect(nested.frame.reservedDeferredFetchQuota).toBe(0);
    fire.mockReturnValue(true);
    navigate(nested.document);
    expect(nested.frame.reservedDeferredFetchQuota).toBe(0);
    navigate(document);
    expect(nested.frame.reservedDeferredFetchQuota).toBe(8192);
    expect(turns).toHaveLength(2);
    for (const steps of turns.splice(0)) steps();
    await expect.poll(() => beforeUnload.mock.calls.length).toBe(2);
    await expect.poll(() => turns.length).toBe(2);
    for (const steps of turns.splice(0)) steps();
  });

  it.each(['https://a.example.test/replaced', 'https://foreign.test/replaced'])(
    'releases or retains quota using the new Document\'s final origin before activation: %s', async (url) => {
      const { document } = await fixture();
      const nested = child(document, 'https://a.example.test/child');
      nested.frame.reservedDeferredFetchQuota = DeferredFetchQuota.Normal;
      const params = nested.navigable.createNavigationParamsFromSource(parseURL(url).url!);
      const created = nested.navigable.createAndInitializeDocument('html', 'text/html', params);
      expect(created.getNodeNavigable()).toBeNull();
      expect(nested.frame.reservedDeferredFetchQuota).toBe(url.includes('foreign.test') ? 65536 : 0);
    },
  );

  it('associates a COOP replacement context before quota release without activating its Document', async () => {
    const { document } = await fixture();
    const navigable = document.getNodeNavigable()!;
    const activeEntry = navigable.activeSessionHistoryEntry;
    const response = new FetchResponse();
    response.urlList.push(parseURL('https://isolated.test/').url!);
    response.headerList.append('Cross-Origin-Opener-Policy', 'same-origin');
    const params = navigable.createNavigationParams(response);

    const created = navigable.createAndInitializeDocument('html', 'text/html', params);

    expect(created.browsingContext).not.toBe(document.browsingContext);
    expect(created.browsingContext!.navigable).toBe(navigable);
    expect(document.browsingContext!.navigable).toBe(navigable);
    expect(created.getNodeNavigable()).toBeNull();
    expect(navigable.activeDocument).toBe(document);
    expect(navigable.activeSessionHistoryEntry).toBe(activeEntry);
  });
});

async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://a.example.test/current');
  const document = unwrap<DocumentImpl>(browser.document);
  vi.spyOn(document.getRelevantGlobalObject()!, 'hasTransientActivation').mockReturnValue(false);
  vi.spyOn(document.getNodeNavigable()!, 'isAllowedBySandboxingToNavigate').mockReturnValue(true);
  return { browser, document };
}

function child(parent: DocumentImpl, url: string, allow = '') {
  const parentNavigable = parent.getNodeNavigable()!;
  const frame = parent.createElement('iframe') as HTMLIFrameElementImpl;
  frame.setAttributeValue('allow', allow);
  parent.body!.appendChild(frame);
  const [, document] = BrowsingContext.create(parent, frame, parentNavigable.topLevelTraversable.activeBrowsingContext!.group!);
  document.setURL(parseURL(url).url!);
  document.origin = obtainURLOrigin(document.url);
  document.isInitialAboutBlank = false;
  document.permissionsPolicyState = PermissionsPolicy.create(frame, document.origin);
  const navigable = new Navigable(DocumentState.create(document), parentNavigable);
  frame.contentNavigable = navigable;
  vi.spyOn(document.getRelevantGlobalObject()!, 'hasTransientActivation').mockReturnValue(false);
  vi.spyOn(navigable, 'isAllowedBySandboxingToNavigate').mockReturnValue(true);
  return { frame, document, navigable };
}

function setPolicy(document: DocumentImpl, value: string) {
  const response = new FetchResponse();
  response.headerList.append('Permissions-Policy', value);
  document.permissionsPolicyState = PermissionsPolicy.fromResponse(document.getNodeNavigable()!.container, document.origin, response);
}

function pending(document: DocumentImpl, length: number, url: string) {
  const request = new FetchRequest(parseURL(url).url!, document.env);
  request.referrer = null;
  request.body = new Uint8Array(length - request.totalRequestLength);
  document.env.fetchGroup.deferredFetchRecords.push({ request, invokeState: 'pending', notifyInvoked: () => {} });
  return document.env.fetchGroup.deferredFetchRecords.at(-1)!;
}
