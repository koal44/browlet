import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { getRelevantRealm } from '../../../support/browlet-binding';
import { useFixture } from '../../../support/fixture';

describe('Input Events Level 2 §6.1: event data and target ranges', () => {
  const prepared = useFixture(() => new Browlet({ route: () => '' }));

  it.each(['beforeinput', 'input', 'custom'])('defaults %s to null data and fresh empty target-range arrays', async (type) => {
    expect(await prepared().evaluate((type) => {
      const event = new InputEvent(type);
      const ranges = event.getTargetRanges();
      return [event.dataTransfer, ranges.length, Array.isArray(ranges), Object.isFrozen(ranges),
        ranges !== event.getTargetRanges(), event.bubbles, event.cancelable, event.composed, event.isTrusted];
    }, type)).toEqual([null, 0, true, false, true, false, false, false, false]);
  });

  it('retains a supplied transfer and its writable store even for a text insertion', async () => {
    expect(await prepared().evaluate(() => {
      const transfer = new DataTransfer();
      transfer.setData('text', 'before');
      const file = new File(['file'], 'a.txt');
      transfer.items.add(file);
      const init = { dataTransfer: transfer, inputType: 'insertText', data: 'text' };
      const event = new InputEvent('input', init);
      init.dataTransfer = new DataTransfer();
      event.dataTransfer!.setData('text', 'after');
      return [event.dataTransfer === transfer, event.dataTransfer === event.dataTransfer,
        transfer.getData('text'), event.dataTransfer!.files[0] === file, event.data];
    })).toEqual([true, true, 'after', true, 'text']);
  });

  it.each(['beforeinput', 'input', 'custom'])('preserves the supplied %s sequence and snapshot identities', async (type) => {
    expect(await prepared().evaluate((type) => {
      const text = document.createTextNode('abcdef');
      const range = new StaticRange({ startContainer: text, startOffset: 1, endContainer: text, endOffset: 5 });
      const source = [range, range];
      const event = new InputEvent(type, { targetRanges: source, inputType: 'historyUndo' });
      source.length = 0;
      const first = event.getTargetRanges();
      const second = event.getTargetRanges();
      first.pop(); first[0] = new StaticRange({ startContainer: text, startOffset: 0, endContainer: text, endOffset: 0 });
      return [first !== second, second.length, second[0] === range, second[1] === range,
        event.getTargetRanges()[0] === range, event.getTargetRanges().length];
    }, type)).toEqual([true, 2, true, true, true, 2]);
  });

  it('converts an iterable once and retains snapshots with disconnected, reversed, or out-of-bounds endpoints', async () => {
    expect(await prepared().evaluate(() => {
      const first = document.createTextNode('abc');
      const second = document.createTextNode('def');
      const range = new StaticRange({ startContainer: first, startOffset: 99, endContainer: second, endOffset: 80 });
      const reversed = new StaticRange({ startContainer: first, startOffset: 3, endContainer: first, endOffset: 1 });
      let iterations = 0;
      const targetRanges = { *[Symbol.iterator]() { iterations++; yield range; yield reversed; } };
      const event = Reflect.construct(InputEvent, ['beforeinput', { targetRanges }]) as InputEvent;
      const ranges = event.getTargetRanges();
      event.getTargetRanges();
      return [iterations, ranges[0] === range, ranges[1] === reversed,
        ranges.map((r) => [r.startOffset, r.endOffset])];
    })).toEqual([1, true, true, [[99, 80], [3, 1]]]);
  });

  it('keeps snapshots through DOM edits, canceled dispatch, repeated dispatch, and legacy initialization', async () => {
    expect(await prepared().evaluate(() => {
      const host = document.createElement('div');
      host.setAttribute('contenteditable', 'true');
      const text = document.createTextNode('abcdef'); host.append(text); document.body.append(host);
      const range = new StaticRange({ startContainer: text, startOffset: 1, endContainer: text, endOffset: 5 });
      const transfer = new DataTransfer();
      const event = new InputEvent('beforeinput', { targetRanges: [range], dataTransfer: transfer, cancelable: true });
      const observed: boolean[] = [];
      let inputCount = 0;
      host.addEventListener('input', () => { inputCount++; });
      host.addEventListener('beforeinput', (e) => {
        observed.push(e.getTargetRanges()[0] === range);
        e.preventDefault();
      });
      // Static snapshots remain unchanged even when they cease to describe valid live points.
      text.deleteData(0, 4);
      const dispatched = host.dispatchEvent(event);
      host.remove();
      const repeated = host.dispatchEvent(event);
      event.initUIEvent('renamed', false, false, window, 0);
      event.initEvent('final');
      const retained = event.getTargetRanges()[0]!;
      return {
        dispatched, repeated, observed, inputCount, text: text.data,
        retained: retained === range, points: [retained.startOffset, retained.endOffset],
        nodes: [retained.startContainer === text, retained.endContainer === text], transfer: event.dataTransfer === transfer,
      };
    })).toEqual({
      dispatched: false, repeated: false, observed: [true, true], inputCount: 0,
      text: 'ef', retained: true, points: [1, 5], nodes: [true, true], transfer: true,
    });
  });

  it('does not derive omitted ranges from the selection or retarget supplied shadow-tree endpoints', async () => {
    expect(await prepared().evaluate(() => {
      const host = document.createElement('div'); document.body.append(host);
      const shadow = host.attachShadow({ mode: 'closed' });
      const text = document.createTextNode('inside'); shadow.append(text);
      const selection = document.getSelection()!;
      selection.setBaseAndExtent(text, 1, text, 4);
      const range = new StaticRange({ startContainer: text, startOffset: 1, endContainer: text, endOffset: 4 });
      const event = new InputEvent('beforeinput', { targetRanges: [range], bubbles: true, composed: true });
      let observed = false;
      document.addEventListener('beforeinput', (e) => {
        const ranges = e.getTargetRanges();
        observed = e.target === host && ranges[0] === range && ranges[0].startContainer === text;
      }, { once: true });
      text.dispatchEvent(event);
      const empty = new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, composed: true });
      text.dispatchEvent(empty);
      return [observed, event.getTargetRanges()[0] === range, empty.getTargetRanges().length];
    })).toEqual([true, true, 0]);
  });

  it('validates DataTransfer, StaticRange, and sequence input at the constructor boundary', async () => {
    expect(await prepared().evaluate(() => {
      const transfer = new DataTransfer();
      const text = document.createTextNode('a');
      const range = new StaticRange({ startContainer: text, startOffset: 0, endContainer: text, endOffset: 1 });
      const invalid = [{ dataTransfer: {} }, { dataTransfer: new Proxy(transfer, {}) },
        { targetRanges: null }, { targetRanges: {} }, { targetRanges: [document.createRange()] },
        { targetRanges: [{}] }, { targetRanges: [new Proxy(range, {})] }];
      const errors = invalid.map((init) => {
        try { Reflect.construct(InputEvent, ['input', init]); return false; }
        catch (error) { return error instanceof TypeError; }
      });
      const defaults = new InputEvent('input', { dataTransfer: undefined, targetRanges: undefined });
      return [errors, defaults.dataTransfer, defaults.getTargetRanges().length];
    })).toEqual([Array<boolean>(7).fill(true), null, 0]);
  });

  it('propagates conversion failures before construction and later dictionary members', async () => {
    expect(await prepared().evaluate(() => {
      const reads: string[] = [];
      const init = {
        get dataTransfer() { reads.push('dataTransfer'); return {}; },
        get inputType() { reads.push('inputType'); return 'insertText'; },
      };
      let invalidTransfer = false;
      try { Reflect.construct(InputEvent, ['input', init]); }
      catch (error) { invalidTransfer = error instanceof TypeError; }
      const sentinel = new Error('range iterator');
      const targetRanges = { [Symbol.iterator](): Iterator<StaticRange> { throw sentinel; } };
      let sameError = false;
      try { Reflect.construct(InputEvent, ['input', { targetRanges }]); }
      catch (error) { sameError = error === sentinel; }
      return [reads, invalidTransfer, sameError];
    })).toEqual([['dataTransfer'], true, true]);
  });

  it('exposes a readonly getter and a zero-argument method with InputEvent receiver checks', async () => {
    expect(await prepared().evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(InputEvent.prototype, 'dataTransfer')!;
      const method = Object.getOwnPropertyDescriptor(InputEvent.prototype, 'getTargetRanges')!;
      const event = new InputEvent('input');
      const invalid = [{}, new Event('input'), new UIEvent('input')].map((receiver) => {
        try { Reflect.apply(method.value as () => StaticRange[], receiver, []); return false; }
        catch (error) { return error instanceof TypeError; }
      });
      let getterInvalid = false;
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Deliberately invoke the getter with an invalid receiver.
      try { Reflect.apply(descriptor.get!, {}, []); } catch (error) { getterInvalid = error instanceof TypeError; }
      return [descriptor.enumerable, descriptor.configurable, descriptor.set === undefined,
        method.enumerable, method.configurable, method.writable, event.getTargetRanges.length,
        Reflect.set(event, 'dataTransfer', new DataTransfer()), invalid, getterInvalid];
    })).toEqual([true, true, true, true, true, true, 0, false, [true, true, true], true]);
  });
});

describe('Input Events Level 2: realm ownership', () => {
  const prepared = useFixture(() => [new Browlet({ route: () => '' }), new Browlet({ route: () => '' })] as const);

  it('uses receiver-realm arrays while retaining foreign transfer and range ownership', () => {
    const [owner, other] = prepared();
    const text = other.document.createTextNode('foreign');
    const range = new other.window.StaticRange({ startContainer: text, startOffset: 1, endContainer: text, endOffset: 5 });
    const transfer = new other.window.DataTransfer();
    const event = new owner.window.InputEvent('input', { targetRanges: [range], dataTransfer: transfer });
    const first = other.window.InputEvent.prototype.getTargetRanges.call(event);
    const second = event.getTargetRanges();
    expect(Object.getPrototypeOf(first)).toBe(getRelevantRealm(owner.window).Array.prototype);
    expect(first).not.toBe(second);
    expect(first[0]).toBe(range);
    expect(second[0]).toBe(range);
    expect(getRelevantRealm(first[0]!)).toBe(getRelevantRealm(other.window));
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise a borrowed getter with its explicit foreign receiver.
    const getter = Object.getOwnPropertyDescriptor(other.window.InputEvent.prototype, 'dataTransfer')!.get!;
    expect(Reflect.apply(getter, event, [])).toBe(transfer);
    expect(getRelevantRealm(event)).toBe(getRelevantRealm(owner.window));
    expect(getRelevantRealm(event.dataTransfer!)).toBe(getRelevantRealm(other.window));
  });
});
