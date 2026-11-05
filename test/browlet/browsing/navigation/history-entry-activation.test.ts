import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable, TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import { parseURL } from '../../../../src/url/index';
import { createManualUserAgent } from '../../../support/browlet-agent';

afterEach(() => { vi.restoreAllMocks(); });

describe('history-entry activation', () => {
  it('retains the persisted-state dependency before changing the active entry or Window', () => {
    const { top, previous, document, entry, context, env } = fixture();
    const activate = vi.spyOn(document, 'makeActive');
    expect(() => top.activateHistoryEntry(entry)).toThrow('Persisted history state capture is not implemented');
    expect(top.activeSessionHistoryEntry).toBe(previous);
    expect(context.activeDocument).toBe(previous.document);
    expect(env.executionReady).toBe(false);
    expect(activate).not.toHaveBeenCalled();
  });

  it.each(['hidden', 'visible'] as const)('activates a replacement Window before initializing visibility to %s', (visibility) => {
    const { top, previous, document, entry, context, env } = fixture();
    top.systemVisibilityState = visibility;
    const save = vi.spyOn(previous, 'savePersistedState').mockImplementation(() => {
      expect(top.activeSessionHistoryEntry).toBe(previous);
      expect(context.activeDocument).toBe(previous.document);
    });
    const activate = vi.spyOn(document, 'makeActive');
    const setVisibility = document.setInitialVisibilityState.bind(document);
    const initializeVisibility = vi.spyOn(document, 'setInitialVisibilityState').mockImplementation((state) => {
      expect(top.activeSessionHistoryEntry).toBe(entry);
      expect(context.activeDocument).toBe(document);
      expect(context.windowProxy.windowImplementation).toBe(env.window);
      expect(env.executionReady).toBe(true);
      setVisibility(state);
    });
    const visibilityEvent = vi.spyOn(document, 'fireEvent');

    top.activateHistoryEntry(entry);

    expect(save).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledOnce();
    expect(initializeVisibility).toHaveBeenCalledExactlyOnceWith(visibility);
    expect(document.visibilityState).toBe(visibility);
    expect(document.isFullyActive()).toBe(true);
    expect(previous.document!.isFullyActive()).toBe(false);
    expect(visibilityEvent).not.toHaveBeenCalled();
    // These belong to history application and its later Document update, not activation.
    expect(top.currentSessionHistoryEntry).toBe(entry);
    expect(top.currentSessionHistoryStep).toBe(4);
    expect(document.latestEntry).toBeNull();
  });

  it.each(['missing', 'initial-about-blank'] as const)('rejects an invalid %s target after saving the displayed entry', (kind) => {
    const { top, previous, document, entry, context } = fixture();
    const save = vi.spyOn(previous, 'savePersistedState').mockImplementation(() => {});
    if (kind === 'missing') entry.documentState.document = null;
    else document.isInitialAboutBlank = true;
    expect(() => top.activateHistoryEntry(entry)).toThrow(kind === 'missing' ? 'populated Document' : 'initial about:blank');
    expect(save).toHaveBeenCalledOnce();
    expect(top.activeSessionHistoryEntry).toBe(previous);
    expect(context.activeDocument).toBe(previous.document);
  });

  it('activates a same-Document entry without restoring its state or advancing the joint step', () => {
    const { top, previous, context } = fixture();
    const document = previous.document!;
    const entry = document.env.createSessionHistoryEntry(parseURL('https://example.test/current#target').url!, previous.documentState);
    entry.classicHistoryAPIState = document.env.serializeForStorage({ next: true });
    document.latestEntry = previous;
    document.history.stateValue = 'retained';
    const save = vi.spyOn(previous, 'savePersistedState').mockImplementation(() => {});
    const current = top.currentSessionHistoryEntry;
    const window = context.windowProxy.windowImplementation;

    top.activateHistoryEntry(entry);

    expect(save).toHaveBeenCalledOnce();
    expect(top.activeSessionHistoryEntry).toBe(entry);
    expect(context.activeDocument).toBe(document);
    expect(context.windowProxy.windowImplementation).toBe(window);
    expect(document.history.stateValue).toBe('retained');
    expect(document.latestEntry).toBe(previous);
    expect(top.currentSessionHistoryEntry).toBe(current);
    expect(top.currentSessionHistoryStep).toBe(4);
  });

  it('uses the containing traversable visibility when activating a child', () => {
    const { top } = fixture();
    top.systemVisibilityState = 'hidden';
    const [, document] = BrowsingContext.createTopLevel(top.activeDocument!.env.userAgent);
    document.isInitialAboutBlank = false;
    const child = new Navigable(DocumentState.create(document), top);
    const previous = child.activeSessionHistoryEntry;
    const entry = document.env.createSessionHistoryEntry(document.url, previous.documentState);
    vi.spyOn(previous, 'savePersistedState').mockImplementation(() => {});
    child.activateHistoryEntry(entry);
    expect(child.activeSessionHistoryEntry).toBe(entry);
    expect(document.visibilityState).toBe('hidden');
    expect(top.activeDocument).not.toBe(document);
  });
});

/** Prepare a replacement in the same browsing context through the real Window composition. */
function fixture() {
  const userAgent = createManualUserAgent();
  const top = TopLevelTraversable.create(userAgent, null, '');
  const previous = top.activeSessionHistoryEntry;
  previous.document!.isInitialAboutBlank = false;
  previous.step = top.currentSessionHistoryStep = 4;
  const context = top.activeBrowsingContext!;
  const previousEnv = top.activeWindow!.env;
  const creationURL = parseURL('https://example.test/target').url!;
  const origin = previous.document!.origin;
  const env = userAgent.createWindowEnvironment({
    agent: previousEnv.realm.agent, userAgent, creationURL, origin, parent: null,
    topLevelCreationURL: creationURL, topLevelOrigin: origin, previousRealm: previousEnv.realm,
  });
  const document = env.createDocument();
  document.browsingContext = context;
  document.origin = origin;
  document.setURL(creationURL);
  env.window.setAssociatedDocument(document);
  const entry = env.createSessionHistoryEntry(creationURL, DocumentState.create(document));
  entry.step = 0;
  top.currentSessionHistoryEntry = entry;
  return { top, previous, document, entry, context, env };
}
