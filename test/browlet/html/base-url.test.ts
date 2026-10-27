import { afterEach, describe, expect, it, vi } from 'vitest';

import { HTML_NAMESPACE } from '../../../src/infra/index';
import { parseURL } from '../../../src/url/index';
import type { ClassicScript, JavaScriptModuleScript } from '../../../src/browlet/scripting/script';
import { SpeculationRulesParseResult } from '../../../src/browlet/scripting/speculation-rules';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import type { HTMLBaseElementImpl } from '../../../src/browlet/dom/nodes/html/metadata/base';
import { HTMLScriptElementImpl } from '../../../src/browlet/dom/nodes/html/scripting/script';
import { createTestDocument } from '../../support/dom';
import { createScriptState } from '../../support/script-state';

afterEach(() => vi.restoreAllMocks());

describe('Document base URL changes', () => {
  it('sets the URL before notifying consumers, including repeated assignments', () => {
    const document = createTestDocument();
    const url = parseURL('https://example.test/new/').url!;
    const respond = vi.spyOn(document, 'respondToBaseURLChanges').mockImplementation(() => {
      expect(document.url).toBe(url);
      expect(document.getBaseURL()).toBe(url);
    });

    document.setURL(url);
    document.setURL(url);
    expect(respond).toHaveBeenCalledTimes(2);
  });

  it('retains a frozen base when setting the document URL', () => {
    const document = createTestDocument();
    document.url = parseURL('https://example.test/old/page').url!;
    // Isolate URL selection from the unimplemented base-change consumers.
    const respond = vi.spyOn(document, 'respondToBaseURLChanges').mockImplementation(() => {});
    const base = document.createElementNS(HTML_NAMESPACE, 'base') as HTMLBaseElementImpl;
    base.setAttributeValue('href', 'assets/');
    document.appendChild(base);
    const frozen = document.getBaseURL();
    respond.mockClear();

    document.setURL(parseURL('https://example.test/new/page').url!);

    expect(document.getBaseURL()).toBe(frozen);
    expect(document.baseURI).toBe('https://example.test/old/assets/');
    expect(base.href).toBe('https://example.test/new/assets/');
    expect(respond).toHaveBeenCalledOnce();
  });

  it('publishes the new frozen base before notifying consumers', () => {
    const document = createTestDocument();
    document.url = parseURL('https://example.test/').url!;
    const bases: string[] = [];
    vi.spyOn(document, 'respondToBaseURLChanges').mockImplementation(() => {
      bases.push(document.baseURI);
    });
    const base = document.createElementNS(HTML_NAMESPACE, 'base') as HTMLBaseElementImpl;
    base.setAttributeValue('href', '/first/');
    document.appendChild(base);
    base.setAttributeValue('href', '/second/');
    base.setAttributeValue('href', '/second/');

    expect(bases).toEqual(['https://example.test/first/', 'https://example.test/second/']);
  });

  it('keeps the frozen-base algorithm\'s early return for rejected URLs', () => {
    const document = createTestDocument();
    document.url = parseURL('https://example.test/').url!;
    const respond = vi.spyOn(document, 'respondToBaseURLChanges').mockImplementation(() => {});
    const base = document.createElementNS(HTML_NAMESPACE, 'base') as HTMLBaseElementImpl;
    base.setAttributeValue('href', 'data:text/plain,content');
    document.appendChild(base);

    expect(document.getBaseURL()).toBe(document.url);
    expect(respond).not.toHaveBeenCalled();
  });

  it('can respond to a URL change without scripts or loaded resources', () => {
    const document = createTestDocument();
    document.setURL(parseURL('https://example.test/').url!);
    expect(document.baseURI).toBe('https://example.test/');
  });

  it('updates UI, link state, prepared scripts, and speculative loads in order', () => {
    const document = createTestDocument();
    const root = document.createElementNS(HTML_NAMESPACE, 'div');
    document.appendChild(root);
    const shadow = root.attachShadow({
      mode: 'closed', delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false,
    });
    const shadowScript = createScript(document);
    shadowScript.appendChild(document.createTextNode('shadow'));
    // Only immediate text children supply the script source, not nested elements or comments.
    const child = document.createElementNS(HTML_NAMESPACE, 'span');
    child.appendChild(document.createTextNode('ignored'));
    shadowScript.appendChild(child);
    shadowScript.appendChild(document.createComment('ignored'));
    shadow.appendChild(shadowScript);
    const lightScript = createScript(document);
    lightScript.appendChild(document.createTextNode('light'));
    root.appendChild(lightScript);
    const pending = createScript(document);
    root.appendChild(pending);
    const failed = createScript(document);
    failed.result = null;
    root.appendChild(failed);
    const detached = createScript(document);
    for (const script of [shadowScript, lightScript, detached]) {
      script.result = document.createSpeculationRulesParseResult('');
    }

    const order: string[] = [];
    const url = parseURL('https://example.test/changed/').url!;
    const updateUI = vi.spyOn(document.env.userAgent, 'updateURLDisplays').mockImplementation((target) => {
      expect(target).toBe(document);
      expect(target.getBaseURL()).toBe(url);
      order.push('ui');
    });
    const parse = vi.spyOn(document, 'createSpeculationRulesParseResult').mockImplementation((input) => {
      expect(document.getBaseURL()).toBe(url);
      order.push(input);
      return new SpeculationRulesParseResult();
    });
    vi.spyOn(document, 'updateLinkStates').mockImplementation(() => { order.push('links'); });
    const update = vi.spyOn(document.getRelevantGlobalObject()!, 'updateSpeculationRules')
      .mockImplementation(() => { order.push('update'); });
    vi.spyOn(document, 'considerSpeculativeLoads').mockImplementation(() => { order.push('loads'); });

    document.setURL(url);

    expect(order).toEqual(['ui', 'links', 'shadow', 'update', 'light', 'update', 'loads']);
    expect(updateUI).toHaveBeenCalledOnce();
    expect(update.mock.calls[0]![0]).toBe(shadowScript.result);
    expect(update.mock.calls[0]![1]).toBe(parse.mock.results[0]!.value);
    expect(update.mock.calls[1]![0]).toBe(lightScript.result);
    expect(update.mock.calls[1]![1]).toBe(parse.mock.results[1]!.value);
  });

  it('reparses an adopted script in its current document and updates its original Window', () => {
    const original = createTestDocument();
    const document = createTestDocument();
    const script = createScript(original);
    script.appendChild(original.createTextNode('{"prefetch":[]}'));
    const oldResult = original.createSpeculationRulesParseResult('');
    script.result = oldResult;
    document.appendChild(script);

    const parse = vi.spyOn(document, 'createSpeculationRulesParseResult');
    const originalUpdate = vi.spyOn(original.getRelevantGlobalObject()!, 'updateSpeculationRules');
    const destinationUpdate = vi.spyOn(document.getRelevantGlobalObject()!, 'updateSpeculationRules');

    document.respondToBaseURLChanges();

    expect(script.nodeDocument).toBe(document);
    expect(parse).toHaveBeenCalledExactlyOnceWith('{"prefetch":[]}');
    expect(originalUpdate).toHaveBeenCalledOnce();
    expect(originalUpdate.mock.calls[0]![0]).toBe(oldResult);
    expect(originalUpdate.mock.calls[0]![1]).toBe(parse.mock.results[0]!.value);
    expect(destinationUpdate).not.toHaveBeenCalled();
  });

  it.each(['classic', 'module'] as const)('does not reparse a failed %s script as speculation rules', (kind) => {
    const document = createTestDocument();
    const script = createScript(document);
    document.appendChild(script);
    const baseURL = parseURL('https://example.test/original/').url!;
    const parseError = new SyntaxError('Script parse failure');
    const result: ClassicScript | JavaScriptModuleScript = kind === 'classic'
      ? { ...createScriptState(document.env), mutedErrors: false, originalSourceURL: null } : createScriptState(document.env);
    result.parseError = parseError;
    result.errorToRethrow = parseError;
    result.baseURL = baseURL;
    script.scriptType = kind;
    script.result = result;
    const oldResult = script.result;
    const parse = vi.spyOn(document, 'createSpeculationRulesParseResult');
    const update = vi.spyOn(script.getRelevantGlobalObject(), 'updateSpeculationRules');

    document.setURL(parseURL('https://example.test/changed/').url!);

    expect(parse).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(script.result).toBe(oldResult);
    expect(oldResult.baseURL).toBe(baseURL);
  });
});

function createScript(document: DocumentImpl): HTMLScriptElementImpl {
  const element = document.createElementNS(HTML_NAMESPACE, 'script');
  if (!HTMLScriptElementImpl.is(element)) throw new Error('Expected an HTML script implementation');
  return element;
}
