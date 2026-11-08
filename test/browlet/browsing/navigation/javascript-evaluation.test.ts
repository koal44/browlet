import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import type { ErrorEvent } from '../../../../src/browlet/platform';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable, type NavigableContainer } from '../../../../src/browlet/browsing/navigation/navigable';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import { ClassicScript } from '../../../../src/browlet/scripting/script';
import { ScriptFetchOptions } from '../../../../src/browlet/scripting/script-fetch-options';
import { FetchRequest } from '../../../../src/fetch/index';
import { parseURL, serializeURL } from '../../../../src/url/index';
import { unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('javascript: classic-script evaluation', () => {
  it.each([
    ['%C3%A9', 'é'], ['é', 'é'], ['%25%2520+%GG%', '%%20+%GG%'],
    // SPEC_CLASH(javascript-url-utf8-decoding): HTML/Firefox/WebKit, not Chromium's byte fallback.
    ['%FF', '\uFFFD'], ['%C3%A9%FF', 'é\uFFFD'], ['%E2%82', '\uFFFD'],
  ])('decodes %s once before execution', async (encoded, decoded) => {
    const { document, navigable, targetSnapshotParams } = await fixture();
    const url = parseURL(`javascript:void(document.title="${encoded}")`).url!;
    expect(navigable.evaluateJavaScriptURL(url, document.origin, 'none', 'request', targetSnapshotParams)).toBeNull();
    expect(document.title).toBe(decoded);
  });

  it('removes the initial UTF-8 BOM and keeps the full serialized query and fragment in the source', async () => {
    const { document, navigable, env, targetSnapshotParams } = await fixture();
    const parse = vi.spyOn(env.realm, 'parseClassicScript');
    const url = parseURL('JaVaScRiPt:%EF%BB%BFvoid(document.title="done")//?query#fragment').url!;
    expect(navigable.evaluateJavaScriptURL(url, document.origin, 'none', 'request', targetSnapshotParams)).toBeNull();
    expect(parse.mock.calls[0]![0]).toBe('void(document.title="done")//?query#fragment');
    expect(document.title).toBe('done');
  });

  it.each(['', 'void 0', '42', 'null', 'false', '1n', 'Symbol()', 'new String("html")',
    '({toString(){throw new Error("must not coerce")}})',
  ])('returns no Document for non-string completion %s', async (source) => {
    const { document, navigable, targetSnapshotParams } = await fixture();
    const entry = navigable.activeSessionHistoryEntry;
    expect(navigable.evaluateJavaScriptURL(parseURL(`javascript:${source}`).url!, document.origin, 'none', 'request', targetSnapshotParams)).toBeNull();
    expect(navigable.activeSessionHistoryEntry).toBe(entry);
    expect(navigable.activeDocument).toBe(document);
  });

  it.each([['""', ''], ['"<p>replacement</p>"', 'replacement']])('loads a fresh replacement Document for %s', async (source, text) => {
    const { document, navigable, targetSnapshotParams } = await fixture();
    const replacement = navigable.evaluateJavaScriptURL(
      parseURL(`javascript:${source}`).url!, document.origin, 'none', 'request', targetSnapshotParams,
    );
    if (replacement === null) throw new Error('A string completion must produce a replacement Document');
    expect(replacement).not.toBe(document);
    expect(replacement.URL).toBe(document.URL);
    expect(replacement.origin).toBe(document.origin);
    expect(navigable.activeDocument).toBe(document);
    // Evaluation creates the Document; its caller subsequently commits the replacement.
    const state = DocumentState.create(replacement);
    state.origin = replacement.origin;
    state.everPopulated = true;
    const entry = replacement.env.createSessionHistoryEntry(replacement.url, state);
    navigable.finalizeCrossDocumentNavigation('replace', 'none', entry);
    await expect.poll(() => replacement.readyState).toBe('complete');
    expect(replacement.body!.textContent).toBe(text);
  });

  it('uses the target environment, API base URL, default fetch options, and script execution lifecycle', async () => {
    const { document, navigable, env, targetSnapshotParams } = await fixture();
    const base = document.createElement('base');
    base.setAttributeValue('href', '/script-base/');
    document.head!.appendChild(base);
    const loop = env.responsibleEventLoop;
    let script: ClassicScript | undefined;
    let record: unknown;
    Reflect.set(env.global, 'inspectScript', () => {
      script = loop.runningScript as ClassicScript;
      record = loop.runningExecutionContext!.scriptOrModule;
    });
    expect(navigable.evaluateJavaScriptURL(
      parseURL('javascript:inspectScript();void 0').url!, document.origin, 'none', 'request', targetSnapshotParams,
    )).toBeNull();
    expect(script).toBeInstanceOf(ClassicScript);
    expect(script!.env).toBe(env);
    expect(serializeURL(script!.baseURL!)).toBe('https://example.test/script-base/');
    expect(script!.fetchOptions).toEqual(new ScriptFetchOptions());
    expect(script!.mutedErrors).toBe(false);
    expect(script!.originalSourceURL).toBeNull();
    expect(record).toBe(script!.record);
    expect(loop.executionContextStack).toHaveLength(0);
  });

  it.each(['const =', 'throw "<p>not a replacement</p>"'])('reports an abrupt completion and returns null: %s', async (source) => {
    const { browser, document, navigable, env, targetSnapshotParams } = await fixture();
    const errors: ErrorEvent[] = [];
    browser.window.addEventListener('error', (event) => {
      errors.push(event as ErrorEvent);
      event.preventDefault();
    });
    expect(navigable.evaluateJavaScriptURL(parseURL(`javascript:${source}`).url!, document.origin, 'none', 'request', targetSnapshotParams)).toBeNull();
    expect(errors).toHaveLength(1);
    if (source.startsWith('const')) expect(errors[0]!.error).toBeInstanceOf(env.realm.SyntaxError);
    else expect(errors[0]!.error).toBe('<p>not a replacement</p>');
    expect(env.responsibleEventLoop.executionContextStack).toHaveLength(0);
    expect(navigable.activeDocument).toBe(document);
  });

  it.each(['disabled', 'sandboxed', 'inactive'] as const)('honors %s script settings', async (reason) => {
    const { document, navigable, env, targetSnapshotParams } = await fixture();
    if (reason === 'disabled') env.userAgent.scriptingEnabled = false;
    else if (reason === 'sandboxed') document.activeSandboxingFlagSet.add('sandboxed-scripts');
    else document.browsingContext = null;
    const report = vi.spyOn(env, 'reportException');
    expect(navigable.evaluateJavaScriptURL(
      parseURL('javascript:document.title="forbidden"').url!, document.origin, 'none', 'request', targetSnapshotParams,
    )).toBeNull();
    expect(document.title).toBe('');
    expect(report).not.toHaveBeenCalled();
  });
});

describe('javascript: completion during initial child insertion', () => {
  it('uses the child Window for execution and synchronously notifies the initial iframe', async () => {
    const { platformContainer, container, childDocument, child, run } = await childFixture('iframe');
    expect(container).toBeInstanceOf(HTMLIFrameElementImpl);
    const listener = vi.fn((_event: Event) => [childDocument.title, childDocument.iframeLoadInProgress]);
    platformContainer.addEventListener('load', listener);
    run('void(document.title="child")');
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0]![0]).toMatchObject({ type: 'load', isTrusted: true, bubbles: false, cancelable: false });
    expect(listener.mock.results[0]!.value).toEqual(['child', true]);
    expect(childDocument.title).toBe('child');
    expect(childDocument.iframeLoadInProgress).toBe(false);
    expect(container.nodeDocument.title).toBe('');
    expect(child.ongoingNavigation).toBeNull();
  });

  it.each(['object', 'embed', 'frame'] as const)('fires load at an initial %s container after evaluation', async (tag) => {
    const { platformContainer, childDocument, run } = await childFixture(tag);
    const listener = vi.fn((_event: Event) => childDocument.title);
    platformContainer.addEventListener('load', listener);
    run('void(document.title="child")');
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0]![0]).toMatchObject({ type: 'load', isTrusted: true, bubbles: false, cancelable: false });
    expect(listener.mock.results[0]!.value).toBe('child');
  });

  it.each(['not-initial', 'not-blank', 'removed'] as const)('omits initial load when %s', async (reason) => {
    const { container, childDocument, run } = await childFixture('iframe');
    if (reason === 'not-blank') childDocument.isInitialAboutBlank = false;
    Reflect.set(childDocument.env.global, 'removeContainer', () => { container.contentNavigable = null; });
    expect(() => run(reason === 'removed' ? 'removeContainer();void 0' : 'void 0', reason !== 'not-initial')).not.toThrow();
  });
});

async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/page');
  const document = unwrap<DocumentImpl>(browser.document);
  const navigable = document.getNodeNavigable()!;
  return { browser, document, navigable, env: document.env, targetSnapshotParams: navigable.snapshotTargetParams() };
}

async function childFixture(tag: 'iframe' | 'object' | 'embed' | 'frame') {
  const { browser, document, navigable, env, targetSnapshotParams } = await fixture();
  const platformContainer = browser.document.createElement(tag);
  const container = unwrap<NavigableContainer>(platformContainer);
  document.body!.appendChild(container);
  // Non-iframe element loading is unfinished; associate its child directly after context creation.
  const [, childDocument] = BrowsingContext.create(
    document, container instanceof HTMLIFrameElementImpl ? container : null, navigable.activeBrowsingContext!.group!,
  );
  const child = new Navigable(DocumentState.create(childDocument), navigable);
  container.contentNavigable = child;
  const run = (source: string, initialInsertion = true) => {
    child.ongoingNavigation = 'request';
    const request = Object.assign(new FetchRequest(parseURL(`javascript:${source}`).url!, childDocument.env), {
      client: env, policyContainer: document.policyContainer.clone(),
    });
    child.navigateToJavaScriptURL(request, 'replace', document.origin, 'none', 'other', initialInsertion, 'request', targetSnapshotParams);
  };
  return { platformContainer, container, childDocument, child, run };
}
