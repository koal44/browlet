import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import { PolicyContainer, OpenerPolicy } from '../../../../src/browlet/browsing/policy/index';
import { CSPList, ContentSecurityPolicy } from '../../../../src/browlet/browsing/policy/csp/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { FetchRequest } from '../../../../src/fetch/index';
import { obtainURLOrigin, parseURL, serializeURL } from '../../../../src/url/index';
import { unwrap } from '../../../support/browlet-binding';
import { runInHostTask } from '../../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('javascript: replacement response', () => {
  it.each([
    ['hello', [104, 101, 108, 108, 111]], ['', []], ['é😀', [195, 169, 240, 159, 152, 128]],
    // SPEC_CLASH(javascript-result-encoding): Firefox maps Latin-1-only U+0080 to the Windows-1252 Euro.
    ['\u0080', [194, 128]], ['\uD800', [239, 191, 189]],
  ] as const)('delivers %j as UTF-8 HTML at the active URL', async (result, bytes) => {
    const { document, navigable, env, snapshot } = await fixture();
    const load = vi.spyOn(navigable, 'loadHTMLDocument').mockReturnValue(document);
    const url = parseURL(`javascript:${JSON.stringify(result)}`).url!;
    expect(navigable.evaluateJavaScriptURL(url, document.origin, 'none', 'request', snapshot)).toBe(document);
    const [params, ...extraArguments] = load.mock.calls[0]!;
    expect(extraArguments).toEqual([]);
    expect(params.response.status).toBe(200);
    expect(params.response.urlList).toEqual([document.url]);
    expect(params.response.headerList.get('Content-Type')).toBe('text/html;charset=utf-8');
    const body = params.response.body!;
    expect(body.source).toEqual(Uint8Array.from(bytes));
    expect(body.length).toBe(bytes.length);
    expect(body.stream.env).toBe(env.userAgent.sandbox);

    // Pending response bytes must survive the departing Document becoming inactive.
    document.browsingContext = null;
    const delivered = await new Promise<Uint8Array>((resolve, reject) => {
      body.stream.getDefaultReader().readAllBytes(resolve, reject);
    });
    expect(delivered).toEqual(Uint8Array.from(bytes));
  });

  it('inherits the live post-script Document while retaining the supplied origin and target snapshot', async () => {
    const { document, navigable, env, snapshot } = await fixture();
    const [, liveDocument] = BrowsingContext.create(document, null, navigable.activeBrowsingContext!.group!);
    liveDocument.setURL(parseURL('https://example.test/after-script').url!);
    liveDocument.aboutBaseURL = parseURL('https://example.test/base/').url!;
    liveDocument.cookieURL = parseURL('https://example.test/cookies').url!;
    const policy = new PolicyContainer();
    policy.cspList = new CSPList(document.origin);
    policy.cspList.policies.push(ContentSecurityPolicy.parse('sandbox allow-scripts allow-downloads', 'header', 'enforce'));
    liveDocument.policyContainer = policy;
    liveDocument.openerPolicy = new OpenerPolicy();
    liveDocument.openerPolicy.value = 'same-origin';
    snapshot.sandboxingFlags.add('sandboxed-downloads');
    snapshot.iframeReferrerPolicy = 'no-referrer';
    const load = vi.spyOn(navigable, 'loadHTMLDocument').mockReturnValue(liveDocument);
    Reflect.set(env.global, 'replaceDestination', () => {
      // Supply the still-unfinished cross-document activation at this author-callback boundary.
      navigable.activeSessionHistoryEntry = env.createSessionHistoryEntry(liveDocument.url, DocumentState.create(liveDocument));
    });
    const url = parseURL('javascript:replaceDestination();"body"').url!;
    navigable.evaluateJavaScriptURL(url, document.origin, 'activation', 'request', snapshot);
    const params = load.mock.calls[0]![0];
    expect(params.response.url).toBe(liveDocument.url);
    expect(params.origin).toBe(document.origin);
    expect(params.policyContainer).toBe(policy);
    expect(params.finalSandboxingFlagSet).toEqual(policy.cspList.getSandboxingFlags());
    expect(params.finalSandboxingFlagSet.has('sandboxed-downloads')).toBe(false);
    expect(params.openerPolicy).toBe(liveDocument.openerPolicy);
    expect(params.coopEnforcementResult).toEqual({
      needsBrowsingContextGroupSwitch: false, wouldNeedBrowsingContextGroupSwitchDueToReportOnly: false,
      url, origin: document.origin, openerPolicy: liveDocument.openerPolicy, currentContextIsNavigationSource: false,
    });
    expect(params.iframeReferrerPolicy).toBe('no-referrer');
    expect(params.aboutBaseURL).toBe(liveDocument.aboutBaseURL);
    expect(params.cookieURL).toEqual(liveDocument.cookieURL);
    expect(params.cookieURL).not.toBe(liveDocument.cookieURL);
    expect(params.id).toBe('request');
    expect(params.userInvolvement).toBe('activation');
    expect(params.navigationTimingType).toBe('navigate');
    expect(Number.isFinite(params.startTime)).toBe(true);
    // SPEC_CLASH(javascript-replacement-referrer): A null request gives the replacement an empty referrer.
    expect(params.request).toBeNull();
    expect(params.fetchController).toBeNull();
    expect(params.commitEarlyHints).toBeNull();
    expect(params.reservedEnv).toBeNull();
  });

  it('uses an empty sandbox set when there is no inherited CSP', async () => {
    const { document, navigable, snapshot } = await fixture();
    document.policyContainer.cspList = undefined;
    document.activeSandboxingFlagSet.add('sandboxed-downloads');
    snapshot.sandboxingFlags.add('sandboxed-downloads');
    const load = vi.spyOn(navigable, 'loadHTMLDocument').mockReturnValue(document);
    navigable.evaluateJavaScriptURL(parseURL('javascript:"body"').url!, document.origin, 'none', 'request', snapshot);
    expect(load.mock.calls[0]![0].finalSandboxingFlagSet.size).toBe(0);
  });

  it.each([false, true])('loads and activates a script-free replacement (initial about:blank: %s)', async (initialBlank) => {
    const { document, navigable, run } = await fixture(initialBlank);
    const create = vi.spyOn(navigable, 'createAndInitializeDocument');
    const append = vi.spyOn(navigable.traversable, 'appendSessionHistoryTraversalSteps');
    const entry = navigable.activeSessionHistoryEntry;
    run();
    expect(create).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledOnce();
    expect(navigable.activeDocument).toBe(document);
    expect(navigable.activeSessionHistoryEntry).toBe(entry);
    await expect.poll(() => navigable.activeDocument !== document && navigable.activeDocument?.readyState === 'complete').toBe(true);
    const replacement = navigable.activeDocument!;
    expect(replacement.body?.textContent).toBe('replacement');
    expect(replacement.URL).toBe(document.URL);
    expect(replacement.origin).toBe(document.origin);
    expect(replacement.referrer).toBe('');
    expect(navigable.activeSessionHistoryEntry.navigationAPIKey).toBe(entry.navigationAPIKey);
  });
});

describe('javascript: replacement history preparation', () => {
  it.each([false, true])('copies retained metadata into fresh state and queues finalization (policy=%s)', async (hasPolicy) => {
    const { document, navigable, env, run } = await fixture();
    const oldEntry = navigable.activeSessionHistoryEntry;
    const oldState = oldEntry.documentState;
    const historyURL = parseURL('https://example.test/history-url').url!;
    oldEntry.url = historyURL;
    oldState.historyPolicyContainer = hasPolicy ? new PolicyContainer() : null;
    if (oldState.historyPolicyContainer !== null) oldState.historyPolicyContainer.referrerPolicy = 'no-referrer';
    oldState.requestReferrer = parseURL('https://referrer.test/old').url!;
    oldState.requestReferrerPolicy = 'origin';
    oldState.aboutBaseURL = parseURL('https://example.test/history-base/').url!;
    oldState.navigableTargetName = 'retained-name';
    oldState.resource = 'old srcdoc HTML';
    oldState.nestedHistories = [{ id: Symbol('old-child'), entries: [oldEntry] }];
    oldState.reloadPending = true;
    oldEntry.classicHistoryAPIState = env.serializeForStorage('old classic state');
    oldEntry.navigationAPIState = env.serializeForStorage('old navigation state');
    oldEntry.scrollRestorationMode = 'manual';
    const [, newDocument] = BrowsingContext.create(document, null, navigable.activeBrowsingContext!.group!);
    vi.spyOn(navigable, 'loadHTMLDocument').mockReturnValue(newDocument);
    const finalize = vi.spyOn(navigable, 'finalizeCrossDocumentNavigation').mockImplementation(() => {});
    const parallel = vi.spyOn(env.userAgent, 'runInParallel').mockImplementation(() => {});

    run();

    expect(navigable.activeSessionHistoryEntry).toBe(oldEntry);
    expect(finalize).not.toHaveBeenCalled();
    expect(parallel).toHaveBeenCalledOnce();
    await runInHostTask(() => { parallel.mock.calls[0]![0](); });
    expect(finalize).toHaveBeenCalledExactlyOnceWith('replace', 'activation', expect.anything());
    const entry = finalize.mock.calls[0]![2];
    const state = entry.documentState;
    expect(entry).not.toBe(oldEntry);
    expect(entry.url).toBe(historyURL);
    expect(serializeURL(entry.url)).not.toContain('javascript:');
    expect(state).not.toBe(oldState);
    expect(state.document).toBe(newDocument);
    expect(state.historyPolicyContainer).toEqual(oldState.historyPolicyContainer);
    if (hasPolicy) {
      expect(state.historyPolicyContainer).not.toBe(oldState.historyPolicyContainer);
      oldState.historyPolicyContainer!.referrerPolicy = 'unsafe-url';
      expect(state.historyPolicyContainer!.referrerPolicy).toBe('no-referrer');
    }
    expect(state.requestReferrer).toBe(oldState.requestReferrer);
    expect(state.requestReferrerPolicy).toBe('origin');
    expect(state.initiatorOrigin).toBe(document.origin);
    expect(state.origin).toBe(document.origin);
    expect(state.aboutBaseURL).toBe(oldState.aboutBaseURL);
    expect(state.navigableTargetName).toBe('retained-name');
    expect(state.everPopulated).toBe(true);
    expect(state.resource).toBeNull();
    expect(state.nestedHistories).toEqual([]);
    expect(state.reloadPending).toBe(false);
    expect(state.notRestoredReasons).toBeNull();
    expect(newDocument.env.deserialize(entry.classicHistoryAPIState)).toBeNull();
    expect(newDocument.env.deserialize(entry.navigationAPIState)).toBeUndefined();
    expect(entry.scrollRestorationMode).toBe('auto');
    expect(entry.step).toBe('pending');
    expect(entry.navigationAPIID).not.toBe(oldEntry.navigationAPIID);
  });

  it('selects the entry to replace after the loader returns', async () => {
    const { document, navigable, env, run } = await fixture();
    const [, newDocument] = BrowsingContext.create(document, null, navigable.activeBrowsingContext!.group!);
    const liveEntry = env.createSessionHistoryEntry(parseURL('https://example.test/live-entry').url!, DocumentState.create(document));
    liveEntry.documentState.navigableTargetName = 'live-name';
    vi.spyOn(navigable, 'loadHTMLDocument').mockImplementation(() => {
      navigable.activeSessionHistoryEntry = liveEntry;
      return newDocument;
    });
    const append = vi.spyOn(navigable.traversable, 'appendSessionHistoryTraversalSteps').mockImplementation(() => {});
    const finalize = vi.spyOn(navigable, 'finalizeCrossDocumentNavigation').mockImplementation(() => {});
    run();
    append.mock.calls[0]![0]();
    expect(finalize.mock.calls[0]![2].url).toBe(liveEntry.url);
    expect(finalize.mock.calls[0]![2].documentState.navigableTargetName).toBe('live-name');
  });

  it('requires the loader to preserve the supplied origin', async () => {
    const { document, navigable, run } = await fixture();
    const [, newDocument] = BrowsingContext.create(document, null, navigable.activeBrowsingContext!.group!);
    newDocument.origin = obtainURLOrigin(parseURL('https://foreign.test/').url!);
    vi.spyOn(navigable, 'loadHTMLDocument').mockReturnValue(newDocument);
    const append = vi.spyOn(navigable.traversable, 'appendSessionHistoryTraversalSteps');
    expect(() => run()).toThrow('JavaScript URL replacement must retain the initiator origin');
    expect(append).not.toHaveBeenCalled();
  });
});

async function fixture(initialBlank = false) {
  const browser = new Browlet({ route: () => '' });
  if (!initialBlank) await browser.navigate('https://example.test/page');
  const document = unwrap<DocumentImpl>(browser.document);
  const env = document.env;
  const navigable = document.getNodeNavigable()!;
  const snapshot = navigable.snapshotTargetParams();
  const run = () => {
    navigable.ongoingNavigation = 'request';
    const request = Object.assign(new FetchRequest(parseURL('javascript:"replacement"').url!, env), {
      client: env, policyContainer: document.policyContainer.clone(),
    });
    navigable.navigateToJavaScriptURL(request, 'replace', document.origin, 'activation', 'other', false, 'request', snapshot);
  };
  return { browser, document, navigable, env, snapshot, run };
}
