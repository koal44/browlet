import { afterEach, describe, expect, it, vi } from 'vitest';

import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/top-level-traversable';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import { PolicyContainer } from '../../../../src/browlet/browsing/policy/index';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { internalType } from '../../../../src/infra/index';
import { parseURL } from '../../../../src/url/index';

afterEach(() => { vi.restoreAllMocks(); });

describe('Document state', () => {
  it('starts unpopulated with the specified defaults and an independent nested-history list', () => {
    const state = new DocumentState();
    expect(state).toMatchObject({
      document: null, historyPolicyContainer: null, requestReferrer: undefined,
      requestReferrerPolicy: 'strict-origin-when-cross-origin', initiatorOrigin: null,
      origin: null, aboutBaseURL: null, nestedHistories: [], resource: null,
      reloadPending: false, everPopulated: false, navigableTargetName: '', notRestoredReasons: null,
    });

    const other = new DocumentState();
    state.nestedHistories.push({ id: Symbol('child'), entries: [] });
    expect(other.nestedHistories).toEqual([]);
    expect(() => other.evictDocument()).not.toThrow();
  });

  it('retains a supplied Document without inferring navigation metadata or conflating the referrer policies', () => {
    const document = new UserAgent().sandbox.createDocument();
    const state = DocumentState.create(document);
    expect(state).toBeInstanceOf(DocumentState);
    expect(state.document).toBe(document);
    expect(state.origin).toBeNull();
    expect(state.everPopulated).toBe(false);

    state.historyPolicyContainer = new PolicyContainer();
    state.requestReferrerPolicy = 'no-referrer';
    state.historyPolicyContainer.referrerPolicy = 'unsafe-url';
    expect(state.requestReferrerPolicy).toBe('no-referrer');
    state.requestReferrer = null;
    expect(state.requestReferrer).toBeNull();
    const referrer = parseURL('https://example.test/source').url!;
    state.requestReferrer = referrer;
    expect(state.requestReferrer).toBe(referrer);
  });

  it('refuses eviction of a fully active Document before requesting destruction', () => {
    const navigable = TopLevelTraversable.create(new UserAgent(), null, '');
    const state = navigable.activeSessionHistoryEntry.documentState;
    const document = navigable.activeDocument!;
    const destroy = vi.spyOn(document, 'destroyAndDescendants');

    expect(document.isFullyActive()).toBe(true);
    expect(() => state.evictDocument()).toThrow('A fully active Document cannot be evicted');
    expect(destroy).not.toHaveBeenCalled();
    expect(state.document).toBe(document);
  });

  it('delegates inactive eviction without clearing the Document before teardown', () => {
    const document = new UserAgent().sandbox.createDocument();
    const state = DocumentState.create(document);
    const destroy = vi.spyOn(document, 'destroyAndDescendants')
      .mockReturnValue(document.env.userAgent.HostPromise.resolve(undefined, internalType<void>()));

    expect(document.isFullyActive()).toBe(false);
    state.evictDocument();
    expect(destroy).toHaveBeenCalledExactlyOnceWith();
    expect(state.document).toBe(document);

  });

  it('retains each Document\'s latest committed entry independently of the active navigable', () => {
    const navigable = TopLevelTraversable.create(new UserAgent(), null, '');
    const params = navigable.createNavigationParamsFromSource(parseURL('https://example.test/first').url!);
    const document = navigable.createAndInitializeDocument('html', 'text/html', params);
    const entry = navigable.createHistoryEntry(document, params);

    expect(document.latestEntry).toBeNull();
    navigable.finalizeCrossDocumentNavigation('replace', params.userInvolvement, entry);
    expect(document.latestEntry).toBe(entry);

    const nextParams = navigable.createNavigationParamsFromSource(parseURL('https://example.test/next').url!);
    const nextDocument = navigable.createAndInitializeDocument('html', 'text/html', nextParams);
    const nextEntry = navigable.createHistoryEntry(nextDocument, nextParams);
    expect(nextDocument.latestEntry).toBeNull();
    navigable.finalizeCrossDocumentNavigation('push', nextParams.userInvolvement, nextEntry);

    expect(document.isFullyActive()).toBe(false);
    expect(document.latestEntry).toBe(entry);
    expect(nextDocument.latestEntry).toBe(nextEntry);
    expect(navigable.activeSessionHistoryEntry).toBe(nextEntry);
  });
});
