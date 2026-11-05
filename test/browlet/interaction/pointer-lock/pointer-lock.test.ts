import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Document, Element, HTMLElement, Window } from '../../../../src/browlet/platform';
import type { DocumentImpl, ElementImpl } from '../../../../src/browlet/dom/nodes/index';
import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/index';
import { PointerEventStream } from '../../../../src/browlet/interaction/index';
import { PointerEventImpl } from '../../../../src/browlet/interaction/events/index';
import { userInteractionTaskSource } from '../../../../src/browlet/scripting/index';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { project, unwrap } from '../../../support/browlet-binding';
import { observeBrowletPromise, performTestMicrotaskCheckpoint } from '../../test-runtime';

afterEach(() => { vi.restoreAllMocks(); });

describe('Pointer Lock §§2–5: lock state and public API', () => {
  it('projects the partial interfaces without exposing the options dictionary as a constructor', () => {
    const { a, platformDocument, window } = createFixture();
    expect(a.requestPointerLock.length).toBe(0);
    expect(platformDocument.exitPointerLock.length).toBe(0);
    expect(platformDocument.pointerLockElement).toBeNull();
    expect(platformDocument.onpointerlockchange).toBeNull();
    expect(platformDocument.onpointerlockerror).toBeNull();
    expect('PointerLockOptions' in window).toBe(false);
    const shadow = a.attachShadow({ mode: 'closed' });
    expect(shadow.pointerLockElement).toBeNull();
  });

  it('acquires in the parallel queue, fires the trusted notification, then fulfills the realm-owned promise', async () => {
    const f = createFixture();
    const trace: unknown[] = [];
    f.platformDocument.onpointerlockchange = function(event) {
      trace.push([this === f.platformDocument, event.target === f.platformDocument, event.isTrusted,
        event.bubbles, event.cancelable, event.composed, f.platformDocument.pointerLockElement === f.a]);
    };
    f.window.addEventListener('pointerlockchange', () => trace.push('bubbled'));
    const request = f.a.requestPointerLock();
    expect(request).toBeInstanceOf(f.document.env.realm.NativePromise);
    const observed = observeBrowletPromise(f.window, request).then((value) => { trace.push('fulfilled'); return value; });
    expect(f.lock.target).toBeNull();
    expect(f.acquire).not.toHaveBeenCalled();
    f.runParallel();
    expect(f.lock.target).toBe(unwrap(f.a));
    expect(f.platformDocument.pointerLockElement).toBe(f.a);
    expect(trace).toEqual([]);
    expect([...f.loop.getTaskQueue(userInteractionTaskSource)]).toHaveLength(1);
    f.loop.runTaskTurn();
    await expect(observed).resolves.toBeUndefined();
    expect(trace).toEqual([[true, true, true, false, false, false, true], 'fulfilled']);
    expect(f.acquire).toHaveBeenCalledWith(unwrap(f.a), { unadjustedMovement: false });
    expect(f.rawSupport).not.toHaveBeenCalled();
  });

  it('converts options once before queuing and keeps the converted snapshot private', async () => {
    const f = createFixture();
    let reads = 0;
    let raw = true;
    const request = f.a.requestPointerLock({ get unadjustedMovement() { reads++; return raw; } });
    raw = false;
    expect(reads).toBe(1);
    await finish(f, request);
    expect(f.rawSupport).toHaveBeenCalledOnce();
    expect(f.acquire).toHaveBeenCalledWith(unwrap(f.a), { unadjustedMovement: true });
    expect(reads).toBe(1);
  });

  it('reports a detached target through its Document without consulting focus or native acquisition', async () => {
    const f = createFixture();
    f.a.remove();
    const trace: unknown[] = [];
    f.platformDocument.onpointerlockerror = (event) => {
      trace.push([event.isTrusted, event.bubbles, event.cancelable, event.composed]);
    };
    const request = f.a.requestPointerLock();
    const observed = observeBrowletPromise(f.window, request).catch((error: unknown) => {
      trace.push('rejected');
      return error;
    });
    expect(f.focused).not.toHaveBeenCalled();
    expect(f.parallel).toHaveLength(0);
    f.loop.runTaskTurn();
    const error = await observed;
    expect(error).toBeInstanceOf(f.window.DOMException);
    expect(error).toMatchObject({ name: 'WrongDocumentError' });
    expect(trace).toEqual([[true, false, false, false], 'rejected']);
    expect(f.acquire).not.toHaveBeenCalled();
  });

  it('rejects an inactive Document and a nonfocused Document explicitly', async () => {
    const f = createFixture();
    const inactive = f.platformDocument.implementation.createHTMLDocument('');
    await expect(finish(f, inactive.documentElement!.requestPointerLock())).rejects.toMatchObject({ name: 'WrongDocumentError' });
    expect(f.focused).not.toHaveBeenCalled();
    f.focused.mockReturnValue(false);
    await expect(finish(f, f.a.requestPointerLock())).rejects.toMatchObject({ name: 'WrongDocumentError' });
    expect(f.activation).not.toHaveBeenCalled();
  });

  it('checks the element’s relevant global after adoption, while using its current Document for notification', async () => {
    const f = createFixture();
    const other = createContext(f.userAgent);
    const otherActivation = vi.spyOn(other.traversable.activeWindow!, 'hasTransientActivation').mockReturnValue(true);
    f.activation.mockReturnValue(false);
    other.platformDocument.documentElement!.appendChild(f.a);
    const errors = vi.fn();
    other.platformDocument.onpointerlockerror = errors;
    const request = f.a.requestPointerLock();
    expect(request).toBeInstanceOf(f.document.env.realm.NativePromise);
    const result = observeBrowletPromise(f.window, request);
    f.runParallel();
    f.loop.runTaskTurn();
    await expect(result).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(otherActivation).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledOnce();
  });

  it('rejects absent transient activation before sandbox and raw-motion checks', async () => {
    const f = createFixture();
    f.activation.mockReturnValue(false);
    f.document.activeSandboxingFlagSet.add('sandboxed-pointer-lock');
    await expect(finish(f, f.a.requestPointerLock({ unadjustedMovement: true }))).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(f.rawSupport).not.toHaveBeenCalled();
    expect(f.acquire).not.toHaveBeenCalled();
  });

  it('enforces sandbox policy even when the request has transient activation', async () => {
    const f = createFixture();
    f.document.activeSandboxingFlagSet.add('sandboxed-pointer-lock');
    await expect(finish(f, f.a.requestPointerLock({ unadjustedMovement: true }))).rejects.toMatchObject({ name: 'SecurityError' });
    expect(f.rawSupport).not.toHaveBeenCalled();
    expect(f.acquire).not.toHaveBeenCalled();
  });

  it('rejects unsupported raw motion before native acquisition', async () => {
    const f = createFixture();
    f.rawSupport.mockReturnValue(false);
    await expect(finish(f, f.a.requestPointerLock({ unadjustedMovement: true }))).rejects.toMatchObject({ name: 'NotSupportedError' });
    expect(f.acquire).not.toHaveBeenCalled();
  });

  it('reports native refusal without entering pointer lock', async () => {
    const f = createFixture();
    f.acquire.mockReturnValue(null);
    await expect(finish(f, f.a.requestPointerLock())).rejects.toMatchObject({ name: 'NotSupportedError' });
    expect(f.platformDocument.pointerLockElement).toBeNull();
  });

  it('retargets an equivalent request without reacquiring and serializes requests across Documents', async () => {
    const f = createFixture();
    const other = createContext(f.userAgent);
    vi.spyOn(other.traversable.activeWindow!, 'hasTransientActivation').mockReturnValue(true);
    const first = observeBrowletPromise(f.window, f.a.requestPointerLock());
    const second = observeBrowletPromise(f.window, f.b.requestPointerLock());
    const rejected = observeBrowletPromise(other.window, other.a.requestPointerLock()).catch((error: unknown) => error);
    expect(f.parallel).toHaveLength(1);
    f.runParallel();
    expect(f.acquire).toHaveBeenCalledOnce();
    expect(f.platformDocument.pointerLockElement).toBe(f.b);
    expect(other.platformDocument.pointerLockElement).toBeNull();
    f.loop.runTaskTurn();
    f.loop.runTaskTurn();
    other.loop.runTaskTurn();
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    const error = await rejected;
    expect(error).toBeInstanceOf(other.window.DOMException);
    expect(error).toMatchObject({ name: 'InvalidStateError' });
  });

  it('changes native options and preserves the current lock if that change fails', async () => {
    const f = createFixture();
    await finish(f, f.a.requestPointerLock());
    f.acquire.mockReturnValueOnce(null);
    await expect(finish(f, f.b.requestPointerLock({ unadjustedMovement: true }))).rejects.toMatchObject({ name: 'NotSupportedError' });
    expect(f.platformDocument.pointerLockElement).toBe(f.a);
    await finish(f, f.b.requestPointerLock({ unadjustedMovement: true }));
    expect(f.platformDocument.pointerLockElement).toBe(f.b);
    expect(f.acquire).toHaveBeenLastCalledWith(unwrap(f.b), { unadjustedMovement: true });
  });

  it('retargets closed shadow locks separately for each Document and shadow tree', async () => {
    const f = createFixture();
    const outer = f.a.attachShadow({ mode: 'closed' });
    const host = f.platformDocument.createElement('span');
    outer.appendChild(host);
    const inner = host.attachShadow({ mode: 'closed' });
    const target = f.platformDocument.createElement('span');
    inner.appendChild(target);
    const unrelated = f.b.attachShadow({ mode: 'open' });
    await finish(f, target.requestPointerLock());
    expect(f.platformDocument.pointerLockElement).toBe(f.a);
    expect(outer.pointerLockElement).toBe(host);
    expect(inner.pointerLockElement).toBe(target);
    expect(unrelated.pointerLockElement).toBeNull();
  });

  it('restores the saved screen position and clears lock synchronously before the exit notification', async () => {
    const f = createFixture();
    const position = { screenX: 10.5, screenY: -8.25, clientX: 2, clientY: 3 };
    f.acquire.mockReturnValue(position);
    await finish(f, f.a.requestPointerLock());
    position.screenX = 999;
    const notifications: boolean[] = [];
    f.platformDocument.onpointerlockchange = () => { notifications.push(f.platformDocument.pointerLockElement === null); };
    expect(f.platformDocument.exitPointerLock()).toBeUndefined();
    expect(f.restore).toHaveBeenCalledWith({ x: 10.5, y: -8.25 });
    expect(f.platformDocument.pointerLockElement).toBeNull();
    expect(notifications).toEqual([]);
    f.loop.runTaskTurn();
    expect(notifications).toEqual([true]);
    f.platformDocument.exitPointerLock();
    expect(f.restore).toHaveBeenCalledOnce();
    expect(f.loop.runTaskTurn()).toBe(false);
  });

  it('ignores another Document’s exit and grants the activation exemption only after its own successful API exit', async () => {
    const f = createFixture();
    const other = createContext(f.userAgent);
    await finish(f, f.a.requestPointerLock());
    other.platformDocument.exitPointerLock();
    expect(f.restore).not.toHaveBeenCalled();
    expect(f.platformDocument.pointerLockElement).toBe(f.a);
    f.platformDocument.exitPointerLock();
    f.loop.runTaskTurn();
    f.activation.mockReturnValue(false);
    await finish(f, f.b.requestPointerLock());
    expect(f.platformDocument.pointerLockElement).toBe(f.b);
    expect(f.activation).toHaveBeenCalledOnce();
  });

  it('does not grant an activation exemption for an unlocked exit or a non-API release', async () => {
    const f = createFixture();
    f.platformDocument.exitPointerLock();
    f.activation.mockReturnValue(false);
    await expect(finish(f, f.a.requestPointerLock())).rejects.toMatchObject({ name: 'NotAllowedError' });
    f.activation.mockReturnValue(true);
    await finish(f, f.a.requestPointerLock());
    f.lock.exitPointerLock(unwrap<ElementImpl>(f.a));
    f.loop.runTaskTurn();
    f.activation.mockReturnValue(false);
    await expect(finish(f, f.a.requestPointerLock())).rejects.toMatchObject({ name: 'NotAllowedError' });
  });

  it('releases pending pointer capture on acquisition and supplies the existing mouse/wheel lock queries', async () => {
    const f = createFixture();
    const stream = new PointerEventStream(7, false, true, (document) => f.userAgent.mouseInput.hasLockedElement(document));
    stream.activeDocument = f.document;
    stream.buttons = 1;
    f.traversable.pointerEventStreams.set(7, stream);
    f.b.setPointerCapture(7);
    const source = new PointerEventImpl('pointerdown', { pointerId: 7, buttons: 1 });
    stream.capture.processPendingPointerCapture(source);
    expect(stream.capture.targetOverride).toBe(unwrap(f.b));
    const loss = vi.fn();
    f.b.addEventListener('lostpointercapture', loss);
    await finish(f, f.a.requestPointerLock());
    expect(f.b.hasPointerCapture(7)).toBe(false);
    expect(loss).not.toHaveBeenCalled();
    stream.capture.processPendingPointerCapture(source);
    expect(loss).toHaveBeenCalledOnce();
    expect(() => f.b.setPointerCapture(7)).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    expect(f.userAgent.mouseInput.hasLockedElement(f.document)).toBe(true);
    expect(f.document.wheelInput.getLockedElement()).toBe(unwrap(f.a));
    const other = createContext(f.userAgent);
    expect(f.userAgent.mouseInput.hasLockedElement(other.document)).toBe(false);
    expect(other.document.wheelInput.getLockedElement()).toBeNull();
    f.platformDocument.exitPointerLock();
    expect(f.document.wheelInput.getLockedElement()).toBeNull();
  });

  it('keeps locks separate between UserAgents', async () => {
    const first = createFixture();
    const second = createFixture();
    await finish(first, first.a.requestPointerLock());
    expect(second.lock.target).toBeNull();
    await finish(second, second.b.requestPointerLock());
    expect(first.platformDocument.pointerLockElement).toBe(first.a);
    expect(second.platformDocument.pointerLockElement).toBe(second.b);
  });

  it('leaves focus and transient activation as explicit HTML dependencies', async () => {
    const focus = createFixture();
    focus.focused.mockRestore();
    await expect(finish(focus, focus.a.requestPointerLock())).rejects.toThrow(/Document focus state/);
    const activation = createFixture();
    activation.activation.mockRestore();
    await expect(finish(activation, activation.a.requestPointerLock())).rejects.toThrow(/transient activation/);
  });

  it('leaves raw-motion support, acquisition, and cursor restoration as explicit native dependencies', async () => {
    const raw = createFixture();
    raw.rawSupport.mockRestore();
    await expect(finish(raw, raw.a.requestPointerLock({ unadjustedMovement: true }))).rejects.toThrow(/raw-motion support/);
    const native = createFixture();
    native.acquire.mockRestore();
    void native.a.requestPointerLock();
    expect(native.runParallel).toThrow(/native cursor acquisition/);
    const restore = createFixture();
    await finish(restore, restore.a.requestPointerLock());
    restore.restore.mockRestore();
    expect(() => restore.platformDocument.exitPointerLock()).toThrow(/native cursor restoration/);
  });
});

describe('Pointer Lock §8: automatic unlock', () => {
  it('unlocks synchronously on removal, notifies later, and does not relock after reinsertion', async () => {
    const f = createFixture();
    await finish(f, f.a.requestPointerLock());
    const changed = vi.fn();
    f.platformDocument.onpointerlockchange = changed;
    const generation = f.lock.generation;
    f.a.remove();
    expect(f.lock.target === null).toBe(true);
    expect(f.lock.position).toBeNull();
    expect(f.lock.generation).toBe(generation + 1);
    expect(f.restore).toHaveBeenCalledOnce();
    expect(changed).not.toHaveBeenCalled();
    f.b.appendChild(f.a);
    f.loop.runTaskTurn();
    expect(f.platformDocument.pointerLockElement).toBeNull();
    expect(changed).toHaveBeenCalledOnce();
    f.a.remove();
    expect(f.restore).toHaveBeenCalledOnce();
    expect(f.loop.runTaskTurn()).toBe(false);
    f.activation.mockReturnValue(false);
    await expect(finish(f, f.b.requestPointerLock())).rejects.toMatchObject({ name: 'NotAllowedError' });
  });

  it('unlocks a shadow descendant when its containing subtree is removed', async () => {
    const f = createFixture();
    const shadow = f.a.attachShadow({ mode: 'closed' });
    const target = f.platformDocument.createElement('span');
    shadow.appendChild(target);
    await finish(f, target.requestPointerLock());
    f.a.remove();
    expect(f.lock.target === null).toBe(true);
    expect(shadow.pointerLockElement).toBeNull();
    expect(f.restore).toHaveBeenCalledOnce();
  });

  it('notifies the original Document after an unlocked target is adopted elsewhere', async () => {
    const f = createFixture();
    const other = createContext(f.userAgent);
    await finish(f, f.a.requestPointerLock());
    const originalChanged = vi.fn();
    const otherChanged = vi.fn();
    f.platformDocument.onpointerlockchange = originalChanged;
    other.platformDocument.onpointerlockchange = otherChanged;
    other.b.appendChild(f.a);
    while (f.loop.runTaskTurn()) { /* Deliver the removal notification. */ }
    expect(originalChanged).toHaveBeenCalledOnce();
    expect(otherChanged).not.toHaveBeenCalled();
    expect(f.lock.target === null).toBe(true);
  });

  it.each(['removed', 'adopted', 'inactive', 'unfocused'] as const)(
    'rejects a queued request that became %s before acquisition', async (state) => {
      const f = createFixture();
      const originalError = vi.fn();
      f.platformDocument.onpointerlockerror = originalError;
      const result = observeBrowletPromise(f.window, f.a.requestPointerLock()).catch((error: unknown) => error);
      const active = state === 'inactive' ? vi.spyOn(f.document, 'isFullyActive').mockReturnValue(false) : null;
      if (state === 'removed') f.a.remove();
      else if (state === 'adopted') createContext(f.userAgent).b.appendChild(f.a);
      else if (state === 'unfocused') f.focused.mockReturnValue(false);
      f.runParallel();
      // Make the Document runnable again only after checking acquisition.
      active?.mockRestore();
      while (f.loop.runTaskTurn()) { /* Deliver the queued rejection. */ }
      await expect(result).resolves.toMatchObject({ name: 'WrongDocumentError' });
      expect(f.acquire).not.toHaveBeenCalled();
      expect(originalError).toHaveBeenCalledOnce();
      expect(f.lock.target === null).toBe(true);
    },
  );

  it('allows a pending target reinserted into its original Document before acquisition', async () => {
    const f = createFixture();
    const request = f.a.requestPointerLock();
    f.a.remove();
    f.b.appendChild(f.a);
    await finish(f, request);
    expect(f.platformDocument.pointerLockElement).toBe(f.a);
    expect(f.acquire).toHaveBeenCalledOnce();
  });

  it('keeps an acquired request fulfilled when removal precedes its queued notification', async () => {
    const f = createFixture();
    const request = f.a.requestPointerLock();
    f.runParallel();
    f.a.remove();
    const changes = vi.fn();
    f.platformDocument.onpointerlockchange = changes;
    await finish(f, request);
    expect(f.lock.target === null).toBe(true);
    expect(changes).toHaveBeenCalledTimes(2);
    expect(f.restore).toHaveBeenCalledOnce();
  });

  it('leaves the existing lock intact when a queued retarget becomes disconnected', async () => {
    const f = createFixture();
    await finish(f, f.a.requestPointerLock());
    const request = f.b.requestPointerLock();
    f.b.remove();
    await expect(finish(f, request)).rejects.toMatchObject({ name: 'WrongDocumentError' });
    expect(f.platformDocument.pointerLockElement).toBe(f.a);
    expect(f.acquire).toHaveBeenCalledOnce();
    expect(f.restore).not.toHaveBeenCalled();
  });

  it('retains lock across unrelated removal and a state-preserving move', async () => {
    const f = createFixture();
    await finish(f, f.a.requestPointerLock());
    const unrelated = f.platformDocument.createElement('span');
    f.b.appendChild(unrelated);
    unrelated.remove();
    f.b.moveBefore(f.a, null);
    expect(f.platformDocument.pointerLockElement).toBe(f.a);
    expect(f.restore).not.toHaveBeenCalled();
    expect(f.loop.runTaskTurn()).toBe(false);
  });
});

/** Real tree, binding, parallel queue, and event loop; only unfinished owner effects are controlled. */
function createFixture() {
  const userAgent = createManualUserAgent();
  const context = createContext(userAgent);
  const parallel: (() => void)[] = [];
  vi.spyOn(userAgent, 'runInParallel').mockImplementation((steps) => { parallel.push(steps); });
  const lock = userAgent.pointerLock;
  const activation = vi.spyOn(context.traversable.activeWindow!, 'hasTransientActivation').mockReturnValue(true);
  const rawSupport = vi.spyOn(lock, 'supportsUnadjustedMovement').mockReturnValue(true);
  const acquire = vi.spyOn(lock, 'acquire').mockReturnValue({ screenX: 10, screenY: 20, clientX: 1, clientY: 2 });
  const restore = vi.spyOn(lock, 'restoreCursor').mockImplementation(() => {});
  const runParallel = () => { while (parallel.length) parallel.shift()!(); };
  return { ...context, lock, parallel, runParallel, activation, rawSupport, acquire, restore };
}

function createContext(userAgent: ReturnType<typeof createManualUserAgent>) {
  const traversable = TopLevelTraversable.create(userAgent, null, '');
  const document: DocumentImpl = traversable.activeDocument!;
  const focused = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  const platformDocument = project(document) as Document;
  const root: Element = platformDocument.documentElement ?? platformDocument.createElement('html');
  if (!root.isConnected) platformDocument.appendChild(root);
  const a = platformDocument.createElement('div') as HTMLElement;
  const b = platformDocument.createElement('div') as HTMLElement;
  root.append(a, b);
  const window = project(traversable.activeWindow!) as Window;
  return { userAgent, traversable, document, platformDocument, a, b, window, focused, loop: document.env.realm.agent.eventLoop };
}

async function finish(fixture: ReturnType<typeof createFixture>, request: Promise<void>): Promise<void> {
  const result = observeBrowletPromise(fixture.window, request);
  fixture.runParallel();
  while (fixture.loop.runTaskTurn()) { /* Finish queued notifications through real task turns. */ }
  performTestMicrotaskCheckpoint(fixture.window);
  return result;
}
