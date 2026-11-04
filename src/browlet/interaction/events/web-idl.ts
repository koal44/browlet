import { uiEventIDL, uiEventInitIDL, uiEventInitializersIDL, uiEventLegacyAttributesIDL } from './ui-event';
import { focusEventIDL, focusEventInitIDL } from './focus-event';
import { inputEventIDL, inputEventInitIDL } from './input-event';
import { eventModifierInitIDL } from './event-modifiers';
import {
  keyboardEventIDL, keyboardEventInitIDL, keyboardEventInitializersIDL,
  keyboardEventLegacyAttributesIDL, keyboardEventLegacyInitIDL,
} from './keyboard-event';
import { compositionEventIDL, compositionEventInitIDL, compositionEventInitializersIDL } from './composition-event';
import { textEventIDL } from './text-event';
import {
  mouseEventIDL, mouseEventInitIDL, mouseEventInitializersIDL, mouseEventMovementIDL, mouseEventMovementInitIDL,
} from './mouse-event';
import { pointerEventIDL, pointerEventInitIDL } from './pointer-event';

/** User-interface event declarations, independent of native input and higher-level producers. */
export const interactionEventIDLDefinitions = [
  uiEventIDL, uiEventInitIDL, uiEventInitializersIDL, uiEventLegacyAttributesIDL,
  focusEventIDL, focusEventInitIDL,
  inputEventIDL, inputEventInitIDL,
  eventModifierInitIDL, keyboardEventIDL, keyboardEventInitIDL,
  keyboardEventInitializersIDL, keyboardEventLegacyAttributesIDL, keyboardEventLegacyInitIDL,
  compositionEventIDL, compositionEventInitIDL, compositionEventInitializersIDL,
  textEventIDL,
  mouseEventIDL, mouseEventInitIDL, mouseEventInitializersIDL, mouseEventMovementIDL, mouseEventMovementInitIDL,
  pointerEventIDL, pointerEventInitIDL,
];
