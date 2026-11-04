import { describe, expect, it } from 'vitest';

import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { parseURL } from '../../../../src/url/index';

describe('session history entry state', () => {
  it('initializes separate classic History and Navigation API state', () => {
    const document = TopLevelTraversable.create(new UserAgent(), null, '').activeDocument!;
    const entry = document.env.createSessionHistoryEntry(document.url, DocumentState.create(document));

    expect(entry).toHaveProperty('classicHistoryAPIState');
    expect(entry.document).toBe(document);
    expect(document.env.deserialize(entry.classicHistoryAPIState)).toBeNull();
    expect(document.env.deserialize(entry.navigationAPIState)).toBeUndefined();
    expect(entry.classicHistoryAPIState).not.toBe(entry.navigationAPIState);
    expect(entry.scrollRestorationMode).toBe('auto');
    expect(entry.scrollPositionData).toBeNull();
    expect(entry.persistedUserState).toBeNull();
    expect(entry.step).toBe('pending');
  });

  it('creates an unpopulated entry with an explicit URL and serialization environment', () => {
    const env = new UserAgent().sandbox;
    const url = parseURL('https://example.test/not-loaded?query#fragment').url!;
    const state = new DocumentState();
    const entry = env.createSessionHistoryEntry(url, state);

    expect(entry.url).toBe(url);
    expect(entry.documentState).toBe(state);
    expect(entry.document).toBeNull();
    expect(env.deserialize(entry.classicHistoryAPIState)).toBeNull();
    expect(env.deserialize(entry.navigationAPIState)).toBeUndefined();
    expect(entry.scrollRestorationMode).toBe('auto');
    expect(entry.scrollPositionData).toBeNull();
    expect(entry.persistedUserState).toBeNull();
  });

  it('retains independent URLs, keys, and state for entries sharing one Document state', () => {
    const document = TopLevelTraversable.create(new UserAgent(), null, '').activeDocument!;
    const { env } = document;
    const state = DocumentState.create(document);
    const first = env.createSessionHistoryEntry(document.url, state);
    const nextURL = parseURL('about:blank#next').url!;
    const second = env.createSessionHistoryEntry(nextURL, state);
    const data = { position: 5 };
    // Supply the already-serialized values that the future history-update algorithm will retain.
    first.classicHistoryAPIState = env.serializeForStorage(data);
    second.navigationAPIState = env.serializeForStorage({ panel: 'details' });
    first.scrollRestorationMode = 'manual';
    data.position = 99;

    expect(first.url).toBe(document.url);
    expect(second.url).toBe(nextURL);
    expect(document.URL).toBe('about:blank');
    expect(first.documentState).toBe(second.documentState);
    expect(env.deserialize(first.classicHistoryAPIState)).toEqual({ position: 5 });
    expect(env.deserialize(first.navigationAPIState)).toBeUndefined();
    expect(env.deserialize(second.classicHistoryAPIState)).toBeNull();
    expect(env.deserialize(second.navigationAPIState)).toEqual({ panel: 'details' });
    expect(second.scrollRestorationMode).toBe('auto');
    const identifiers = [first.navigationAPIKey, first.navigationAPIID, second.navigationAPIKey, second.navigationAPIID];
    expect(new Set(identifiers).size).toBe(4);
    for (const id of identifiers) {
      expect(id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    }

    // The entry's Document is always read from its shared state, including after destruction.
    first.documentState.document = null;
    expect(first.document).toBeNull();
    expect(second.document).toBeNull();
    expect(first.url).toBe(document.url);
    expect(second.url).toBe(nextURL);
    expect(env.deserialize(first.classicHistoryAPIState)).toEqual({ position: 5 });
    const replacement = env.createDocument();
    second.documentState.document = replacement;
    expect(first.document).toBe(replacement);
    expect(second.document).toBe(replacement);
  });
});
