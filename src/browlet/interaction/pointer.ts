import { definePartialInterface, idlType, roAttr } from '../../web-idl/core/index';

/** Active input sources shared by a UserAgent, independently of event objects and Documents. */
// https://w3c.github.io/pointerevents/#the-primary-pointer
export class ActivePointers {
  /** Retain live sources until the input producer reports that they can no longer produce events. */
  #pointers = new Set<ActivePointer>();

  /** Begin one pointer's lifetime; a mouse or hovering pen can be active without pressed buttons. */
  activate(pointerType: string): ActivePointer {
    let isPrimary = true;
    for (const pointer of this.#pointers) {
      if (pointer.pointerType === pointerType) {
        isPrimary = false;
        break;
      }
    }
    const pointer = new ActivePointer(pointerType, isPrimary);
    this.#pointers.add(pointer);
    return pointer;
  }

  /** Retire a source after its final notifications; remaining sources keep their primary status. */
  deactivate(pointer: ActivePointer): void {
    this.#pointers.delete(pointer);
  }
}

/** One live input source. Event constructors and dispatch never mutate this state. */
// https://w3c.github.io/pointerevents/#button-states
// TODO(Pointer Events §§3.1, 3.1.3): the producer must map these sources to
// top-level-context-local pointerIds, determine targets, and deliver ordered events.
// Source identity here must not become an author-visible, cross-context pointerId.
export class ActivePointer {
  pointerType: string;
  isPrimary: boolean;
  /** Current contact/button state; unlike the source lifetime, this can become zero while hovering. */
  #buttons = 0;

  constructor(pointerType: string, isPrimary: boolean) {
    this.pointerType = pointerType;
    this.isPrimary = isPrimary;
  }

  get buttons(): number { return this.#buttons; }

  /** Apply one normalized contact/button action, returning null when its state did not change. */
  changeButton(button: PointerButton, pressed: boolean): PointerButtonChange | null {
    // The middle and right button numbers are transposed in the held-button mask.
    const mask = button === PointerButton.Auxiliary ? 4 : button === PointerButton.Secondary ? 2 : 1 << button;
    const previous = this.#buttons;
    const buttons = pressed ? previous | mask : previous & ~mask;
    if (buttons === previous) return null;
    this.#buttons = buttons;

    // SPEC_CLASH(pointer-chord-release): Follow Pointer Events and Chromium/Firefox; the probed WebKit fires pointerup while another button remains pressed.
    const type = previous === 0 ? 'pointerdown' : buttons === 0 ? 'pointerup' : 'pointermove';
    return { type, button, buttons };
  }
}

/** Normalized changed-button values; Primary also represents touch or pen contact. */
export enum PointerButton {
  Primary = 0,
  Auxiliary = 1,
  Secondary = 2,
  Back = 3,
  Forward = 4,
  Eraser = 5,
}

/** A button transition for the producer; movement without a transition separately uses button = -1. */
export type PointerButtonChange = {
  type: 'pointerdown' | 'pointermove' | 'pointerup';
  button: PointerButton;
  buttons: number;
};

/*
 * partial interface Navigator {
 *   readonly attribute long maxTouchPoints;
 * };
 */
// https://w3c.github.io/pointerevents/#extensions-to-the-navigator-interface
export const navigatorPointerEventsIDL = definePartialInterface({
  name: 'Navigator',
  members: [roAttr('maxTouchPoints', idlType.long)],
});
