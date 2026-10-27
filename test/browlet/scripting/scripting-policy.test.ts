import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { createSessionHistoryEntry } from '../../../src/browlet/browsing/navigation/session-history';
import { createDocumentState } from '../../../src/browlet/browsing/navigation/document-state';
import { getRelevantRealm } from '../../support/browlet-binding';

afterEach(() => vi.restoreAllMocks());

describe('HTML scripting enablement', () => {
  it('checks the current preference, Window sandbox flags, and BiDi override', () => {
    const { env, document } = fixture();
    const automation = vi.spyOn(env.userAgent, 'webDriverBiDiScriptingIsEnabled').mockReturnValue(true);
    expect(env.isScriptingEnabled()).toBe(true);
    expect(automation).toHaveBeenCalledExactlyOnceWith(env);

    env.userAgent.scriptingEnabled = false;
    expect(env.isScriptingEnabled()).toBe(false);
    env.userAgent.scriptingEnabled = true;
    document.activeSandboxingFlagSet.add('sandboxed-scripts');
    expect(env.isScriptingEnabled()).toBe(false);
    expect(automation).toHaveBeenCalledTimes(1);

    document.activeSandboxingFlagSet.clear();
    automation.mockReturnValue(false);
    expect(env.isScriptingEnabled()).toBe(false);
    automation.mockReturnValue(true);
    expect(env.isScriptingEnabled()).toBe(true);
  });

  it('distinguishes settings from Nodes and Windows without a browsing context', () => {
    const { env, document } = fixture();
    const node = document.createElement('div');
    const event = env.createEvent();
    expect(env.isScriptingEnabledFor(node)).toBe(true);
    expect(env.isScriptingEnabledFor(env.window)).toBe(true);

    document.browsingContext = null;
    expect(env.isScriptingEnabled()).toBe(true);
    expect(env.isScriptingEnabledFor(node)).toBe(false);
    expect(env.isScriptingEnabledFor(document)).toBe(false);
    expect(env.isScriptingEnabledFor(env.window)).toBe(false);
    expect(env.isScriptingEnabledFor(event)).toBe(true);

    env.userAgent.scriptingEnabled = false;
    expect(env.isScriptingEnabledFor(event)).toBe(false);
  });

  it('uses the original settings but the current node document after adoption', () => {
    const source = fixture();
    const target = fixture();
    const node = source.document.createElement('div');
    target.document.adoptNode(node);
    target.document.activeSandboxingFlagSet.add('sandboxed-scripts');
    expect(source.env.isScriptingEnabledFor(node)).toBe(true);
    source.document.activeSandboxingFlagSet.add('sandboxed-scripts');
    expect(source.env.isScriptingEnabledFor(node)).toBe(false);

    source.document.activeSandboxingFlagSet.clear();
    const detached = target.document.implementation.createHTMLDocument('detached');
    detached.adoptNode(node);
    expect(source.env.isScriptingEnabledFor(node)).toBe(false);
  });

  it('reads the Window\'s currently associated document when checking sandbox policy', () => {
    const { env, document } = fixture();
    document.activeSandboxingFlagSet.add('sandboxed-scripts');
    const replacement = env.createDocument();
    env.window.setAssociatedDocument(replacement);
    expect(env.isScriptingEnabled()).toBe(true);
    replacement.activeSandboxingFlagSet.add('sandboxed-scripts');
    expect(env.isScriptingEnabled()).toBe(false);
  });
});

describe('check if we can run script', () => {
  it('requires both fully active document state and enabled scripting', () => {
    const { env, document } = fixture();
    expect(env.canRunScript()).toBe(true);
    env.userAgent.scriptingEnabled = false;
    expect(env.canRunScript()).toBe(false);
    env.userAgent.scriptingEnabled = true;
    document.browsingContext = null;
    expect(env.canRunScript()).toBe(false);
  });

  it('checks document activity before consulting scripting policy', () => {
    const { env, document } = fixture();
    const navigable = document.getNodeNavigable()!;
    const replacement = env.createDocument();
    replacement.browsingContext = document.browsingContext;
    navigable.activeSessionHistoryEntry = createSessionHistoryEntry(createDocumentState(replacement));
    const scripting = vi.spyOn(env, 'isScriptingEnabled');
    expect(env.canRunScript()).toBe(false);
    expect(scripting).not.toHaveBeenCalled();
  });
});

function fixture() {
  const browser = new Browlet({ route: () => '', reporting: false });
  const env = getRelevantRealm(browser.window).env;
  return { env, document: env.window.document };
}
