import { describe, expect, it, vi } from 'vitest';

import { InternalError } from '../../../../src/infra/index';
import type { FileImpl } from '../../../../src/file/index';
import { Browlet } from '../../../../src/browlet/browlet';
import type { ElementImpl } from '../../../../src/browlet/dom/nodes/index';
import type { StaticRangeImpl } from '../../../../src/browlet/dom/ranges/index';
import type { DragDataItem } from '../../../../src/browlet/interaction/drag-drop/index';
import { InputEventImpl, type EditingInput, type InputType } from '../../../../src/browlet/interaction/events/index';
import type { InputEvent as InputEventPlatform } from '../../../../src/browlet/platform';
import { getRelevantRealm, project, unwrap } from '../../../support/browlet-binding';
import { useFixture } from '../../../support/fixture';

describe('Input Events §§6.1.2–6.2: trusted event preparation', () => {
  const prepared = useFixture(() => new Browlet({ route: () => '' }));

  it('applies the data, transfer, range, and cancelability tables to every specified inputType', () => {
    const browser = prepared();
    const body = browser.document.body!;
    const control = browser.document.createElement('textarea');
    const text = browser.document.createTextNode('ab');
    body.appendChild(text);
    const range = new browser.window.StaticRange({ startContainer: text, startOffset: 1, endContainer: text, endOffset: 2 });

    for (const [inputType, payload] of Object.entries(inputTypes)) {
      for (const host of ['contenteditable', 'text-control'] as const) {
        const element = host === 'contenteditable' ? body : control;
        for (const type of ['beforeinput', 'input'] as const) {
          const input = editingInput({
            host, inputType: inputType as InputType, data: payload === 'transfer' ? 'x' : payload ?? 'ignored',
            transferItems: transferItems(), targetRanges: [unwrap<StaticRangeImpl>(range)],
          });
          const event = project(InputEventImpl.create(type, unwrap<ElementImpl>(element), input)) as InputEventPlatform;
          const label = `${type} ${host} ${inputType}`;
          const rich = payload === 'transfer' && host === 'contenteditable';
          expect([event.type, event.inputType, event.isTrusted, event.bubbles, event.composed, event.detail], label)
            .toEqual([type, inputType, true, true, true, 0]);
          expect(event.cancelable, label).toBe(type === 'beforeinput' && inputType !== 'insertCompositionText');
          expect(event.data, label).toBe(rich ? null : payload === 'transfer' ? 'x' : payload);
          expect(event.dataTransfer === null, label).toBe(!rich);
          if (rich) expect(event.dataTransfer!.getData('text/plain'), label).toBe('x');
          const hasRanges = type === 'beforeinput' && host === 'contenteditable' &&
            inputType !== 'historyUndo' && inputType !== 'historyRedo';
          expect(event.getTargetRanges(), label).toEqual(hasRanges ? [range] : []);
          expect([event.target, event.view], label).toEqual([element, browser.window]);
        }
      }
    }
  });

  it('allocates fresh notifications and timestamps without dispatching or editing', () => {
    const browser = prepared();
    const element = browser.document.body!;
    element.textContent = 'unchanged';
    const listener = vi.fn();
    element.addEventListener('beforeinput', listener);
    element.addEventListener('input', listener);
    const target = unwrap<ElementImpl>(element);
    const realm = getRelevantRealm(target);
    const clock = vi.spyOn(realm, 'eventTimeStamp').mockReturnValueOnce(125).mockReturnValueOnce(130);
    try {
      const before = project(InputEventImpl.create('beforeinput', target, editingInput())) as InputEventPlatform;
      const after = project(InputEventImpl.create('input', target, editingInput())) as InputEventPlatform;
      expect(before).toBeInstanceOf(browser.window.InputEvent);
      expect(after).not.toBe(before);
      expect([before.timeStamp, after.timeStamp]).toEqual([125, 130]);
      expect([before.currentTarget, before.defaultPrevented, before.composedPath()]).toEqual([null, false, []]);
      expect(getRelevantRealm(before)).toBe(realm);
      expect(listener).not.toHaveBeenCalled();
      expect(element.textContent).toBe('unchanged');
    } finally { clock.mockRestore(); }
  });

  it('uses actual composition state and preserves empty and already prepared text', () => {
    const browser = prepared();
    const target = unwrap<ElementImpl>(browser.document.body!);
    for (const inputType of ['insertText', 'insertCompositionText'] as const) {
      for (const isComposing of [false, true]) {
        for (const data of ['', 'e\u0301', '\ud800']) {
          const event = project(InputEventImpl.create('beforeinput', target,
            editingInput({ inputType, isComposing, data }))) as InputEventPlatform;
          expect([event.isComposing, event.data, event.cancelable]).toEqual([isComposing, data, inputType === 'insertText']);
        }
      }
    }
  });

  it('delivers trusted notifications and honors cancellation only for cancelable beforeinput', () => {
    const browser = prepared();
    const element = browser.document.body!;
    const target = unwrap<ElementImpl>(element);
    const observed: unknown[] = [];
    for (const type of ['beforeinput', 'input']) {
      browser.document.addEventListener(type, (event) => {
        event.preventDefault();
        observed.push([event.type, event.target === element, event.isTrusted, event.defaultPrevented]);
      });
    }
    expect(target.dispatch(InputEventImpl.create('beforeinput', target, editingInput()))).toBe(false);
    expect(target.dispatch(InputEventImpl.create('beforeinput', target,
      editingInput({ inputType: 'insertCompositionText', isComposing: true })))).toBe(true);
    expect(target.dispatch(InputEventImpl.create('input', target, editingInput()))).toBe(true);
    expect(observed).toEqual([
      ['beforeinput', true, true, true], ['beforeinput', true, true, false], ['input', true, true, false],
    ]);
  });

  it('copies transfer records into a read-only store and preserves file and link payloads', () => {
    const browser = prepared();
    const file = new browser.window.File(['binary\u0000data'], 'pasted.txt', { type: 'text/plain' });
    const items = transferItems();
    items.push({ kind: 'string', type: 'text/uri-list', data: 'https://example.org/' },
      { kind: 'file', type: 'text/plain', data: unwrap<FileImpl>(file) });
    const input = editingInput({ host: 'contenteditable', inputType: 'insertFromPaste', transferItems: items });
    const target = unwrap<ElementImpl>(browser.document.body!);
    const before = project(InputEventImpl.create('beforeinput', target, input)) as InputEventPlatform;
    const after = project(InputEventImpl.create('input', target, input)) as InputEventPlatform;
    const transfer = before.dataTransfer!;
    expect(transfer).toBeInstanceOf(browser.window.DataTransfer);
    expect(after.dataTransfer).not.toBe(transfer);
    expect(after.dataTransfer!.getData('text/html')).toBe('<b>x</b>');
    expect(transfer.types).toEqual(['text/html', 'text/plain', 'text/uri-list', 'Files']);
    expect(transfer.getData('URL')).toBe('https://example.org/');
    expect(transfer.files[0]).toBe(file);
    expect(transfer.items[3]!.getAsFile()).toBe(file);
    expect(getRelevantRealm(transfer)).toBe(getRelevantRealm(browser.window));

    items[0]!.data = 'changed producer record';
    items.length = 0;
    transfer.setData('text/html', 'changed by author');
    transfer.clearData();
    transfer.items.clear();
    expect(transfer.items.add('new', 'text/plain')).toBeNull();
    expect(() => transfer.items.remove(0)).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    expect(transfer.getData('text/html')).toBe('<b>x</b>');
    expect(transfer.items.length).toBe(4);
  });

  it('retains beforeinput snapshots through producer-array changes, DOM mutations, and dispatch', () => {
    const browser = prepared();
    const text = browser.document.createTextNode('ab');
    browser.document.body!.appendChild(text);
    const range = new browser.window.StaticRange({ startContainer: text, startOffset: 1, endContainer: text, endOffset: 2 });
    const ranges = [unwrap<StaticRangeImpl>(range), unwrap<StaticRangeImpl>(range)];
    const target = unwrap<ElementImpl>(browser.document.body!);
    const event = InputEventImpl.create('beforeinput', target, editingInput({ host: 'contenteditable', targetRanges: ranges }));
    const platform = project(event) as InputEventPlatform;
    ranges.length = 0;
    const first = platform.getTargetRanges();
    first.length = 0;
    browser.document.addEventListener('beforeinput', () => { text.data = ''; });
    target.dispatch(event);
    expect(platform.getTargetRanges()).toEqual([range, range]);
    expect(platform.getTargetRanges()).not.toBe(platform.getTargetRanges());
    expect([range.startContainer, range.startOffset, range.endContainer, range.endOffset]).toEqual([text, 1, text, 2]);
  });

  it('keeps missing text, rich representations, and EditContext support explicit', () => {
    const browser = prepared();
    const target = unwrap<ElementImpl>(browser.document.body!);
    for (const input of [
      editingInput({ data: null }),
      editingInput({ inputType: 'formatFontColor', data: null }),
      editingInput({ inputType: 'insertFromPaste', data: null }),
      editingInput({ host: 'contenteditable', inputType: 'insertFromPaste', transferItems: null }),
      editingInput({ host: 'edit-context' }),
    ]) {
      expect(() => InputEventImpl.create('beforeinput', target, input)).toThrow(InternalError);
    }
  });
});

describe('Input Events: prepared payload ownership', () => {
  const prepared = useFixture(() => ({ owner: new Browlet({ route: () => '' }), other: new Browlet({ route: () => '' }) }));

  it('allocates the event and transfer in the target realm while retaining supplied range and File identities', () => {
    const { owner, other } = prepared();
    const file = new other.window.File(['x'], 'x.txt', { type: 'text/plain' });
    const text = owner.document.createTextNode('ab');
    owner.document.body!.appendChild(text);
    const range = new other.window.StaticRange({ startContainer: text, startOffset: 0, endContainer: text, endOffset: 1 });
    const items = transferItems();
    items.push({ kind: 'file', type: 'text/plain', data: unwrap<FileImpl>(file) });
    const event = project(InputEventImpl.create('beforeinput', unwrap<ElementImpl>(owner.document.body!), editingInput({
      host: 'contenteditable', inputType: 'insertFromDrop', transferItems: items, targetRanges: [unwrap<StaticRangeImpl>(range)],
    }))) as InputEventPlatform;
    expect([event.view, event.target]).toEqual([owner.window, owner.document.body]);
    expect(getRelevantRealm(event)).toBe(getRelevantRealm(owner.window));
    expect(getRelevantRealm(event.dataTransfer!)).toBe(getRelevantRealm(owner.window));
    expect(event.dataTransfer!.files[0]).toBe(file);
    expect(getRelevantRealm(event.dataTransfer!.files[0]!)).toBe(getRelevantRealm(other.window));
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise a borrowed method with the target-realm event.
    const ranges = Reflect.apply(other.window.InputEvent.prototype.getTargetRanges, event, []);
    expect(Object.getPrototypeOf(ranges)).toBe(getRelevantRealm(owner.window).Array.prototype);
    expect(ranges[0]).toBe(range);
    expect(getRelevantRealm(ranges[0]!)).toBe(getRelevantRealm(other.window));
  });
});

function editingInput(overrides: Partial<EditingInput> = {}): EditingInput {
  return {
    host: 'text-control', inputType: 'insertText', isComposing: false,
    data: 'x', transferItems: null, targetRanges: [], ...overrides,
  };
}

function transferItems(): DragDataItem[] {
  return [{ kind: 'string', type: 'text/html', data: '<b>x</b>' }, { kind: 'string', type: 'text/plain', data: 'x' }];
}

// Input Events §6.1.2: a format/text value, host-dependent transfer data, or no payload.
const inputTypes: Record<InputType, string | null> = {
  insertText: 'x', insertReplacementText: 'transfer', insertLineBreak: null, insertParagraph: null,
  insertOrderedList: null, insertUnorderedList: null, insertHorizontalRule: null, insertFromYank: 'transfer',
  insertFromDrop: 'transfer', insertFromPaste: 'transfer', insertFromPasteAsQuotation: 'transfer', insertTranspose: 'transfer',
  insertCompositionText: 'x', insertLink: 'https://example.org/',
  deleteWordBackward: null, deleteWordForward: null, deleteSoftLineBackward: null, deleteSoftLineForward: null,
  deleteEntireSoftLine: null, deleteHardLineBackward: null, deleteHardLineForward: null,
  deleteByDrag: null, deleteByCut: null, deleteContent: null, deleteContentBackward: null, deleteContentForward: null,
  historyUndo: null, historyRedo: null,
  formatBold: null, formatItalic: null, formatUnderline: null, formatStrikeThrough: null,
  formatSuperscript: null, formatSubscript: null, formatJustifyFull: null, formatJustifyCenter: null,
  formatJustifyRight: null, formatJustifyLeft: null, formatIndent: null, formatOutdent: null, formatRemove: null,
  formatSetBlockTextDirection: 'rtl', formatSetInlineTextDirection: 'auto',
  formatBackColor: 'rgb(0, 0, 0)', formatFontColor: 'rgb(255, 255, 255)', formatFontName: 'serif',
};
