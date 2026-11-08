import { afterEach, describe, expect, it, vi } from 'vitest';

import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/index';
import type { DocumentImpl, ElementImpl } from '../../../../src/browlet/dom/nodes/index';
import type { ClipboardPasteData } from '../../../../src/browlet/interaction/clipboard/index';
import type { DragDataItem } from '../../../../src/browlet/interaction/drag-drop/index';
import type { ClipboardEvent, DataTransfer, Window } from '../../../../src/browlet/platform';
import { userInteractionTaskSource } from '../../../../src/browlet/scripting/index';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { project, unwrap } from '../../../support/browlet-binding';

const listenerErrors: unknown[] = [];
afterEach(() => { vi.restoreAllMocks(); expect(listenerErrors.splice(0)).toEqual([]); });

describe('Clipboard §§5.3, 6 and 8: command admission and action flow', () => {
  it.each(['copy', 'cut'] as const)('refuses script %s before dispatch or native access without transient activation', (type) => {
    const { clipboard, document, activation, choose, replace, read, permission } = createFixture();
    activation.mockReturnValue(false);
    expect(clipboard.runAction(type, document, 'script')).toBe(false);
    expect(activation).toHaveBeenCalledTimes(1); expect(permission).not.toHaveBeenCalled();
    expect(choose).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  });

  it('rejects script copy after consumption even though sticky activation remains', () => {
    const { clipboard, document, activation, choose } = createFixture(); activation.mockRestore();
    const window = document.getRelevantGlobalObject()!;
    window.lastActivationTimestamp = -Infinity;
    expect(window.hasStickyActivation()).toBe(true);
    expect(clipboard.runAction('copy', document, 'script')).toBe(false);
    expect(choose).not.toHaveBeenCalled();
  });

  it('does not treat transient activation or persistent change-listener consent as script paste permission', () => {
    const { clipboard, document, activation, choose, read, permission } = createFixture(); permission.mockReturnValue(false);
    const persistent = vi.spyOn(clipboard, 'hasPersistentReadPermission').mockReturnValue(true);
    expect(clipboard.runAction('paste', document, 'script')).toBe(false);
    expect(permission).toHaveBeenCalledWith(document); expect(activation).not.toHaveBeenCalled();
    expect(persistent).not.toHaveBeenCalled(); expect(choose).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  });

  it('executes an admitted script command synchronously and returns its action result', () => {
    const { clipboard, document, target, trace, replace, loop } = createFixture();
    target.addEventListener('copy', () => trace.push('copy'));
    expect(clipboard.runAction('copy', document, 'script')).toBe(true);
    expect(trace).toEqual(['copy', 'extract', 'replace']); expect(replace).toHaveBeenCalledTimes(1);
    expect(loop.runTaskTurn()).toBe(true); expect(trace.at(-1)).toBe('change');
  });

  it.each(['copy', 'cut', 'paste'] as const)('admits native %s without consulting script permission or activation', (type) => {
    const { clipboard, document, activation, permission } = createFixture();
    activation.mockReturnValue(false); permission.mockReturnValue(false);
    expect(clipboard.runAction(type, document, 'user')).toBe(true);
    expect(activation).not.toHaveBeenCalled(); expect(permission).not.toHaveBeenCalled();
  });

  it('queues menu commands on the Document user-interaction source', () => {
    const { clipboard, document, trace, target, replace, loop } = createFixture();
    target.addEventListener('copy', () => trace.push('copy'));
    clipboard.queueAction('copy', document); expect(trace).toEqual([]); expect(replace).not.toHaveBeenCalled();
    expect([...loop.getTaskQueue(userInteractionTaskSource)]).toHaveLength(1);
    expect(loop.runTaskTurn()).toBe(true); expect(trace).toEqual(['copy', 'extract', 'replace']);
    expect(loop.runTaskTurn()).toBe(true); expect(trace.at(-1)).toBe('change');
  });

  it('allows a shortcut action in the keydown task to precede an already queued keyup task', () => {
    const { clipboard, document, loop, trace, target } = createFixture();
    target.addEventListener('copy', () => trace.push('copy'));
    document.env.realm.queueGlobalTask(userInteractionTaskSource, () => {
      trace.push('keydown'); clipboard.runAction('copy', document, 'user');
    });
    document.env.realm.queueGlobalTask(userInteractionTaskSource, () => { trace.push('keyup'); });
    loop.runTaskTurn(); loop.runTaskTurn();
    expect(trace).toEqual(['keydown', 'copy', 'extract', 'replace', 'keyup']);
  });

  it('drops a queued menu action when Document destruction removes its tasks', () => {
    const { clipboard, document, loop, choose, replace } = createFixture();
    document.env.realm.queueGlobalTask(userInteractionTaskSource, () => { document.destroy(); });
    clipboard.queueAction('copy', document); loop.runTaskTurn();
    expect(loop.runTaskTurn()).toBe(false); expect(choose).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
  });

  it.each(['copy', 'cut'] as const)('writes canceled %s data after detaching the transfer, without reading/deleting selection', (type) => {
    const { clipboard, document, target, extract, remove, editable, replace, loop, trace } = createFixture();
    let saved: DataTransfer | null = null;
    target.addEventListener(type, (event) => {
      trace.push(type); saved = (event as ClipboardEvent).clipboardData!;
      saved.setData('Text', 'author'); event.preventDefault();
    });
    replace.mockImplementation((items) => {
      expect(saved!.items.length).toBe(0); expect(items).toEqual([textItem('author')]); trace.push('replace'); return true;
    });
    expect(clipboard.runAction(type, document, 'user')).toBe(true);
    expect(extract).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled(); expect(editable).not.toHaveBeenCalled();
    expect(trace).toEqual([type, 'replace']); loop.runTaskTurn(); expect(trace.at(-1)).toBe('change');
  });

  it('ignores uncanceled clipboardData edits and extracts the current selection after the listener', () => {
    const { clipboard, document, target, window, extract, replace } = createFixture();
    target.textContent = 'before after'; const text = target.firstChild!; const selection = window.getSelection()!;
    selection.setBaseAndExtent(text, 0, text, 6);
    extract.mockImplementation(() => [textItem(selection.getRangeAt(0).toString())]);
    target.addEventListener('copy', (event) => {
      (event as ClipboardEvent).clipboardData!.setData('text', 'ignored'); selection.setBaseAndExtent(text, 7, text, 12);
    });
    expect(clipboard.runAction('copy', document, 'user')).toBe(true);
    expect(replace).toHaveBeenCalledWith([textItem('after')], document);
  });

  it('checks cut eligibility after the event and refuses the default when the new context is not editable', () => {
    const { clipboard, document, target, editable, extract, replace, remove } = createFixture();
    target.addEventListener('cut', () => { editable.mockReturnValue(false); });
    expect(clipboard.runAction('cut', document, 'user')).toBe(false);
    expect(editable).toHaveBeenCalledWith('cut', document); expect(extract).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });

  it('copies before deleting on uncanceled cut and leaves edit-event scheduling with the editing owner', () => {
    const { clipboard, document, target, trace, loop, remove } = createFixture();
    target.addEventListener('cut', () => trace.push('cut'));
    remove.mockImplementation(() => {
      trace.push('delete'); document.env.realm.queueGlobalTask(userInteractionTaskSource, () => { trace.push('input'); });
    });
    expect(clipboard.runAction('cut', document, 'user')).toBe(true);
    expect(trace).toEqual(['cut', 'editable:cut', 'extract', 'replace', 'delete']);
    loop.runTaskTurn(); loop.runTaskTurn(); expect(trace.slice(-2)).toEqual(['change', 'input']);
  });

  it('does not consult editing or produce input effects for copy', () => {
    const { clipboard, document, editable, remove, insert } = createFixture();
    expect(clipboard.runAction('copy', document, 'user')).toBe(true);
    expect(editable).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled();
  });

  it('returns false for canceled paste and never inserts or writes data', () => {
    const { clipboard, document, target, editable, insert, replace, clear, loop } = createFixture();
    target.addEventListener('paste', (event) => event.preventDefault());
    expect(clipboard.runAction('paste', document, 'script')).toBe(false);
    expect(editable).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled(); expect(loop.runTaskTurn()).toBe(false);
  });

  it('delivers paste but refuses insertion when its current context is not editable', () => {
    const { clipboard, document, editable, insert, trace, target } = createFixture();
    editable.mockReturnValue(false); target.addEventListener('paste', () => trace.push('paste'));
    expect(clipboard.runAction('paste', document, 'user')).toBe(false);
    expect(trace).toEqual(['paste']); expect(insert).not.toHaveBeenCalled();
  });

  it('inserts the admitted paste snapshot at the current editing context without rereading native contents', () => {
    const { clipboard, document, target, read, insert, replace, clear, trace } = createFixture();
    target.addEventListener('paste', () => trace.push('paste'));
    expect(clipboard.runAction('paste', document, 'script')).toBe(true);
    expect(read).toHaveBeenCalledTimes(1); expect(insert).toHaveBeenCalledWith([textItem('native')], document);
    expect(trace).toEqual(['paste', 'editable:paste', 'insert']); expect(replace).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled();
  });

  it('does not edit for an empty or revoked paste snapshot', () => {
    const { clipboard, document, target, state, insert } = createFixture();
    target.addEventListener('paste', () => { state.token = new Uint8Array([2]); });
    expect(clipboard.runAction('paste', document, 'user')).toBe(true); expect(insert).not.toHaveBeenCalled();
  });

  it('keeps an empty copy and an empty canceled write from clearing the clipboard or notifying', () => {
    const { clipboard, document, target, extract, replace, clear, loop } = createFixture(); extract.mockReturnValue([]);
    expect(clipboard.runAction('copy', document, 'user')).toBe(true);
    target.addEventListener('cut', (event) => event.preventDefault());
    expect(clipboard.runAction('cut', document, 'user')).toBe(true);
    expect(replace).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled(); expect(loop.runTaskTurn()).toBe(false);
  });

  it('passes a selective clear to the native owner and queues a change only after success', () => {
    const { clipboard, document, target, clear, replace, loop, trace } = createFixture();
    target.addEventListener('copy', (event) => { (event as ClipboardEvent).clipboardData!.clearData('URL'); event.preventDefault(); });
    expect(clipboard.runAction('copy', document, 'user')).toBe(true);
    expect(clear).toHaveBeenCalledWith(['text/uri-list'], document); expect(replace).not.toHaveBeenCalled();
    expect(trace).toEqual(['clear']); loop.runTaskTurn(); expect(trace.at(-1)).toBe('change');
  });

  it('lets any nonempty written list replace contents instead of applying old clear requests', () => {
    const { clipboard, document, target, clear, replace } = createFixture();
    target.addEventListener('copy', (event) => {
      const data = (event as ClipboardEvent).clipboardData!; data.clearData('text/html'); data.setData('text', 'replacement'); event.preventDefault();
    });
    expect(clipboard.runAction('copy', document, 'user')).toBe(true);
    expect(replace).toHaveBeenCalledWith([textItem('replacement')], document); expect(clear).not.toHaveBeenCalled();
  });

  it('keeps clear-all pending when followed by a narrower clear request', () => {
    const { clipboard, document, target, clear } = createFixture();
    target.addEventListener('copy', (event) => {
      const data = (event as ClipboardEvent).clipboardData!; data.clearData(); data.clearData('text/html'); event.preventDefault();
    });
    expect(clipboard.runAction('copy', document, 'user')).toBe(true); expect(clear).toHaveBeenCalledWith([], document);
  });

  it.each(['replace', 'clear'] as const)('does not notify when the native %s reports that its generation did not change', (operation) => {
    const { clipboard, document, replace, clear, loop } = createFixture();
    replace.mockReturnValue(false); clear.mockReturnValue(false);
    clipboard.writeContentToClipboard(operation === 'replace' ? [textItem('value')] : [], true, ['text/html'], document);
    expect(loop.runTaskTurn()).toBe(false);
  });

  it('does not delete or notify after a failed native cut write', () => {
    const { clipboard, document, replace, remove, loop } = createFixture();
    replace.mockImplementation(() => { throw new Error('write failed'); });
    expect(() => clipboard.runAction('cut', document, 'user')).toThrow('write failed');
    expect(remove).not.toHaveBeenCalled(); expect(loop.runTaskTurn()).toBe(false);
  });

  it('keeps a successful write notification even when the following edit fails', () => {
    const { clipboard, document, remove, loop, trace } = createFixture();
    remove.mockImplementation(() => { throw new Error('edit unavailable'); });
    expect(() => clipboard.runAction('cut', document, 'user')).toThrow('edit unavailable');
    loop.runTaskTurn(); expect(trace.at(-1)).toBe('change');
  });

  it.each(['copy', 'cut', 'paste'] as const)('stops %s effects if a clipboard listener deactivates its Document', (type) => {
    const { clipboard, document, target, replace, clear, remove, insert, extract, loop } = createFixture();
    target.addEventListener(type, (event) => {
      (event as ClipboardEvent).clipboardData!.setData('text', 'author'); event.preventDefault();
      vi.spyOn(document, 'isFullyActive').mockReturnValue(false);
    });
    expect(clipboard.runAction(type, document, 'user')).toBe(false);
    expect(replace).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled(); expect(extract).not.toHaveBeenCalled(); expect(loop.runTaskTurn()).toBe(false);
  });

  it('keeps nested commands separate and reuses the selection changed by the inner listener', () => {
    const { clipboard, document, target, extract, replace } = createFixture();
    target.addEventListener('cut', (event) => {
      (event as ClipboardEvent).clipboardData!.setData('text', 'inner'); event.preventDefault(); extract.mockReturnValue([textItem('new selection')]);
    });
    target.addEventListener('copy', () => { expect(clipboard.runAction('cut', document, 'user')).toBe(true); });
    expect(clipboard.runAction('copy', document, 'user')).toBe(true);
    expect(replace.mock.calls.map(([items]) => items)).toEqual([[textItem('inner')], [textItem('new selection')]]);
  });

  it('does not enter commands from synthetic ClipboardEvent dispatch', () => {
    const { clipboard, target, window, replace, insert, extract } = createFixture();
    const run = vi.spyOn(clipboard, 'runAction');
    target.dispatchEvent(new window.ClipboardEvent('copy', { bubbles: true, cancelable: true }));
    expect(run).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled(); expect(extract).not.toHaveBeenCalled();
  });

  it('retains named owner failures rather than silently skipping an admitted action', () => {
    const { clipboard, document, permission, extract, editable, remove, insert, replace, clear } = createFixture();
    permission.mockRestore(); extract.mockRestore(); editable.mockRestore(); remove.mockRestore(); insert.mockRestore(); replace.mockRestore(); clear.mockRestore();
    expect(() => clipboard.runAction('paste', document, 'script')).toThrow('Script clipboard paste permission is not implemented');
    expect(() => clipboard.getSelectedContents(document)).toThrow('Clipboard copying requires rendered selection');
    expect(() => clipboard.canEditSelection('cut', document)).toThrow('Clipboard actions require HTML editing eligibility');
    expect(() => clipboard.deleteSelectedContents(document)).toThrow('Clipboard cutting requires editing');
    expect(() => clipboard.insertPasteContents([textItem('native')], document)).toThrow('Clipboard pasting requires editing');
    expect(() => clipboard.writeContentToClipboard([textItem('author')], false, [], document)).toThrow('Native clipboard replacement');
    expect(() => clipboard.writeContentToClipboard([], true, [], document)).toThrow('Native clipboard clearing');
  });
});

function textItem(data: string): DragDataItem { return { kind: 'string', type: 'text/plain', data }; }

function createFixture() {
  const userAgent = createManualUserAgent(); const traversable = TopLevelTraversable.create(userAgent, null, '');
  const document: DocumentImpl = traversable.activeDocument!; const windowImpl = traversable.activeWindow!;
  const window = project(windowImpl) as Window; const target = window.document.createElement('div'); window.document.body!.append(target);
  vi.spyOn(document.env.realm, 'reportException').mockImplementation((error) => { listenerErrors.push(error); });
  vi.spyOn(document.env, 'isSecureContext', 'get').mockReturnValue(true); vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  windowImpl.lastActivationTimestamp = 0;
  const activation = vi.spyOn(windowImpl, 'hasTransientActivation').mockReturnValue(true);
  const clipboard = userAgent.systemClipboard; const trace: string[] = [];
  const choose = vi.spyOn(clipboard, 'getEventTarget').mockReturnValue(unwrap<ElementImpl>(target));
  const permission = vi.spyOn(clipboard, 'hasScriptPastePermission').mockReturnValue(true);
  const paste: ClipboardPasteData = { items: [textItem('native')], entry: new Uint8Array([1]) };
  const read = vi.spyOn(clipboard, 'readForPaste').mockReturnValue(paste);
  const state = { types: ['text/plain'], token: new Uint8Array([1]) };
  vi.spyOn(clipboard, 'readChangeState').mockImplementation(() => state);
  const extract = vi.spyOn(clipboard, 'getSelectedContents').mockImplementation(() => { trace.push('extract'); return [textItem('selected')]; });
  const editable = vi.spyOn(clipboard, 'canEditSelection').mockImplementation((type) => { trace.push('editable:' + type); return true; });
  const remove = vi.spyOn(clipboard, 'deleteSelectedContents').mockImplementation(() => { trace.push('delete'); });
  const insert = vi.spyOn(clipboard, 'insertPasteContents').mockImplementation(() => { trace.push('insert'); });
  const replace = vi.spyOn(clipboard, 'replaceNativeContents').mockImplementation(() => { trace.push('replace'); state.token = new Uint8Array([2]); return true; });
  const clear = vi.spyOn(clipboard, 'clearNativeContents').mockImplementation(() => { trace.push('clear'); state.token = new Uint8Array([2]); return true; });
  window.addEventListener('clipboardchange', () => trace.push('change'));
  return {
    clipboard, document, window, target, trace, activation, choose, permission, read, state, extract, editable, remove, insert, replace, clear,
    loop: document.env.responsibleEventLoop,
  };
}
