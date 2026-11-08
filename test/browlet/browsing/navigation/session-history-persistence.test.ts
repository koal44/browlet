import { afterEach, describe, expect, it, vi } from 'vitest';

import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/top-level-traversable';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import type { Window } from '../../../../src/browlet/platform';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { project } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('persisted history state', () => {
  it('requests restoration for an automatic entry without Navigation suppression', () => {
    const { entry } = fixture();
    const restore = vi.spyOn(entry, 'restoreScrollPositionData').mockImplementation(() => {});
    expect(entry.restorePersistedState()).toBeUndefined();
    expect(restore).toHaveBeenCalledExactlyOnceWith();
    expect(entry.persistedUserState).toBeNull();
  });

  it('honors the live History mode before consulting Navigation', () => {
    const { document, entry, platform } = fixture();
    const restore = vi.spyOn(entry, 'restoreScrollPositionData').mockImplementation(() => {});
    platform.history.scrollRestoration = 'manual';
    const global = vi.spyOn(document, 'getRelevantGlobalObject');
    entry.restorePersistedState();
    expect(global).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    platform.history.scrollRestoration = 'auto';
    entry.restorePersistedState();
    expect(restore).toHaveBeenCalledOnce();
  });

  it('suppresses automatic restoration until the owning Navigation releases it', () => {
    const { entry, navigation } = fixture();
    const restore = vi.spyOn(entry, 'restoreScrollPositionData').mockImplementation(() => {});
    navigation.suppressNormalScrollRestorationDuringOngoingNavigation = true;
    entry.restorePersistedState();
    expect(restore).not.toHaveBeenCalled();
    expect(navigation.suppressNormalScrollRestorationDuringOngoingNavigation).toBe(true);
    navigation.suppressNormalScrollRestorationDuringOngoingNavigation = false;
    entry.restorePersistedState();
    expect(restore).toHaveBeenCalledOnce();
  });

  it('uses the entry Document after repopulation, not its construction environment', () => {
    const first = fixture();
    const replacement = fixture();
    first.entry.documentState.document = replacement.document;
    replacement.navigation.suppressNormalScrollRestorationDuringOngoingNavigation = true;
    const restore = vi.spyOn(first.entry, 'restoreScrollPositionData').mockImplementation(() => {});
    first.entry.restorePersistedState();
    expect(restore).not.toHaveBeenCalled();
    replacement.navigation.suppressNormalScrollRestorationDuringOngoingNavigation = false;
    first.navigation.suppressNormalScrollRestorationDuringOngoingNavigation = true;
    first.entry.restorePersistedState();
    expect(restore).toHaveBeenCalledOnce();
  });

  it('requires a populated entry only when restoration needs its Document', () => {
    const { document } = fixture();
    const empty = document.env.createSessionHistoryEntry(document.url, new DocumentState());
    expect(() => empty.restorePersistedState()).toThrow('History restoration requires a populated entry');
    expect(() => empty.restoreScrollPositionData()).toThrow('Scroll restoration requires a populated history entry');
    empty.scrollRestorationMode = 'manual';
    expect(empty.restorePersistedState()).toBeUndefined();
  });

  it('requires the Document Window instead of borrowing another Navigation', () => {
    const { document, entry } = fixture();
    vi.spyOn(document, 'getRelevantGlobalObject').mockReturnValue(null);
    expect(() => entry.restorePersistedState()).toThrow('History restoration requires the Document Window');
  });

  it('stops scroll restoration after user scrolling without clearing that state', () => {
    const { document, entry } = fixture();
    expect(document.hasBeenScrolledByUser).toBe(false);
    document.hasBeenScrolledByUser = true;
    expect(entry.restoreScrollPositionData()).toBeUndefined();
    expect(entry.restorePersistedState()).toBeUndefined();
    expect(document.hasBeenScrolledByUser).toBe(true);
  });

  it('keeps programmatic scroll events separate from actual user scrolling', () => {
    const { document, platform } = fixture();
    platform.dispatchEvent(new platform.Event('scroll'));
    platform.document.dispatchEvent(new platform.Event('scroll'));
    expect(document.hasBeenScrolledByUser).toBe(false);
  });

  it('keeps the lower-level restoration path independent of automatic-restoration gates', () => {
    const { document, entry, navigation } = fixture();
    entry.scrollRestorationMode = 'manual';
    navigation.suppressNormalScrollRestorationDuringOngoingNavigation = true;
    const global = vi.spyOn(document, 'getRelevantGlobalObject');
    expect(() => entry.restoreScrollPositionData()).toThrow('Session-history scroll restoration is not implemented');
    expect(global).not.toHaveBeenCalled();
  });

  it('does not mistake missing scroll data for successful automatic restoration', () => {
    const { entry } = fixture();
    expect(entry.scrollPositionData).toBeNull();
    expect(() => entry.restorePersistedState()).toThrow('Session-history scroll restoration is not implemented');
  });

  it.each(['auto', 'manual'] as const)('keeps capture explicit even with %s restoration', (mode) => {
    const { entry } = fixture();
    entry.scrollRestorationMode = mode;
    expect(() => entry.savePersistedState()).toThrow('Persisted history state capture is not implemented');
    expect(entry.scrollPositionData).toBeNull();
    expect(entry.persistedUserState).toBeNull();
  });
});

function fixture() {
  const top = TopLevelTraversable.create(createManualUserAgent(), null, '');
  const entry = top.activeSessionHistoryEntry;
  const document = entry.document!;
  const window = document.getRelevantGlobalObject()!;
  return { document, entry, navigation: window.navigation, platform: project(window) as Window };
}
