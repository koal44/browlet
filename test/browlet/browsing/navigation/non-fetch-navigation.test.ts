import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable } from '../../../../src/browlet/browsing/navigation/navigable';
import type { NonFetchSchemeNavigationParams } from '../../../../src/browlet/browsing/navigation/params';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import { SandboxingFlagSet } from '../../../../src/browlet/browsing/policy/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import { FetchResponse } from '../../../../src/fetch/index';
import { createOpaqueOrigin, obtainURLOrigin, parseURL } from '../../../../src/url/index';
import { unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('non-fetch navigation', () => {
  it.each([
    ['', false, false], ['', true, false],
    ['allow-popups', false, true], ['allow-popups', true, true],
    ['allow-top-navigation', false, true], ['allow-top-navigation', true, true],
    ['allow-top-navigation-to-custom-protocols', false, true],
    ['allow-top-navigation-to-custom-protocols', true, true],
    ['allow-top-navigation-by-user-activation', false, false],
    ['allow-top-navigation-by-user-activation', true, true],
    ['allow-scripts allow-downloads allow-popups-to-escape-sandbox', false, false],
    ['allow-scripts allow-downloads allow-popups-to-escape-sandbox', true, false],
  ] as const)('applies the child sandbox %j with captured activation %s (allowed: %s)', async (sandbox, activated, allowed) => {
    const { child, userAgent, params } = await fixture();
    params.targetSnapshotSandboxingFlags = SandboxingFlagSet.parse(sandbox);
    params.sourceSnapshotHasTransientActivation = activated;
    const select = vi.spyOn(userAgent, 'shouldHandleURLExternally').mockReturnValue(true);
    const handoff = vi.spyOn(userAgent, 'requestExternalSoftwareHandoff').mockImplementation(() => {});
    const inline = vi.spyOn(child, 'createDocumentForInlineContent');
    const active = child.activeSessionHistoryEntry;

    expect(child.attemptToCreateNonFetchSchemeDocument(params)).toBeNull();

    expect(select).toHaveBeenCalledExactlyOnceWith(params.url);
    if (allowed) {
      expect(handoff).toHaveBeenCalledExactlyOnceWith(params.url, child, activated, params.initiatorOrigin, undefined);
    } else {
      expect(handoff).not.toHaveBeenCalled();
    }
    expect(inline).not.toHaveBeenCalled();
    expect(child.activeSessionHistoryEntry).toBe(active);
    expect(child.currentSessionHistoryEntry).toBe(active);
  });

  it.each([false, true])('exempts top-level destinations from the child sandbox gate (activation: %s)', async (activated) => {
    const { top, userAgent, params } = await fixture();
    const handoff = vi.spyOn(userAgent, 'requestExternalSoftwareHandoff').mockImplementation(() => {});

    userAgent.handoffToExternalSoftware(params.url, top, SandboxingFlagSet.parse(''), activated, params.initiatorOrigin);

    expect(handoff).toHaveBeenCalledExactlyOnceWith(params.url, top, activated, params.initiatorOrigin, undefined);
  });

  it.each([false, true])('uses captured source activation and target restrictions rather than live Document state (%s)', async (activated) => {
    const { child, userAgent, params } = await fixture();
    params.sourceSnapshotHasTransientActivation = activated;
    params.targetSnapshotSandboxingFlags = SandboxingFlagSet.parse('allow-top-navigation-by-user-activation');
    child.activeDocument!.activeSandboxingFlagSet = activated ? SandboxingFlagSet.parse('') : new SandboxingFlagSet();
    const activation = vi.spyOn(child.activeWindow!, 'hasTransientActivation').mockReturnValue(!activated);
    vi.spyOn(userAgent, 'shouldHandleURLExternally').mockReturnValue(true);
    const handoff = vi.spyOn(userAgent, 'requestExternalSoftwareHandoff').mockImplementation(() => {});

    child.attemptToCreateNonFetchSchemeDocument(params);

    expect(handoff).toHaveBeenCalledTimes(activated ? 1 : 0);
    expect(activation).not.toHaveBeenCalled();
  });

  it.each(['url', 'response'] as const)('retains the %s resource and initiating origin at the host boundary', async (kind) => {
    const { child, userAgent, params } = await fixture();
    const resource = kind === 'url' ? params.url : new FetchResponse();
    const origin = createOpaqueOrigin();
    const handoff = vi.spyOn(userAgent, 'requestExternalSoftwareHandoff').mockImplementation(() => {});

    userAgent.handoffToExternalSoftware(resource, child, new SandboxingFlagSet(), false, origin);

    expect(handoff).toHaveBeenCalledExactlyOnceWith(resource, child, false, origin, undefined);
    handoff.mockClear();
    userAgent.handoffToExternalSoftware(resource, child, SandboxingFlagSet.parse(''), true, origin);
    expect(handoff).not.toHaveBeenCalled();
  });

  it.each(['teams.live.com', 'teams.microsoft.com'])('does not exempt msteams from the sandbox for %s', async (host) => {
    const { child, userAgent } = await fixture();
    const url = parseURL('msteams:meeting').url!;
    const initiator = obtainURLOrigin(parseURL(`https://${host}/`).url!);
    const handoff = vi.spyOn(userAgent, 'requestExternalSoftwareHandoff').mockImplementation(() => {});

    userAgent.handoffToExternalSoftware(url, child, SandboxingFlagSet.parse(''), false, initiator);

    expect(handoff).not.toHaveBeenCalled();
  });

  it.each([null, 'navigation-id'])('returns the inline owner result with its navigation metadata (id: %s)', async (id) => {
    const { child, userAgent, params, document } = await fixture();
    params.id = id;
    params.navigationTimingType = 'back_forward';
    params.userInvolvement = 'browser UI';
    const active = child.activeSessionHistoryEntry;
    const select = vi.spyOn(userAgent, 'shouldHandleURLExternally').mockReturnValue(false);
    const handoff = vi.spyOn(userAgent, 'handoffToExternalSoftware');
    const inline = vi.spyOn(child, 'createDocumentForInlineContent').mockReturnValue(document);

    expect(child.attemptToCreateNonFetchSchemeDocument(params)).toBe(document);

    expect(select).toHaveBeenCalledExactlyOnceWith(params.url);
    expect(inline).toHaveBeenCalledExactlyOnceWith(id, 'back_forward', 'browser UI', params.url);
    expect(handoff).not.toHaveBeenCalled();
    expect(child.activeSessionHistoryEntry).toBe(active);
  });

  it('stops at the handler-selection dependency instead of guessing from the scheme', async () => {
    const { child, userAgent, params } = await fixture();
    const handoff = vi.spyOn(userAgent, 'requestExternalSoftwareHandoff');
    const inline = vi.spyOn(child, 'createDocumentForInlineContent');

    expect(() => child.attemptToCreateNonFetchSchemeDocument(params)).toThrow('External URL handler selection is not implemented');
    expect(handoff).not.toHaveBeenCalled();
    expect(inline).not.toHaveBeenCalled();
  });

  it('stops at the host confirmation/handoff dependency on the allowed external path', async () => {
    const { child, userAgent, params } = await fixture();
    params.targetSnapshotSandboxingFlags.clear();
    vi.spyOn(userAgent, 'shouldHandleURLExternally').mockReturnValue(true);

    expect(() => child.attemptToCreateNonFetchSchemeDocument(params)).toThrow('External software confirmation and handoff are not implemented');
  });

  it('stops at the inline renderer when external handling is not selected', async () => {
    const { child, userAgent, params } = await fixture();
    vi.spyOn(userAgent, 'shouldHandleURLExternally').mockReturnValue(false);

    expect(() => child.attemptToCreateNonFetchSchemeDocument(params)).toThrow('Inline user-agent Document rendering is not implemented');
  });
});

async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/');
  const document = unwrap<DocumentImpl>(browser.document);
  const top = document.getNodeNavigable()!.topLevelTraversable;
  const iframe = document.createElement('iframe') as HTMLIFrameElementImpl;
  const [, childDocument] = BrowsingContext.create(document, iframe, top.activeBrowsingContext!.group!);
  const child = new Navigable(DocumentState.create(childDocument), top);
  iframe.contentNavigable = child;
  document.body!.appendChild(iframe);
  const params: NonFetchSchemeNavigationParams = {
    id: 'non-fetch-navigation', url: parseURL('mailto:someone@example.test').url!,
    targetSnapshotSandboxingFlags: SandboxingFlagSet.parse(''), sourceSnapshotHasTransientActivation: false,
    // The producer owns redirect-origin selection; do not replace it with the target Document's origin.
    initiatorOrigin: obtainURLOrigin(parseURL('https://redirector.test/').url!),
    navigationTimingType: 'navigate', userInvolvement: 'none',
  };
  return { document, top, child, params, userAgent: document.env.userAgent };
}
