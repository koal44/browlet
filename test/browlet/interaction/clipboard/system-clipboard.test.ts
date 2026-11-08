import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOpaqueOrigin, obtainURLOrigin, parseURL } from '../../../../src/url/index';
import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/index';
import type { ClipboardChangeEvent, Window } from '../../../../src/browlet/platform';
import { userInteractionTaskSource } from '../../../../src/browlet/scripting/index';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { getRelevantRealm, project } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('Clipboard §5.2.1: native change notification algorithms', () => {
  it('queues trusted Window delivery, limits formats and retains one frozen list with native flags', () => {
    const { clipboard, document, window, loop, state, read, received } = createFixture();
    state.types = ['text/plain', 'application/custom', 'text/html', 'text/plain', 'image/png', 'image/jpeg'];
    const timestamp = vi.spyOn(getRelevantRealm(window), 'eventTimeStamp').mockReturnValue(12.5);
    clipboard.queueChange(document);
    expect(read).not.toHaveBeenCalled(); expect(received).toEqual([]);
    expect([...loop.getTaskQueue(userInteractionTaskSource)]).toHaveLength(1);
    expect(loop.runTaskTurn()).toBe(true);
    const event = received[0]!;
    expect(event).toBeInstanceOf(window.ClipboardChangeEvent);
    expect(event.target).toBe(window);
    expect([event.type, event.isTrusted, event.bubbles, event.cancelable, event.composed, event.timeStamp])
      .toEqual(['clipboardchange', true, false, false, false, 12.5]);
    expect(event.types).toEqual(['text/plain', 'text/html', 'image/png']);
    expect(event.types).toBe(event.types); expect(Object.isFrozen(event.types)).toBe(true);
    expect(Object.getPrototypeOf(event.types)).toBe(getRelevantRealm(window).Array.prototype);
    expect(event.changeId).toBe(clipboard.generateChangeId(document, state.token));
    event.preventDefault(); expect(event.defaultPrevented).toBe(false);
    expect('clipboardData' in event).toBe(false); expect(timestamp).toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('reads the latest snapshot in the task and keeps its formats and identifier together', () => {
    const { clipboard, document, loop, state, read, received } = createFixture();
    clipboard.queueChange(document);
    state.types = ['image/png']; state.token = new Uint8Array([8]);
    loop.runTaskTurn();
    expect(received[0]!.types).toEqual(['image/png']);
    expect(received[0]!.changeId).toBe(clipboard.generateChangeId(document, new Uint8Array([8])));
    state.types[0] = 'text/html'; state.token[0] = 9;
    expect(received[0]!.types).toEqual(['image/png']);
    expect(received[0]!.changeId).not.toBe(clipboard.generateChangeId(document, state.token));
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('can report a cleared clipboard with empty types and a new identifier', () => {
    const { clipboard, document, loop, state, received } = createFixture();
    clipboard.queueChange(document); loop.runTaskTurn();
    state.types = []; state.token = new Uint8Array([2]);
    clipboard.queueChange(document); loop.runTaskTurn();
    expect(received[1]!.types).toEqual([]);
    expect(received[1]!.changeId).not.toBe(received[0]!.changeId);
  });

  it('requires activation or existing persistent consent before focus or native data is queried', () => {
    const { clipboard, document, windowImpl, loop, focus, permission, read, received } = createFixture();
    windowImpl.lastActivationTimestamp = Infinity;
    focus.mockReturnValue(false);
    clipboard.queueChange(document); loop.runTaskTurn();
    expect(permission).toHaveBeenCalledWith(document);
    expect(focus).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    expect(document.clipboardChangePending).toBe(false); expect(received).toEqual([]);
  });

  it('permits a notification with persistent consent when sticky activation is absent', () => {
    const { clipboard, document, windowImpl, loop, permission, received } = createFixture();
    windowImpl.lastActivationTimestamp = Infinity; permission.mockReturnValue(true);
    clipboard.queueChange(document); loop.runTaskTurn();
    expect(received).toHaveLength(1);
  });

  it('does not ask the unavailable permission owner when sticky activation already qualifies', () => {
    const { clipboard, document, loop, permission, received } = createFixture();
    permission.mockRestore();
    clipboard.queueChange(document); loop.runTaskTurn();
    expect(received).toHaveLength(1);
  });

  it('rejects native notifications for insecure Documents before any focus or permission access', () => {
    const { clipboard, document, loop, secure, focus, permission, read, received } = createFixture();
    secure.mockReturnValue(false);
    clipboard.queueChange(document); loop.runTaskTurn();
    expect(focus).not.toHaveBeenCalled(); expect(permission).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled(); expect(received).toEqual([]);
  });

  it('coalesces unfocused changes into one current-state notification when focus returns', () => {
    const { clipboard, document, loop, focus, read, state, received } = createFixture();
    focus.mockReturnValue(false);
    clipboard.queueChange(document); clipboard.queueChange(document);
    loop.runTaskTurn(); loop.runTaskTurn();
    expect(read).not.toHaveBeenCalled(); expect(document.clipboardChangePending).toBe(true);
    state.types = ['text/html']; state.token = new Uint8Array([3]); focus.mockReturnValue(true);
    document.notifySystemFocusGained(); document.notifySystemFocusGained();
    expect(received).toEqual([]);
    loop.runTaskTurn(); loop.runTaskTurn();
    expect(received).toHaveLength(1); expect(read).toHaveBeenCalledTimes(1);
    expect(received[0]!.types).toEqual(['text/html']);
    expect(received[0]!.changeId).toBe(clipboard.generateChangeId(document, state.token));
    expect(document.clipboardChangePending).toBe(false);
  });

  it('does nothing on a focus notification when no clipboard change is pending', () => {
    const { document, loop, read, focus, received } = createFixture();
    document.notifySystemFocusGained();
    expect(loop.runTaskTurn()).toBe(false); expect(focus).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled(); expect(received).toEqual([]);
  });

  it('keeps pending state if focus is lost again before the replay task runs', () => {
    const { document, loop, focus, read, received } = createFixture();
    document.clipboardChangePending = true;
    document.notifySystemFocusGained(); focus.mockReturnValue(false);
    loop.runTaskTurn();
    expect(document.clipboardChangePending).toBe(true); expect(read).not.toHaveBeenCalled();
    focus.mockReturnValue(true); document.notifySystemFocusGained(); loop.runTaskTurn();
    expect(received).toHaveLength(1); expect(document.clipboardChangePending).toBe(false);
  });

  it('rechecks withdrawn consent before replay and drops the pending notification', () => {
    const { clipboard, document, windowImpl, loop, focus, permission, read, received } = createFixture();
    windowImpl.lastActivationTimestamp = Infinity; permission.mockReturnValue(true); focus.mockReturnValue(false);
    clipboard.queueChange(document); loop.runTaskTurn();
    focus.mockReturnValue(true); document.notifySystemFocusGained(); permission.mockReturnValue(false);
    loop.runTaskTurn();
    expect(read).not.toHaveBeenCalled(); expect(received).toEqual([]);
    expect(document.clipboardChangePending).toBe(false);
  });

  it('lets a focused native notification satisfy an already queued focus replay', () => {
    const { clipboard, document, loop, received } = createFixture();
    document.clipboardChangePending = true;
    clipboard.queueChange(document); document.notifySystemFocusGained();
    loop.runTaskTurn(); loop.runTaskTurn();
    expect(received).toHaveLength(1); expect(document.clipboardChangePending).toBe(false);
  });

  it('clears pending state before listeners and allows a later change to be queued reentrantly', () => {
    const { clipboard, document, window, loop, state, received } = createFixture();
    document.clipboardChangePending = true;
    let flagDuringListener = true;
    window.addEventListener('clipboardchange', () => {
      flagDuringListener = document.clipboardChangePending;
      document.notifySystemFocusGained();
      state.token = new Uint8Array([2]); clipboard.queueChange(document);
    }, { once: true });
    document.notifySystemFocusGained(); loop.runTaskTurn();
    expect(flagDuringListener).toBe(false); expect(received).toHaveLength(1);
    loop.runTaskTurn(); expect(received).toHaveLength(2);
    expect(received[1]!.changeId).not.toBe(received[0]!.changeId);
    expect(loop.runTaskTurn()).toBe(false);
  });

  it('gates queued work on full activity and clears pending replay when the Document becomes inactive', () => {
    const { clipboard, document, loop, focus, read, received } = createFixture();
    document.clipboardChangePending = true;
    const active = vi.spyOn(document, 'isFullyActive').mockReturnValue(false);
    document.notifyFullyActiveStateChanged();
    expect(document.clipboardChangePending).toBe(false);
    clipboard.queueChange(document);
    expect(loop.runTaskTurn()).toBe(false); expect(read).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    active.mockReturnValue(true); document.notifyFullyActiveStateChanged();
    expect(loop.runTaskTurn()).toBe(true); expect(received).toHaveLength(1);
  });

  it('drops queued notifications and pending state during real Document destruction', () => {
    const { clipboard, document, loop, read, received } = createFixture();
    document.clipboardChangePending = true;
    document.env.realm.queueGlobalTask(userInteractionTaskSource, { run: () => { document.destroy(); } });
    clipboard.queueChange(document); document.notifySystemFocusGained();
    loop.runTaskTurn();
    expect(document.clipboardChangePending).toBe(false);
    expect(loop.runTaskTurn()).toBe(false); expect(read).not.toHaveBeenCalled();
    expect(received).toEqual([]);
  });

  it('retains named throwing dependencies for native state, persistent permission and HTML focus', () => {
    const { clipboard, document, read, permission, focus } = createFixture();
    read.mockRestore(); permission.mockRestore(); focus.mockRestore();
    expect(() => clipboard.readChangeState()).toThrow('Native clipboard change-state access');
    expect(() => clipboard.hasPersistentReadPermission(document)).toThrow('Persistent clipboard-read permission');
    expect(() => document.hasFocus()).toThrow('Document focus state');
  });
});

describe('Clipboard §5.2.1: storage-key change identifiers', () => {
  it('shares identifiers across Documents with equal storage keys within one UserAgent', () => {
    const first = createFixture(); const second = createFixture(first.userAgent);
    expect(first.clipboard).toBe(second.clipboard);
    const token = new Uint8Array([1, 2, 3]);
    const id = first.clipboard.generateChangeId(first.document, token);
    expect(second.clipboard.generateChangeId(second.document, token)).toBe(id);
    expect(id).toBeGreaterThanOrEqual(0n); expect(id).toBeLessThan(1n << 128n);
  });

  it('changes IDs for every native token and across UserAgent lifetimes', () => {
    const first = createFixture(); const second = createFixture();
    const token = new Uint8Array([1]);
    const id = first.clipboard.generateChangeId(first.document, token);
    expect(first.clipboard.generateChangeId(first.document, new Uint8Array([2]))).not.toBe(id);
    expect(second.clipboard.generateChangeId(second.document, token)).not.toBe(id);
  });

  it('distinguishes origin keys while ignoring path, storage access preference and document.domain', () => {
    const { clipboard, document, userAgent } = createFixture();
    const token = new Uint8Array([1]);
    const id = clipboard.generateChangeId(document, token);
    userAgent.storageEnabled = false;
    document.origin = obtainURLOrigin(parseURL('https://clipboard.test/another/path').url!);
    if (document.origin.kind === 'tuple') document.origin.domain = { kind: 'domain', value: 'test' };
    expect(clipboard.generateChangeId(document, token)).toBe(id);
    document.origin = obtainURLOrigin(parseURL('https://other.test/').url!);
    expect(clipboard.generateChangeId(document, token)).not.toBe(id);
  });

  it('preserves equal opaque identities without merging unrelated opaque origins', () => {
    const { clipboard, document } = createFixture(); const origin = createOpaqueOrigin();
    const token = new Uint8Array([1]); document.origin = origin;
    const id = clipboard.generateChangeId(document, token);
    document.origin = structuredClone(origin);
    expect(clipboard.generateChangeId(document, token)).toBe(id);
    document.origin = createOpaqueOrigin();
    expect(clipboard.generateChangeId(document, token)).not.toBe(id);
  });
});

function createFixture(userAgent = createManualUserAgent()) {
  const traversable = TopLevelTraversable.create(userAgent, null, '');
  const document: DocumentImpl = traversable.activeDocument!;
  document.origin = obtainURLOrigin(parseURL('https://clipboard.test/').url!);
  const windowImpl = traversable.activeWindow!;
  windowImpl.lastActivationTimestamp = 0;
  const window = project(windowImpl) as Window;
  // HTML focus and permission/native access are the narrow unfinished owner effects.
  const secure = vi.spyOn(document.env, 'isSecureContext', 'get').mockReturnValue(true);
  const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  const clipboard = userAgent.systemClipboard;
  const state = { types: ['text/plain'], token: new Uint8Array([1]) };
  const read = vi.spyOn(clipboard, 'readChangeState').mockImplementation(() => state);
  const permission = vi.spyOn(clipboard, 'hasPersistentReadPermission').mockReturnValue(false);
  const received: ClipboardChangeEvent[] = [];
  window.addEventListener('clipboardchange', (event) => { received.push(event as ClipboardChangeEvent); });
  return {
    userAgent, traversable, document, windowImpl, window, clipboard, state, read, permission, focus, secure, received,
    loop: document.env.responsibleEventLoop,
  };
}
