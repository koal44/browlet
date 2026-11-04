import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { ActivePointers, PointerButton } from '../../../src/browlet/interaction/index';
import { PointerEventImpl } from '../../../src/browlet/interaction/events/index';
import { getRelevantRealm } from '../../support/browlet-binding';

describe('Pointer Events §§3.1.1–3.1.2: active input state', () => {
  it('selects the first active pointer separately for each pointer type', () => {
    const pointers = new ActivePointers();
    const results = ['mouse', 'touch', 'pen', 'touch', 'pen', 'vendor-device', 'vendor-device']
      .map((type) => pointers.activate(type));
    expect(results.map((pointer) => [pointer.pointerType, pointer.isPrimary, pointer.buttons])).toEqual([
      ['mouse', true, 0], ['touch', true, 0], ['pen', true, 0], ['touch', false, 0],
      ['pen', false, 0], ['vendor-device', true, 0], ['vendor-device', false, 0],
    ]);
  });

  it('does not promote a remaining or newly added pointer while its type still has active sources', () => {
    const pointers = new ActivePointers();
    const first = pointers.activate('touch');
    const second = pointers.activate('touch');
    pointers.deactivate(first);
    const third = pointers.activate('touch');
    expect([second.isPrimary, third.isPrimary]).toEqual([false, false]);
    pointers.deactivate(second);
    expect(third.isPrimary).toBe(false);
    pointers.deactivate(third);
    expect(pointers.activate('touch').isPrimary).toBe(true);
  });

  it('keeps a hovering source active after releasing its last button', () => {
    const pointers = new ActivePointers();
    const pen = pointers.activate('pen');
    expect(pen.buttons).toBe(0);
    expect(pen.changeButton(PointerButton.Primary, true)?.type).toBe('pointerdown');
    expect(pen.changeButton(PointerButton.Primary, false)?.type).toBe('pointerup');
    expect(pen.buttons).toBe(0);
    expect(pointers.activate('pen').isPrimary).toBe(false);
  });

  it('keeps other pointer types independent when retiring a primary pointer', () => {
    const pointers = new ActivePointers();
    const mouse = pointers.activate('mouse');
    const touch = pointers.activate('touch');
    pointers.deactivate(touch);
    const next = pointers.activate('touch');
    expect(next).not.toBe(touch);
    expect([next.isPrimary, mouse.isPrimary, pointers.activate('mouse').isPrimary]).toEqual([true, true, false]);
  });

  it.each([
    [PointerButton.Primary, 1], [PointerButton.Auxiliary, 4], [PointerButton.Secondary, 2],
    [PointerButton.Back, 8], [PointerButton.Forward, 16], [PointerButton.Eraser, 32],
  ])('maps changed button %i to held-button bit %i', (button, mask) => {
    const pointer = new ActivePointers().activate('pen');
    expect(pointer.changeButton(button, true)).toEqual({ type: 'pointerdown', button, buttons: mask });
    expect(pointer.buttons).toBe(mask);
    expect(pointer.changeButton(button, false)).toEqual({ type: 'pointerup', button, buttons: 0 });
    expect(pointer.buttons).toBe(0);
  });

  it('uses pointermove for chord changes and pointerup only when the last button is released', () => {
    const pointer = new ActivePointers().activate('mouse');
    const results = [pointer.changeButton(PointerButton.Primary, true),
      pointer.changeButton(PointerButton.Secondary, true), pointer.changeButton(PointerButton.Primary, false),
      pointer.changeButton(PointerButton.Secondary, false)];
    expect(results).toEqual([
      { type: 'pointerdown', button: 0, buttons: 1 }, { type: 'pointermove', button: 2, buttons: 3 },
      { type: 'pointermove', button: 0, buttons: 2 }, { type: 'pointerup', button: 2, buttons: 0 },
    ]);
    expect(pointer.isPrimary).toBe(true);
  });

  it('combines all held buttons without confusing middle/right numbering or losing other bits', () => {
    const pointer = new ActivePointers().activate('pen');
    const buttons = [PointerButton.Primary, PointerButton.Auxiliary, PointerButton.Secondary,
      PointerButton.Back, PointerButton.Forward, PointerButton.Eraser];
    expect(buttons.map((button) => pointer.changeButton(button, true)?.buttons)).toEqual([1, 5, 7, 15, 31, 63]);
    expect(buttons.map((button) => pointer.changeButton(button, false)?.buttons)).toEqual([62, 58, 56, 48, 32, 0]);
  });

  it('does not create transitions for repeated presses or releases', () => {
    const pointer = new ActivePointers().activate('mouse');
    expect(pointer.changeButton(PointerButton.Auxiliary, false)).toBeNull();
    pointer.changeButton(PointerButton.Auxiliary, true);
    expect(pointer.changeButton(PointerButton.Auxiliary, true)).toBeNull();
    expect(pointer.buttons).toBe(4);
    pointer.changeButton(PointerButton.Auxiliary, false);
    expect(pointer.changeButton(PointerButton.Auxiliary, false)).toBeNull();
    expect(pointer.buttons).toBe(0);
  });

  it('treats pen contact changes while the barrel is held as chord transitions', () => {
    const pointer = new ActivePointers().activate('pen');
    expect(pointer.changeButton(PointerButton.Secondary, true)).toEqual({ type: 'pointerdown', button: 2, buttons: 2 });
    expect(pointer.changeButton(PointerButton.Primary, true)).toEqual({ type: 'pointermove', button: 0, buttons: 3 });
    expect(pointer.changeButton(PointerButton.Primary, false)).toEqual({ type: 'pointermove', button: 0, buttons: 2 });
    expect(pointer.changeButton(PointerButton.Secondary, false)).toEqual({ type: 'pointerup', button: 2, buttons: 0 });
  });

  it('retains event snapshots independently of later button changes', () => {
    const pointer = new ActivePointers().activate('mouse');
    const down = pointer.changeButton(PointerButton.Primary, true)!;
    const event = new PointerEventImpl(down.type, {
      button: down.button, buttons: down.buttons, pointerType: pointer.pointerType, isPrimary: pointer.isPrimary,
    });
    pointer.changeButton(PointerButton.Primary, false);
    expect([event.type, event.button, event.buttons, event.pointerType, event.isPrimary])
      .toEqual(['pointerdown', 0, 1, 'mouse', true]);
    expect(pointer.buttons).toBe(0);
  });

  it('belongs to the UserAgent across document replacement, with independent state in another browser', async () => {
    const browser = new Browlet({ route: () => '' });
    const other = new Browlet({ route: () => '' });
    const pointers = getRelevantRealm(browser.window).env.userAgent.activePointers;
    const first = pointers.activate('mouse');
    first.changeButton(PointerButton.Primary, true);
    await browser.navigate('https://pointer.test/');
    expect(getRelevantRealm(browser.window).env.userAgent.activePointers).toBe(pointers);
    expect(first.buttons).toBe(1);
    expect(getRelevantRealm(other.window).env.userAgent.activePointers.activate('mouse').isPrimary).toBe(true);
  });

  it('does not let author construction, dispatch, or cancellation alter the active input sources', async () => {
    const browser = new Browlet({ route: () => '' });
    const pointers = getRelevantRealm(browser.window).env.userAgent.activePointers;
    const pointer = pointers.activate('mouse');
    pointer.changeButton(PointerButton.Primary, true);
    expect(await browser.evaluate(() => {
      document.addEventListener('pointerup', (event) => event.preventDefault(), { once: true });
      return document.dispatchEvent(new PointerEvent('pointerup', {
        cancelable: true, buttons: 0, pointerType: 'touch', isPrimary: true,
      }));
    })).toBe(false);
    expect(pointer.buttons).toBe(1);
    expect(pointers.activate('touch').isPrimary).toBe(true);
    expect(pointer.changeButton(PointerButton.Secondary, true)).toEqual({ type: 'pointermove', button: 2, buttons: 3 });
  });
});
