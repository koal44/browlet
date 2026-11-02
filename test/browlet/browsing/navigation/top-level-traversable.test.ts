import { afterEach, describe, expect, it, vi } from 'vitest';

import { UserAgent } from '../../../../src/browlet/user-agent';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable, TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import type { PostResource } from '../../../../src/browlet/browsing/navigation/state/index';
import { InternalError } from '../../../../src/infra/index';
import { parseURL } from '../../../../src/url/index';

afterEach(() => { vi.restoreAllMocks(); });

describe('top-level traversable creation', () => {
  it('notifies automation after registering the initialized traversable and forwards the separate automation opener', () => {
    const userAgent = new UserAgent();
    const automationOpener = TopLevelTraversable.create(userAgent, null, 'initiator');
    const created = vi.spyOn(userAgent, 'webDriverBiDiNavigableCreated').mockImplementation((traversable, opener) => {
      expect(userAgent.topLevelTraversableSet.has(traversable as TopLevelTraversable)).toBe(true);
      expect(traversable.parent).toBeNull();
      expect(traversable.topLevelTraversable).toBe(traversable);
      expect(traversable.targetName).toBe('named-target');
      const entry = traversable.activeSessionHistoryEntry;
      expect(traversable.currentSessionHistoryEntry).toBe(entry);
      expect(entry.step).toBe(0);
      expect(entry.documentState.origin).toBe(traversable.activeDocument!.origin);
      expect(entry.documentState.initiatorOrigin).toBeNull();
      expect(traversable.traversable.sessionHistoryEntries).toEqual([entry]);
      expect(traversable.activeDocument!.visibilityState).toBe('visible');
      expect(traversable.activeBrowsingContext!.openerBrowsingContext).toBeNull();
      expect(opener).toBe(automationOpener);
    });

    const traversable = TopLevelTraversable.create(userAgent, null, 'named-target', automationOpener);

    expect(created).toHaveBeenCalledExactlyOnceWith(traversable, automationOpener);
  });

  it('supplies no automation opener when omitted and keeps registration scoped to the owning user agent', () => {
    const userAgent = new UserAgent();
    const otherUserAgent = new UserAgent();
    const created = vi.spyOn(userAgent, 'webDriverBiDiNavigableCreated');
    const traversable = TopLevelTraversable.create(userAgent, null, '');

    expect(created).toHaveBeenCalledExactlyOnceWith(traversable, null);
    expect(userAgent.topLevelTraversableSet).toEqual(new Set([traversable]));
    expect(otherUserAgent.topLevelTraversableSet.size).toBe(0);
  });

  it('does not register or announce a traversable when auxiliary context creation fails', () => {
    const userAgent = new UserAgent();
    const opener = TopLevelTraversable.create(userAgent, null, 'opener');
    const created = vi.spyOn(userAgent, 'webDriverBiDiNavigableCreated');
    const failure = new InternalError('auxiliary creation failed');
    vi.spyOn(BrowsingContext, 'createAuxiliary').mockImplementation(() => { throw failure; });

    expect(() => TopLevelTraversable.create(userAgent, opener.activeBrowsingContext, 'child')).toThrow(failure);
    expect(userAgent.topLevelTraversableSet).toEqual(new Set([opener]));
    expect(created).not.toHaveBeenCalled();
  });

  it.each(['omitted', 'null', 'POST'] as const)('navigates a fresh traversable from its own Document with %s resource', (kind) => {
    const userAgent = new UserAgent();
    const url = parseURL('https://example.test/initial').url!;
    const resource: PostResource | null = kind === 'POST'
      ? { requestBody: new Uint8Array([1, 2, 3]), requestContentType: 'text/plain' }
      : null;
    const order: string[] = [];
    vi.spyOn(userAgent, 'webDriverBiDiNavigableCreated').mockImplementation(() => { order.push('created'); });
    // Navigation owns fetching/security/history; this test checks only its real creation caller.
    const navigate = vi.spyOn(Navigable.prototype, 'navigate').mockImplementation(function(this: Navigable, destination, source, options) {
      order.push('navigate');
      expect(destination).toBe(url);
      expect(source).toBe(this.activeDocument);
      expect(source).not.toBeNull();
      expect(source!.URL).toBe('about:blank');
      expect(source!.isFullyActive()).toBe(true);
      expect(this.currentSessionHistoryEntry.step).toBe(0);
      expect(this.targetName).toBe('');
      expect(userAgent.topLevelTraversableSet.has(this as TopLevelTraversable)).toBe(true);
      expect(options).toEqual({ documentResource: resource });
      expect(options!.documentResource).toBe(resource);
    });

    const traversable = kind === 'omitted'
      ? userAgent.createFreshTopLevelTraversable(url)
      : userAgent.createFreshTopLevelTraversable(url, resource);

    expect(navigate.mock.contexts).toEqual([traversable]);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(url, traversable.activeDocument, { documentResource: resource });
    expect(order).toEqual(['created', 'navigate']);
    expect(traversable.isCreatedByWebContent).toBe(false);
  });
});
