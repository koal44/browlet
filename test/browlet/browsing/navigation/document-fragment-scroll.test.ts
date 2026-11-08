import { afterEach, describe, expect, it, vi } from 'vitest';

import { FetchResponse } from '../../../../src/fetch/index';
import { parseURL } from '../../../../src/url/index';
import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/top-level-traversable';
import { HTMLDocumentParser } from '../../../../src/browlet/html/parser/html-document-parser';
import { navigationAndTraversalTaskSource } from '../../../../src/browlet/scripting/tasks';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { runInHostTask } from '../../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('fragment scrolling during Document loading', () => {
  it('waits off the event loop, then scrolls on the owning navigation task', async () => {
    const { document, loop, wakeups, interested } = fixture();
    const order: string[] = [];
    interested.mockImplementation((target) => {
      expect(target).toBe(document);
      expect(loop.currentlyRunningTask?.source).toBe(navigationAndTraversalTaskSource);
      expect(loop.currentlyRunningTask?.document).toBe(document);
      order.push('interest');
      return true;
    });
    const scroll = vi.spyOn(document, 'scrollToFragment').mockImplementation(() => { order.push('scroll'); });
    vi.spyOn(document, 'indicatedPart', 'get').mockImplementation(() => { order.push('target'); return 'top'; });

    expect(document.tryToScrollToFragment()).toBeUndefined();
    expect(wakeups).toHaveLength(1);
    expect(wakeups[0]!.delay).toBe(50);
    expect(loop.runTaskTurn()).toBe(false);
    expect(order).toEqual([]);
    wakeups.shift()!.steps();
    expect(order).toEqual([]);
    await runInHostTask(() => { expect(loop.runTaskTurn()).toBe(true); });
    expect(order).toEqual(['interest', 'scroll', 'target']);
    expect(scroll).toHaveBeenCalledOnce();
    expect(wakeups).toEqual([]);
  });

  it.each(['missing', 'stopped', 'aborted'] as const)('rechecks the %s parser when the queued task executes', async (state) => {
    const { document, parser, loop, wakeups, interested } = fixture();
    const scroll = vi.spyOn(document, 'scrollToFragment');
    document.tryToScrollToFragment();
    wakeups.shift()!.steps();
    if (state === 'missing') parser.detach();
    else if (state === 'stopped') parser.stopped = true;
    else parser.abort();

    await runInHostTask(() => { expect(loop.runTaskTurn()).toBe(true); });
    expect(interested).not.toHaveBeenCalled();
    expect(scroll).not.toHaveBeenCalled();
    expect(wakeups).toEqual([]);
  });

  it('checks user interest after the wait and stops without selecting or scrolling a target', async () => {
    const { document, loop, wakeups, interested } = fixture();
    const scroll = vi.spyOn(document, 'scrollToFragment');
    const target = vi.spyOn(document, 'indicatedPart', 'get');
    document.tryToScrollToFragment();
    expect(interested).not.toHaveBeenCalled();
    wakeups.shift()!.steps();
    interested.mockReturnValue(false);
    await runInHostTask(() => { expect(loop.runTaskTurn()).toBe(true); });
    expect(interested).toHaveBeenCalledExactlyOnceWith(document);
    expect(scroll).not.toHaveBeenCalled();
    expect(target).not.toHaveBeenCalled();
    expect(wakeups).toEqual([]);
  });

  it('waits again for a missing target and stops retrying when a later attempt finds it', async () => {
    const { document, loop, wakeups, interested } = fixture();
    const target = document.createElement('div');
    const scroll = vi.spyOn(document, 'scrollToFragment').mockImplementation(() => {});
    const indicated = vi.spyOn(document, 'indicatedPart', 'get').mockReturnValue(null);
    document.tryToScrollToFragment();
    wakeups.shift()!.steps();
    await runInHostTask(() => { expect(loop.runTaskTurn()).toBe(true); });
    expect(scroll).toHaveBeenCalledOnce();
    expect(wakeups).toHaveLength(1);
    expect(wakeups[0]!.delay).toBe(50);
    expect(loop.runTaskTurn()).toBe(false);
    indicated.mockReturnValue(target);
    wakeups.shift()!.steps();
    await runInHostTask(() => { expect(loop.runTaskTurn()).toBe(true); });
    expect(interested).toHaveBeenCalledTimes(2);
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(wakeups).toEqual([]);
  });

  it('reads the current indicated part after scrolling, including changes during that operation', async () => {
    const { document, loop, wakeups } = fixture();
    const indicated = vi.spyOn(document, 'indicatedPart', 'get').mockReturnValue(null);
    vi.spyOn(document, 'scrollToFragment').mockImplementation(() => { indicated.mockReturnValue('top'); });
    document.tryToScrollToFragment();
    wakeups.shift()!.steps();
    await runInHostTask(() => { expect(loop.runTaskTurn()).toBe(true); });
    expect(indicated).toHaveBeenCalledOnce();
    expect(wakeups).toEqual([]);
  });

  it('stops a retry when parsing finishes during the delay', async () => {
    const { document, parser, loop, wakeups } = fixture();
    const scroll = vi.spyOn(document, 'scrollToFragment').mockImplementation(() => {});
    vi.spyOn(document, 'indicatedPart', 'get').mockReturnValue(null);
    document.tryToScrollToFragment();
    wakeups.shift()!.steps();
    await runInHostTask(() => { expect(loop.runTaskTurn()).toBe(true); });
    parser.stopped = true;
    wakeups.shift()!.steps();
    await runInHostTask(() => { expect(loop.runTaskTurn()).toBe(true); });
    expect(scroll).toHaveBeenCalledOnce();
    expect(wakeups).toEqual([]);
  });

  it('lets the existing task queue hold an inactive Document until it becomes active again', async () => {
    const { document, top, loop, wakeups, interested } = fixture();
    const retained = top.activeSessionHistoryEntry;
    const response = new FetchResponse();
    response.urlList.push(parseURL('https://example.test/other').url!);
    const params = top.createNavigationParams(response);
    const other = top.createAndInitializeDocument('html', 'text/html', params);
    top.activeSessionHistoryEntry = top.createHistoryEntry(other, params);
    other.makeActive();
    vi.spyOn(document, 'scrollToFragment').mockImplementation(() => {});
    vi.spyOn(document, 'indicatedPart', 'get').mockReturnValue('top');
    document.tryToScrollToFragment();
    wakeups.shift()!.steps();
    expect(loop.runTaskTurn()).toBe(false);
    expect(interested).not.toHaveBeenCalled();
    top.activeSessionHistoryEntry = retained;
    document.makeActive();
    await runInHostTask(() => { expect(loop.runTaskTurn()).toBe(true); });
    expect(interested).toHaveBeenCalledOnce();
    expect(wakeups).toEqual([]);
  });

  it('does not enqueue work after destruction has cleared the Document browsing context', () => {
    const { document, loop, wakeups, interested } = fixture();
    const queue = vi.spyOn(document.env, 'queueTask');
    document.tryToScrollToFragment();
    document.browsingContext = null;
    wakeups.shift()!.steps();
    expect(queue).not.toHaveBeenCalled();
    expect(loop.runTaskTurn()).toBe(false);
    expect(interested).not.toHaveBeenCalled();
  });

  it('does not retry a task discarded during Document teardown', () => {
    const { document, loop, wakeups, interested } = fixture();
    document.tryToScrollToFragment();
    wakeups.shift()!.steps();
    loop.removeTasksForDocument(document);
    expect(loop.runTaskTurn()).toBe(false);
    expect(wakeups).toEqual([]);
    expect(interested).not.toHaveBeenCalled();
  });

  it.each(['interest', 'scrolling', 'MIME selection'] as const)('leaves the %s owner explicitly unfinished', async (owner) => {
    const { document, loop, wakeups, interested } = fixture();
    if (owner === 'interest') interested.mockRestore();
    if (owner === 'scrolling') document.url.fragment = '';
    if (owner === 'MIME selection') {
      document.type = 'xml';
      document.url.fragment = 'target';
    }
    const errors = {
      interest: 'Fragment scrolling user-interest policy is not implemented',
      scrolling: 'Document viewport scrolling is not implemented',
      'MIME selection': 'Non-HTML Document fragment selection is not implemented',
    };
    document.tryToScrollToFragment();
    wakeups.shift()!.steps();
    await runInHostTask(() => { expect(() => loop.runTaskTurn()).toThrow(errors[owner]); });
    expect(wakeups).toEqual([]);
  });
});

/** Control only native wake-ups and the unfinished user-interest owner; retain real parser and task state. */
function fixture() {
  const userAgent = createManualUserAgent();
  const wakeups: { delay: number; steps: () => void; }[] = [];
  userAgent.timerHost = {
    scheduleTimeout(delay, steps) {
      const wakeup = { delay, steps };
      wakeups.push(wakeup);
      return { remove: () => { wakeups.splice(wakeups.indexOf(wakeup), 1); } };
    },
  };
  const top = TopLevelTraversable.create(userAgent, null, '');
  const document = top.activeDocument!;
  const parser = new HTMLDocumentParser(document, () => {});
  const interested = vi.spyOn(userAgent, 'isUserInterestedInFragmentScrolling').mockReturnValue(true);
  return { userAgent, top, document, parser, loop: document.env.responsibleEventLoop, wakeups, interested };
}
