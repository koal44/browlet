import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import type { SecurityPolicyViolationEvent, Window } from '../../../../src/browlet/platform';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable, type NavigateOptions } from '../../../../src/browlet/browsing/navigation/navigable';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import { CSPList, ContentSecurityPolicy } from '../../../../src/browlet/browsing/policy/csp/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import { navigationAndTraversalTaskSource } from '../../../../src/browlet/scripting/tasks';
import { FetchRequest } from '../../../../src/fetch/index';
import { obtainURLOrigin, parseURL, serializeURL } from '../../../../src/url/index';
import { unwrap } from '../../../support/browlet-binding';
import { runInHostTask } from '../../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('queued javascript: navigation', () => {
  it.each([false, true])('queues the synthetic request with captured source policy (form=%s)', async (form) => {
    const { document, navigable, env, loop, url } = await fixture();
    const process = vi.spyOn(navigable, 'navigateToJavaScriptURL').mockImplementation(() => {});
    const options: NavigateOptions = {
      historyHandling: 'push', userInvolvement: 'activation', initialInsertion: true,
      formDataEntryList: form ? [] : null,
    };
    document.policyContainer.referrerPolicy = 'no-referrer';
    await runInHostTask(() => {
      navigable.navigate(url, document, options, env);
      expect(process).not.toHaveBeenCalled();
      const id = navigable.ongoingNavigation;
      const tasks = [...loop.getTaskQueue(navigationAndTraversalTaskSource)];
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.document).toBe(document);
      document.policyContainer.referrerPolicy = 'unsafe-url';
      options.userInvolvement = 'none';
      options.initialInsertion = false;

      expect(loop.runTaskTurn()).toBe(true);

      expect(process).toHaveBeenCalledExactlyOnceWith(
        expect.any(FetchRequest), 'replace', document.origin, 'activation',
        form ? 'form-submission' : 'other', true, id, navigable.snapshotTargetParams(),
      );
      const request = process.mock.calls[0]![0];
      expect(serializeURL(request.url)).toBe(serializeURL(url));
      expect(request.client).toBe(env);
      expect(request.policyContainer).not.toBe(document.policyContainer);
      expect(request.policyContainer.referrerPolicy).toBe('no-referrer');
      expect(document.title).toBe('');
    });
  });

  it('keeps the source client separate from the child Window that owns the task', async () => {
    const { document, navigable, env, loop, url } = await fixture();
    const iframe = document.createElement('iframe') as HTMLIFrameElementImpl;
    const [, childDocument] = BrowsingContext.create(document, iframe, navigable.activeBrowsingContext!.group!);
    const child = new Navigable(DocumentState.create(childDocument), navigable);
    iframe.contentNavigable = child;
    iframe.setAttributeValue('referrerpolicy', 'no-referrer');
    const process = vi.spyOn(child, 'navigateToJavaScriptURL').mockImplementation(() => {});

    await runInHostTask(() => {
      child.navigate(url, document, {}, env);
      expect(process).not.toHaveBeenCalled();
      iframe.setAttributeValue('referrerpolicy', 'unsafe-url');
      expect([...loop.getTaskQueue(navigationAndTraversalTaskSource)].map((task) => task.document)).toEqual([childDocument]);
      expect(loop.runTaskTurn()).toBe(true);
    });

    const request = process.mock.calls[0]![0];
    expect(request.client).toBe(env);
    expect(request.env).toBe(childDocument.env);
    expect(request.env).not.toBe(request.client);
    expect(process.mock.calls[0]!.slice(1, 6)).toEqual(['replace', document.origin, 'none', 'other', false]);
    expect(process.mock.calls[0]![7].iframeReferrerPolicy).toBe('no-referrer');
  });

  it('retains a null source client and the target origin for a browser-UI request', async () => {
    const { document, navigable, env, loop, url } = await fixture();
    const process = vi.spyOn(navigable, 'navigateToJavaScriptURL').mockImplementation(() => {});
    await runInHostTask(() => {
      navigable.navigate(url, null, { userInvolvement: 'browser UI' }, env);
      expect(loop.runTaskTurn()).toBe(true);
    });
    const [request, history, origin, involvement, type, initial] = process.mock.calls[0]!;
    expect(request.client).toBeNull();
    expect(request.policyContainer).toBeDefined();
    expect(request.policyContainer).not.toBe(document.policyContainer);
    expect([history, origin, involvement, type, initial]).toEqual(['replace', document.origin, 'browser UI', 'other', false]);
  });

  it('keeps the target-Agent handoff and javascript: processing as separate tasks', async () => {
    const { document, navigable, loop, url } = await fixture();
    const process = vi.spyOn(navigable, 'navigateToJavaScriptURL').mockImplementation(() => {});
    await runInHostTask(() => {
      navigable.navigate(url, document);
      expect(navigable.ongoingNavigation).toBeNull();
      expect(loop.runTaskTurn()).toBe(true);
      expect(navigable.ongoingNavigation).toEqual(expect.any(String));
      expect(process).not.toHaveBeenCalled();
      expect(loop.getTaskQueue(navigationAndTraversalTaskSource).size).toBe(1);
      expect(loop.runTaskTurn()).toBe(true);
      expect(process).toHaveBeenCalledOnce();
    });
  });

  it.each([null, 'replacement', 'traversal'])('ignores a queued request superseded by %s', async (replacement) => {
    const { document, navigable, env, loop, url } = await fixture();
    const process = vi.spyOn(navigable, 'navigateToJavaScriptURL');
    await runInHostTask(() => {
      navigable.navigate(url, document, {}, env);
      navigable.setOngoingNavigation(replacement, env);
      expect(loop.runTaskTurn()).toBe(true);
    });
    expect(process).toHaveBeenCalledOnce();
    expect(navigable.ongoingNavigation).toBe(replacement);
    expect(document.title).toBe('');
  });

  it('checks the live destination origin after queuing and clears the matching ID before rejecting it', async () => {
    const { document, navigable, env, loop, url } = await fixture();
    const original = document.origin;
    await runInHostTask(() => {
      navigable.navigate(url, document, {}, env);
      document.origin = obtainURLOrigin(parseURL('https://foreign.test/').url!);
      expect(loop.runTaskTurn()).toBe(true);
    });
    expect(navigable.ongoingNavigation).toBeNull();
    expect(document.origin).not.toBe(original);
    expect(document.title).toBe('');
  });

  it('honors same-origin-domain relaxation before executing source', async () => {
    const { document, navigable, env, url } = await fixture();
    const initiator = obtainURLOrigin(parseURL('https://a.example.test/').url!);
    const target = obtainURLOrigin(parseURL('https://b.example.test/').url!);
    if (initiator.kind !== 'tuple' || target.kind !== 'tuple') throw new Error('Tuple origins required');
    initiator.domain = target.domain = { kind: 'domain', value: 'example.test' };
    document.origin = target;
    navigable.setOngoingNavigation('request', env);

    expect(() => navigable.navigateToJavaScriptURL(
      Object.assign(new FetchRequest(url, env), { client: env, policyContainer: document.policyContainer.clone() }),
      'replace', initiator, 'none', 'other', false, 'request', navigable.snapshotTargetParams(),
    )).toThrow('HTML document loading requires response-reader setup and parser script preparation');
    expect(navigable.ongoingNavigation).toBeNull();
    expect(document.title).toBe('executed');
  });

  it('requires replacement even if the request was already superseded', async () => {
    const { document, navigable, env, url } = await fixture();
    expect(() => navigable.navigateToJavaScriptURL(
      Object.assign(new FetchRequest(url, env), { client: env, policyContainer: document.policyContainer.clone() }),
      'push', document.origin, 'none', 'other', false, 'stale', navigable.snapshotTargetParams(),
    )).toThrow('JavaScript URL navigation must replace history');
    expect(navigable.ongoingNavigation).toBeNull();
  });

  it('executes asynchronously and stops before replacing the Document for a string result', async () => {
    const { document, navigable, env, loop, url } = await fixture();
    const entry = navigable.activeSessionHistoryEntry;
    await runInHostTask(() => {
      expect(() => navigable.navigate(url, document, {}, env)).not.toThrow();
      expect(navigable.ongoingNavigation).toEqual(expect.any(String));
      expect(document.title).toBe('');
      expect(() => loop.runTaskTurn()).toThrow('HTML document loading requires response-reader setup and parser script preparation');
    });
    expect(navigable.ongoingNavigation).toBeNull();
    expect(navigable.activeSessionHistoryEntry).toBe(entry);
    expect(navigable.activeDocument).toBe(document);
    expect(document.title).toBe('executed');
  });

  it('completes a non-string result without Fetch or changing the active history entry', async () => {
    const { browser, document, navigable, env, loop, route } = await fixture();
    const entry = navigable.activeSessionHistoryEntry;
    const url = parseURL('javascript:void(document.title="executed")').url!;
    await runInHostTask(() => {
      navigable.navigate(url, document, {}, env);
      expect(loop.runTaskTurn()).toBe(true);
    });
    expect(navigable.ongoingNavigation).toBeNull();
    expect(navigable.activeSessionHistoryEntry).toBe(entry);
    expect(navigable.currentSessionHistoryEntry).toBe(entry);
    expect(navigable.activeDocument).toBe(document);
    expect(document.title).toBe('executed');
    expect(browser.window.location.href).toBe('https://example.test/page');
    expect(route).toHaveBeenCalledOnce();
  });

  it('blocks from the captured source policy even after the live policy changes', async () => {
    const { browser, document, navigable, env, loop, url } = await fixture();
    document.policyContainer.cspList = new CSPList(document.origin);
    document.policyContainer.cspList.policies.push(ContentSecurityPolicy.parse("script-src 'none'", 'header', 'enforce'));
    const events: string[] = [];
    browser.document.addEventListener('securitypolicyviolation', (event) => {
      events.push((event as SecurityPolicyViolationEvent).effectiveDirective);
    });
    await runInHostTask(() => {
      navigable.navigate(url, document, {}, env);
      document.policyContainer.cspList!.policies = [];
      expect(loop.runTaskTurn()).toBe(true);
      expect(navigable.ongoingNavigation).toBeNull();
      expect(document.title).toBe('');
      expect(loop.runTaskTurn()).toBe(true);
      expect(events).toEqual(['script-src-elem']);
    });
  });

  it('checks the parent source policy and delivers its violation there for a child destination', async () => {
    const { browser, document, navigable, env, loop, url } = await fixture();
    const iframe = document.createElement('iframe') as HTMLIFrameElementImpl;
    const [, childDocument] = BrowsingContext.create(document, iframe, navigable.activeBrowsingContext!.group!);
    const child = new Navigable(DocumentState.create(childDocument), navigable);
    iframe.contentNavigable = child;
    childDocument.policyContainer.cspList = undefined;
    document.policyContainer.cspList = new CSPList(document.origin);
    document.policyContainer.cspList.policies.push(ContentSecurityPolicy.parse("script-src 'none'", 'header', 'enforce'));
    const events: string[] = [];
    browser.document.addEventListener('securitypolicyviolation', (event) => {
      events.push((event as SecurityPolicyViolationEvent).effectiveDirective);
    });
    await runInHostTask(() => {
      child.navigate(url, document, {}, env);
      expect(loop.runTaskTurn()).toBe(true);
      expect(loop.runTaskTurn()).toBe(true);
      expect(events).toEqual(['script-src-elem']);
    });
    expect(child.ongoingNavigation).toBeNull();
    expect(childDocument.title).toBe('');
  });

  it('lets browser-UI navigation reach evaluation with its empty source policy and null client', async () => {
    const { document, navigable, env, loop, url } = await fixture();
    document.policyContainer.cspList = new CSPList(document.origin);
    document.policyContainer.cspList.policies.push(ContentSecurityPolicy.parse("script-src 'none'", 'header', 'enforce'));
    await runInHostTask(() => {
      navigable.navigate(url, null, { userInvolvement: 'browser UI' }, env);
      expect(() => loop.runTaskTurn()).toThrow('HTML document loading requires response-reader setup and parser script preparation');
    });
    expect(navigable.ongoingNavigation).toBeNull();
    expect(document.title).toBe('executed');
  });

  it('checks form-action on synthetic form-submission requests before inline policy', async () => {
    const { document, navigable, env, loop, url } = await fixture();
    document.policyContainer.cspList = new CSPList(document.origin);
    document.policyContainer.cspList.policies.push(ContentSecurityPolicy.parse("form-action 'none'", 'header', 'enforce'));
    await runInHostTask(() => {
      navigable.navigate(url, document, { formDataEntryList: [] }, env);
      expect(loop.runTaskTurn()).toBe(true);
    });
    expect(navigable.ongoingNavigation).toBeNull();
    expect(document.title).toBe('');
  });

  it('executes the Trusted Types rewrite instead of the original source', async () => {
    const { browser, document, navigable, env, loop, url } = await fixture();
    document.policyContainer.cspList = new CSPList(document.origin);
    document.policyContainer.cspList.policies.push(ContentSecurityPolicy.parse("require-trusted-types-for 'script'", 'header', 'enforce'));
    await browser.evaluate(() => {
      (window as unknown as Window).trustedTypes.createPolicy('default', { createScript: () => 'document.title="rewritten"' });
    });
    const process = vi.spyOn(navigable, 'navigateToJavaScriptURL');
    await runInHostTask(() => {
      navigable.navigate(url, document, {}, env);
      expect(() => loop.runTaskTurn()).toThrow('HTML document loading requires response-reader setup and parser script preparation');
    });
    expect(serializeURL(process.mock.calls[0]![0].url)).toBe('javascript:document.title="rewritten"');
    expect(serializeURL(url)).toBe('javascript:document.title="executed"');
    expect(document.title).toBe('rewritten');
  });

  it('selects the live target environment after a Trusted Types callback changes the active Document', async () => {
    const { browser, document, navigable, env, loop, url } = await fixture();
    const [, replacement] = BrowsingContext.create(document, null, navigable.activeBrowsingContext!.group!);
    document.policyContainer.cspList = new CSPList(document.origin);
    document.policyContainer.cspList.policies.push(ContentSecurityPolicy.parse("require-trusted-types-for 'script'", 'header', 'enforce'));
    Reflect.set(env.global, 'replaceDestination', () => {
      // Full replacement finalization is unfinished; supply its active-entry change at this callback boundary.
      navigable.activeSessionHistoryEntry = replacement.env.createSessionHistoryEntry(replacement.url, DocumentState.create(replacement));
    });
    await browser.evaluate(() => {
      (window as unknown as Window).trustedTypes.createPolicy('default', {
        createScript: () => {
          (window as unknown as { replaceDestination(): void; }).replaceDestination();
          return 'void(document.title="replacement")';
        },
      });
    });
    await runInHostTask(() => {
      navigable.navigate(url, document, {}, env);
      expect(loop.runTaskTurn()).toBe(true);
    });
    expect(navigable.activeDocument).toBe(replacement);
    expect(replacement.env).not.toBe(env);
    expect(document.title).toBe('');
    expect(replacement.title).toBe('replacement');
  });
});

async function fixture() {
  const route = vi.fn(() => '');
  const browser = new Browlet({ route });
  await browser.navigate('https://example.test/page');
  const document = unwrap<DocumentImpl>(browser.document);
  const env = document.env;
  const navigable = document.getNodeNavigable()!;
  // Supply activation and isolate sandbox admission while testing javascript: navigation.
  vi.spyOn(document.getRelevantGlobalObject()!, 'hasTransientActivation').mockReturnValue(false);
  vi.spyOn(navigable, 'isAllowedBySandboxingToNavigate').mockReturnValue(true);
  const url = parseURL('javascript:document.title="executed"').url!;
  return { browser, document, navigable, env, loop: env.responsibleEventLoop, url, route };
}
