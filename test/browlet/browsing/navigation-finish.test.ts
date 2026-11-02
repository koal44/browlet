import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { NavigateEventImpl } from '../../../src/browlet/browsing/navigation/api/navigate-event';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import * as sessionHistory from '../../../src/browlet/browsing/navigation/state/index';
import { idlType } from '../../../src/web-idl/core/index';
import { unwrap } from '../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('Navigate-event finishing', () => {
  it.each([
    { fulfilled: false, focusChanged: false }, { fulfilled: true, focusChanged: false },
    { fulfilled: false, focusChanged: true }, { fulfilled: true, focusChanged: true },
  ])('finishes manual control (fulfilled=$fulfilled, focusChanged=$focusChanged)', async ({ fulfilled, focusChanged }) => {
    const { event, navigation } = await fixture();
    event.interceptionState = 'committed';
    event.focusResetBehavior = 'manual';
    event.scrollBehavior = 'manual';
    navigation.focusChangedDuringOngoingNavigation = focusChanged;
    event.finish(fulfilled);
    expect(event.interceptionState).toBe('finished');
    expect(navigation.focusChangedDuringOngoingNavigation).toBe(false);
  });

  it.each([false, true])('leaves nonintercepted events and focus bookkeeping unchanged (fulfilled=%s)', async (fulfilled) => {
    const { event, navigation } = await fixture();
    navigation.focusChangedDuringOngoingNavigation = true;
    event.finish(fulfilled);
    expect(event.interceptionState).toBe('none');
    expect(navigation.focusChangedDuringOngoingNavigation).toBe(true);
  });

  it('finishes a failed precommit without touching focus or scroll, and rejects repeated finishing', async () => {
    const { event, document, navigation } = await fixture();
    event.interceptionState = 'intercepted';
    event.navigationPrecommitHandlerList.push(() => document.env.InternalPromise.resolve(undefined, idlType.undefined));
    navigation.focusChangedDuringOngoingNavigation = true;
    event.finish(false);
    expect(event.interceptionState).toBe('finished');
    expect(navigation.focusChangedDuringOngoingNavigation).toBe(true);
    expect(() => event.finish(false)).toThrow('already finished');
  });

  it.each([false, true])('rejects invalid finishing before commit (fulfilled=%s)', async (fulfilled) => {
    const { event, document } = await fixture();
    event.interceptionState = 'intercepted';
    if (fulfilled) event.navigationPrecommitHandlerList.push(() => document.env.InternalPromise.resolve(undefined, idlType.undefined));
    expect(() => event.finish(fulfilled)).toThrow('Only failed precommit can finish before committing');
    expect(event.interceptionState).toBe('intercepted');
  });

  it.each([false, true])('resets focus before optional scrolling and only then finishes (fulfilled=%s)', async (fulfilled) => {
    const { event } = await fixture();
    const order: string[] = [];
    event.interceptionState = 'committed';
    vi.spyOn(event, 'potentiallyResetFocus').mockImplementation(() => { order.push('focus'); });
    vi.spyOn(event, 'processScrollBehavior').mockImplementation(() => {
      expect(event.interceptionState).toBe('committed');
      order.push('scroll');
      event.interceptionState = 'scrolled';
    });
    event.finish(fulfilled);
    expect(order).toEqual(fulfilled ? ['focus', 'scroll'] : ['focus']);
    expect(event.interceptionState).toBe('finished');
  });

  it('retains a changed focus with default reset policy, then clears the change flag', async () => {
    const { event, navigation } = await fixture();
    event.interceptionState = 'committed';
    event.scrollBehavior = 'manual';
    navigation.focusChangedDuringOngoingNavigation = true;
    event.finish(true);
    expect(event.interceptionState).toBe('finished');
    expect(navigation.focusChangedDuringOngoingNavigation).toBe(false);
  });

  it.each([null, 'after-transition'] as const)('keeps automatic focus reset explicit for policy %s', async (policy) => {
    const { event, navigation } = await fixture();
    event.interceptionState = 'committed';
    event.focusResetBehavior = policy;
    expect(() => event.finish(true)).toThrow('Navigation focus reset requires autofocus and focusing steps');
    expect(navigation.focusChangedDuringOngoingNavigation).toBe(false);
    expect(event.interceptionState).toBe('committed');
  });

  it('does not repeat scrolling after an explicit scroll, even with automatic policy', async () => {
    const { event } = await fixture();
    event.interceptionState = 'scrolled';
    event.focusResetBehavior = 'manual';
    const scroll = vi.spyOn(event, 'processScrollBehavior');
    event.finish(true);
    expect(scroll).not.toHaveBeenCalled();
    expect(event.interceptionState).toBe('finished');
  });

  it('does not scroll on handler failure even with the default scroll policy', async () => {
    const { event } = await fixture();
    event.interceptionState = 'committed';
    event.focusResetBehavior = 'manual';
    const scroll = vi.spyOn(event, 'processScrollBehavior');
    event.finish(false);
    expect(scroll).not.toHaveBeenCalled();
    expect(event.interceptionState).toBe('finished');
  });

  it('keeps the automatic-scroll dependency visible after selecting its scrolled state', async () => {
    const { event } = await fixture();
    event.interceptionState = 'committed';
    event.focusResetBehavior = 'manual';
    expect(() => event.finish(true)).toThrow('Document indicated-part selection is not implemented');
    expect(event.interceptionState).toBe('scrolled');
  });
});

describe('Navigate-event scroll effects', () => {
  it.each(['push', 'replace', 'reload'] as const)('selects the beginning or fragment for %s', async (type) => {
    const { event, document } = await fixture();
    event.navigationType = type;
    const target = document.createElement('div');
    const indicatedPart = vi.spyOn(document, 'indicatedPart', 'get');
    const beginning = vi.spyOn(document, 'scrollToBeginning').mockImplementation(() => {
      expect(event.interceptionState).toBe('scrolled');
    });
    const fragment = vi.spyOn(document, 'scrollToFragment').mockImplementation(() => {
      expect(event.interceptionState).toBe('scrolled');
    });
    for (const part of [null, 'top', target] as const) {
      event.interceptionState = 'committed';
      indicatedPart.mockReturnValue(part);
      event.processScrollBehavior();
    }
    expect(beginning).toHaveBeenCalledOnce();
    expect(fragment).toHaveBeenCalledTimes(2);
  });

  it('restores the active history entry, independently of the current traversal entry and History manual mode', async () => {
    const { event, document } = await fixture();
    event.navigationType = 'traverse';
    event.interceptionState = 'committed';
    const navigable = document.getNodeNavigable()!;
    const active = navigable.activeSessionHistoryEntry;
    active.scrollRestorationMode = 'manual';
    navigable.currentSessionHistoryEntry = { ...active };
    const restore = vi.spyOn(sessionHistory, 'restoreScrollPositionData').mockImplementation(() => {
      expect(event.interceptionState).toBe('scrolled');
    });
    event.processScrollBehavior();
    expect(restore).toHaveBeenCalledExactlyOnceWith(active);
  });

  it('retains the scroll restoration dependency on an unimplemented saved history position', async () => {
    const { event } = await fixture();
    event.navigationType = 'traverse';
    event.interceptionState = 'committed';
    expect(() => event.processScrollBehavior()).toThrow('Session-history scroll restoration is not implemented');
    expect(event.interceptionState).toBe('scrolled');
  });
});

async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/current');
  const document = unwrap<DocumentImpl>(browser.document);
  const navigation = document.getRelevantGlobalObject()!.navigation;
  const event = document.env.createEvent(NavigateEventImpl) as NavigateEventImpl;
  return { browser, document, navigation, event };
}
