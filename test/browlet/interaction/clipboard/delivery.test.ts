import { afterEach, describe, expect, it, vi } from 'vitest';

import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/index';
import type { DocumentImpl, ElementImpl } from '../../../../src/browlet/dom/nodes/index';
import type { ClipboardPasteData } from '../../../../src/browlet/interaction/clipboard/index';
import type { ClipboardEvent, DataTransfer, DataTransferItem, File, Window } from '../../../../src/browlet/platform';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { getRelevantRealm, project, unwrap } from '../../../support/browlet-binding';

const listenerErrors: unknown[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  // DOM reports listener exceptions; ensure an assertion inside a listener still fails its test.
  expect(listenerErrors.splice(0)).toEqual([]);
});

describe('Clipboard §§5.2.2–5.2.4 and Appendix A: trusted event delivery', () => {
  it.each(['copy', 'cut', 'paste'] as const)('delivers trusted %s with the native flags and a receiver-owned DataTransfer', (type) => {
    const { clipboard, document, window, target, paste, read } = createFixture();
    const timestamp = vi.spyOn(document.env.realm, 'eventTimeStamp').mockReturnValue(12.5);
    const trace: string[] = []; let received: ClipboardEvent | undefined;
    target.addEventListener(type, (event) => {
      received = event as ClipboardEvent; trace.push('target');
      const data = received.clipboardData!;
      expect(received).toBeInstanceOf(window.ClipboardEvent); expect(data).toBeInstanceOf(window.DataTransfer);
      expect(Object.getPrototypeOf(data)).toBe(window.DataTransfer.prototype);
      expect(getRelevantRealm(data)).toBe(document.env.realm);
      expect(getRelevantRealm(data.items)).toBe(document.env.realm);
      expect(getRelevantRealm(data.files)).toBe(document.env.realm);
      expect(data.types).toBe(data.types); expect(Object.isFrozen(data.types)).toBe(true);
      expect([received.isTrusted, received.bubbles, received.cancelable, received.composed, received.timeStamp])
        .toEqual([true, true, true, true, 12.5]);
      expect(data.getData('text')).toBe(type === 'paste' ? 'native text' : '');
      expect(data.items.length).toBe(type === 'paste' ? 1 : 0);
    });
    window.document.addEventListener(type, () => trace.push('document'));
    window.addEventListener(type, () => trace.push('window'));
    const result = clipboard.fireEvent(type, document)!;
    expect(trace).toEqual(['target', 'document', 'window']); expect(received!.target).toBe(target);
    expect(result).toEqual({ canceled: false, items: type === 'paste' ? paste.items : [], clearWasCalled: false, typesToClear: [] });
    expect(read).toHaveBeenCalledTimes(type === 'paste' ? 1 : 0); expect(timestamp).toHaveBeenCalled();
  });

  it.each(['copy', 'cut'] as const)('returns written %s data and cancellation without editing or writing the native clipboard', (type) => {
    const { clipboard, document, target, read, sequence } = createFixture(); target.textContent = 'keep this';
    target.addEventListener(type, (event) => {
      const data = (event as ClipboardEvent).clipboardData!;
      data.setData('Text', 'chosen'); data.items.add('<b>chosen</b>', 'text/html'); event.preventDefault();
    });
    expect(clipboard.fireEvent(type, document)).toEqual({
      canceled: true,
      items: [{ kind: 'string', type: 'text/plain', data: 'chosen' }, { kind: 'string', type: 'text/html', data: '<b>chosen</b>' }],
      clearWasCalled: false, typesToClear: [],
    });
    expect(target.textContent).toBe('keep this'); expect(read).not.toHaveBeenCalled(); expect(sequence).not.toHaveBeenCalled();
  });

  it('keeps paste read-only through every DataTransfer mutator while permitting cancellation', () => {
    const { clipboard, document, target, window } = createFixture();
    target.addEventListener('paste', (event) => {
      const data = (event as ClipboardEvent).clipboardData!;
      data.setData('text', 'replacement'); data.clearData(); data.items.clear();
      expect(data.items.add('more', 'custom')).toBe(null);
      expect(data.items.add(new window.File(['x'], 'x.txt'))).toBe(null);
      expect(() => data.items.remove(0)).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
      expect(data.getData('text')).toBe('native text'); event.preventDefault();
    });
    expect(clipboard.fireEvent('paste', document)).toEqual({
      canceled: true, items: [{ kind: 'string', type: 'text/plain', data: 'native text' }], clearWasCalled: false, typesToClear: [],
    });
  });

  it('detaches saved transfers, lists and items but retains strings/Files already obtained by a listener', () => {
    const { clipboard, document, window, target, paste } = createFixture();
    const file = new window.File(['image'], 'image.png', { type: 'image/png' });
    paste.items.push({ kind: 'file', type: 'image/png', data: unwrap(file) });
    let saved: DataTransfer | undefined; let item: DataTransferItem | undefined; let captured: File | null = null;
    target.addEventListener('paste', (event) => {
      saved = (event as ClipboardEvent).clipboardData!; item = saved.items[1]!;
      captured = item.getAsFile(); expect(saved.files[0]).toBe(file);
      expect(saved.types).toEqual(['text/plain', 'Files']);
    });
    const result = clipboard.fireEvent('paste', document)!;
    expect(captured).toBe(file); expect(captured!.name).toBe('image.png');
    expect(saved!.items.length).toBe(0); expect(saved!.files.length).toBe(0); expect(saved!.types).toEqual([]);
    expect(saved!.getData('text')).toBe(''); expect([item!.kind, item!.type, item!.getAsFile()]).toEqual(['', '', null]);
    expect(result.items[1]).toEqual({ kind: 'file', type: 'image/png', data: unwrap(file) });
    saved!.setData('text', 'late'); expect(saved!.getData('text')).toBe('');
  });

  it('keeps captured getAsString callbacks queued after detachment, but refuses new callbacks', () => {
    const { clipboard, document, target, loop } = createFixture(); const values: string[] = [];
    let saved: DataTransferItem | undefined;
    target.addEventListener('paste', (event) => {
      saved = (event as ClipboardEvent).clipboardData!.items[0]!;
      saved.getAsString((value) => values.push(value)); expect(values).toEqual([]);
    });
    clipboard.fireEvent('paste', document); saved!.getAsString(() => values.push('late'));
    expect(values).toEqual([]); expect(loop.runTaskTurn()).toBe(true);
    expect(values).toEqual(['native text']);
  });

  it('revokes paste reads when the sequence changes and does not re-enable them if the old token returns', () => {
    const { clipboard, document, target, state } = createFixture();
    target.addEventListener('paste', (event) => {
      const data = (event as ClipboardEvent).clipboardData!; const item = data.items[0]!;
      expect(data.getData('text')).toBe('native text'); state.token = new Uint8Array([2]);
      expect(data.getData('text')).toBe(''); expect(data.types).toEqual(['text/plain']);
      state.token = new Uint8Array([1]); expect(data.getData('text')).toBe('');
      item.getAsString(() => { throw new Error('revoked callback ran'); });
    });
    expect(clipboard.fireEvent('paste', document)!.items).toEqual([]);
  });

  it('checks retained item reads and FileList access against the native entry', () => {
    const { clipboard, document, target, window, state, paste } = createFixture();
    paste.items.push({ kind: 'file', type: 'text/plain', data: unwrap(new window.File(['x'], 'x.txt')) });
    target.addEventListener('paste', (event) => {
      const data = (event as ClipboardEvent).clipboardData!; const item = data.items[1]!;
      expect(data.files.length).toBe(1); state.token = new Uint8Array([3]);
      expect(item.getAsFile()).toBe(null); expect(data.files.length).toBe(0);
    });
    expect(clipboard.fireEvent('paste', document)!.items).toEqual([]);
  });

  it('uses materialized paste data without subsequent native reads when no sequence number exists', () => {
    const { clipboard, document, target, paste, sequence } = createFixture(); paste.entry = null;
    target.addEventListener('paste', (event) => { expect((event as ClipboardEvent).clipboardData!.getData('text')).toBe('native text'); });
    expect(clipboard.fireEvent('paste', document)!.items).toEqual(paste.items); expect(sequence).not.toHaveBeenCalled();
  });

  it('copies the entry token so mutation of the native snapshot cannot change which entry was admitted', () => {
    const { clipboard, document, target, paste, state } = createFixture();
    target.addEventListener('paste', (event) => {
      paste.entry![0] = 2; state.token = new Uint8Array([2]);
      expect((event as ClipboardEvent).clipboardData!.getData('text')).toBe('');
    });
    expect(clipboard.fireEvent('paste', document)!.items).toEqual([]);
  });

  it('retains the captured text even when a host reuses its decoded item record', () => {
    const { clipboard, document, target, paste } = createFixture(); paste.entry = null;
    target.addEventListener('paste', (event) => {
      paste.items[0]!.data = 'later host data';
      expect((event as ClipboardEvent).clipboardData!.getData('text')).toBe('native text');
    });
    expect(clipboard.fireEvent('paste', document)!.items).toEqual([{ kind: 'string', type: 'text/plain', data: 'native text' }]);
  });

  it('tracks normalized per-format clears, including clears of absent data, and removes replaced formats', () => {
    const { clipboard, document, target } = createFixture();
    target.addEventListener('copy', (event) => {
      const data = (event as ClipboardEvent).clipboardData!;
      data.clearData('TEXT'); data.clearData('text/plain'); data.clearData('URL');
      data.setData('Text', 'replacement');
    });
    const result = clipboard.fireEvent('copy', document)!;
    expect(result.clearWasCalled).toBe(true); expect(result.typesToClear).toEqual(['text/uri-list']);
    expect(result.items).toEqual([{ kind: 'string', type: 'text/plain', data: 'replacement' }]);
  });

  it('clears the pending flag when items.add replaces the last cleared format', () => {
    const { clipboard, document, target } = createFixture();
    target.addEventListener('copy', (event) => {
      const data = (event as ClipboardEvent).clipboardData!;
      data.clearData('TEXT/HTML'); data.items.add('replacement', 'text/html');
    });
    const result = clipboard.fireEvent('copy', document)!;
    expect(result.clearWasCalled).toBe(false); expect(result.typesToClear).toEqual([]);
  });

  it.each(['clearData', 'items.clear'] as const)('%s replaces per-format clearing with clear-all, even for an empty store', (method) => {
    const { clipboard, document, target } = createFixture();
    target.addEventListener('copy', (event) => {
      const data = (event as ClipboardEvent).clipboardData!; data.clearData('text/html');
      if (method === 'clearData') data.clearData(); else data.items.clear();
    });
    const result = clipboard.fireEvent('copy', document)!;
    expect(result.clearWasCalled).toBe(true); expect(result.typesToClear).toEqual([]);
  });

  it('resets a clear-all request when new data is written, without treating items.remove as clearData', () => {
    const { clipboard, document, target } = createFixture();
    target.addEventListener('copy', (event) => {
      const data = (event as ClipboardEvent).clipboardData!;
      data.items.clear(); data.items.add('value', 'custom'); data.items.remove(0);
    });
    expect(clipboard.fireEvent('copy', document)).toEqual({ canceled: false, items: [], clearWasCalled: false, typesToClear: [] });
  });

  it('keeps nested dispatch stores and clear tracking independent', () => {
    const { clipboard, document, target } = createFixture(); let nested = false;
    target.addEventListener('copy', (event) => {
      const data = (event as ClipboardEvent).clipboardData!;
      if (nested) { data.clearData('text/html'); data.setData('text', 'inner'); return; }
      data.setData('text', 'outer'); nested = true;
      const inner = clipboard.fireEvent('copy', document)!;
      expect(inner.typesToClear).toEqual(['text/html']);
      expect(data.getData('text')).toBe('outer');
    });
    const result = clipboard.fireEvent('copy', document)!;
    expect(result.items).toEqual([{ kind: 'string', type: 'text/plain', data: 'outer' }]);
    expect(result.clearWasCalled).toBe(false);
  });

  it('crosses a shadow boundary with DOM retargeting and one shared DataTransfer', () => {
    const { clipboard, document, target, window, choose } = createFixture();
    const root = target.attachShadow({ mode: 'open' }); const inner = window.document.createElement('span'); root.append(inner);
    choose.mockReturnValue(unwrap<ElementImpl>(inner)); let data: DataTransfer | null = null; const targets: EventTarget[] = [];
    inner.addEventListener('copy', (event) => { data = (event as ClipboardEvent).clipboardData; targets.push(event.target!); });
    window.addEventListener('copy', (event) => { expect((event as ClipboardEvent).clipboardData).toBe(data); targets.push(event.target!); });
    clipboard.fireEvent('copy', document); expect(targets).toEqual([inner, target]);
  });

  it('cleans up when an exception is reported from a listener', () => {
    const { clipboard, document, target } = createFixture(); let data: DataTransfer | null = null;
    const report = vi.spyOn(document.env.realm, 'reportException').mockImplementation(() => {});
    target.addEventListener('copy', (event) => { data = (event as ClipboardEvent).clipboardData; data!.setData('text', 'written'); throw new Error('listener'); });
    expect(clipboard.fireEvent('copy', document)!.items).toEqual([{ kind: 'string', type: 'text/plain', data: 'written' }]);
    expect(report).toHaveBeenCalledTimes(1); expect(data!.items.length).toBe(0);
  });

  it('cleans up if native entry validation fails after dispatch', () => {
    const { clipboard, document, target, sequence } = createFixture(); let data: DataTransfer | null = null;
    target.addEventListener('paste', (event) => { data = (event as ClipboardEvent).clipboardData; });
    sequence.mockImplementation(() => { throw new Error('native validation failed'); });
    expect(() => clipboard.fireEvent('paste', document)).toThrow('native validation failed');
    expect(data!.items.length).toBe(0); expect(data!.getData('text')).toBe('');
  });

  it('does not read paste data when there is no target or the Document is inactive', () => {
    const { clipboard, document, choose, read } = createFixture(); choose.mockReturnValue(null);
    expect(clipboard.fireEvent('paste', document)).toBe(null); expect(read).not.toHaveBeenCalled();
    choose.mockClear(); vi.spyOn(document, 'isFullyActive').mockReturnValue(false);
    expect(clipboard.fireEvent('paste', document)).toBe(null); expect(choose).not.toHaveBeenCalled();
  });

  it('does not treat author-dispatched events as commands or detach their author-owned transfers', () => {
    const { clipboard, document, target, window, read, choose } = createFixture();
    const transfer = new window.DataTransfer(); transfer.setData('text', 'author');
    target.dispatchEvent(new window.ClipboardEvent('paste', { clipboardData: transfer }));
    expect(transfer.getData('text')).toBe('author'); expect(choose).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    expect(clipboard).toBe(document.env.userAgent.systemClipboard);
  });

  it('retains the explicit target-selection and native-paste dependencies', () => {
    const { clipboard, document, choose, read } = createFixture(); choose.mockRestore();
    expect(() => clipboard.fireEvent('copy', document)).toThrow('Clipboard event target selection requires editing and rendered selection');
    read.mockRestore(); expect(() => clipboard.readForPaste(document)).toThrow('Native clipboard paste decoding and HTML processing are not implemented');
  });
});

function createFixture() {
  const userAgent = createManualUserAgent(); const traversable = TopLevelTraversable.create(userAgent, null, '');
  const document: DocumentImpl = traversable.activeDocument!;
  const window = project(traversable.activeWindow!) as Window;
  const target = window.document.createElement('div'); window.document.body!.append(target);
  vi.spyOn(document.env.realm, 'reportException').mockImplementation((error) => { listenerErrors.push(error); });
  const clipboard = userAgent.systemClipboard;
  const choose = vi.spyOn(clipboard, 'getEventTarget').mockReturnValue(unwrap<ElementImpl>(target));
  const paste: ClipboardPasteData = { items: [{ kind: 'string', type: 'text/plain', data: 'native text' }], entry: new Uint8Array([1]) };
  const state = { types: ['text/plain'], token: new Uint8Array([1]) };
  const read = vi.spyOn(clipboard, 'readForPaste').mockReturnValue(paste);
  const sequence = vi.spyOn(clipboard, 'readChangeState').mockImplementation(() => state);
  return { clipboard, document, window, target, paste, read, state, sequence, choose, loop: document.env.responsibleEventLoop };
}
