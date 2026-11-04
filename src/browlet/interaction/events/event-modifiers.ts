import { defineDictionary, dictMember, idlType } from '../../../web-idl/core/index';

import type { UIEventInit } from './ui-event';

/** An event's modifier snapshot, separate from the UserAgent's current device state. */
// https://w3c.github.io/uievents/#event-modifier-initializers
export class EventModifierState {
  /** Exact UI Events key values for the modifiers active on this event. */
  #active = new Set<string>();

  constructor(init: EventModifierInit = {}) {
    if (init.ctrlKey) this.#active.add('Control');
    if (init.shiftKey) this.#active.add('Shift');
    if (init.altKey) this.#active.add('Alt');
    if (init.metaKey) this.#active.add('Meta');
    if (init.modifierAltGraph) this.#active.add('AltGraph');
    if (init.modifierCapsLock) this.#active.add('CapsLock');
    if (init.modifierFn) this.#active.add('Fn');
    if (init.modifierFnLock) this.#active.add('FnLock');
    if (init.modifierHyper) this.#active.add('Hyper');
    if (init.modifierNumLock) this.#active.add('NumLock');
    if (init.modifierScrollLock) this.#active.add('ScrollLock');
    if (init.modifierSuper) this.#active.add('Super');
    if (init.modifierSymbol) this.#active.add('Symbol');
    if (init.modifierSymbolLock) this.#active.add('SymbolLock');
  }

  // SPEC_CLASH(event-modifier-support): Honor all specified initializers; browsers omit different subsets and Chromium/Firefox additionally recognize Accel.
  getModifierState(keyArg: string): boolean {
    return this.#active.has(keyArg);
  }
}

/** Converted constructor data shared by keyboard and mouse events. */
export interface EventModifierInit extends UIEventInit {
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  modifierAltGraph?: boolean;
  modifierCapsLock?: boolean;
  modifierFn?: boolean;
  modifierFnLock?: boolean;
  modifierHyper?: boolean;
  modifierNumLock?: boolean;
  modifierScrollLock?: boolean;
  modifierSuper?: boolean;
  modifierSymbol?: boolean;
  modifierSymbolLock?: boolean;
}

/*
 * dictionary EventModifierInit : UIEventInit {
 *   boolean ctrlKey = false;
 *   boolean shiftKey = false;
 *   boolean altKey = false;
 *   boolean metaKey = false;
 *   boolean modifierAltGraph = false;
 *   boolean modifierCapsLock = false;
 *   boolean modifierFn = false;
 *   boolean modifierFnLock = false;
 *   boolean modifierHyper = false;
 *   boolean modifierNumLock = false;
 *   boolean modifierScrollLock = false;
 *   boolean modifierSuper = false;
 *   boolean modifierSymbol = false;
 *   boolean modifierSymbolLock = false;
 * };
 */
export const eventModifierInitIDL = defineDictionary({
  name: 'EventModifierInit',
  inherits: 'UIEventInit',
  members: [
    dictMember('ctrlKey', idlType.boolean, { default: false }),
    dictMember('shiftKey', idlType.boolean, { default: false }),
    dictMember('altKey', idlType.boolean, { default: false }),
    dictMember('metaKey', idlType.boolean, { default: false }),
    dictMember('modifierAltGraph', idlType.boolean, { default: false }),
    dictMember('modifierCapsLock', idlType.boolean, { default: false }),
    dictMember('modifierFn', idlType.boolean, { default: false }),
    dictMember('modifierFnLock', idlType.boolean, { default: false }),
    dictMember('modifierHyper', idlType.boolean, { default: false }),
    dictMember('modifierNumLock', idlType.boolean, { default: false }),
    dictMember('modifierScrollLock', idlType.boolean, { default: false }),
    dictMember('modifierSuper', idlType.boolean, { default: false }),
    dictMember('modifierSymbol', idlType.boolean, { default: false }),
    dictMember('modifierSymbolLock', idlType.boolean, { default: false }),
  ],
});
