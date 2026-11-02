import type { BeforeUnloadEvent, Event, HTMLBodyElement, HTMLFrameSetElement, Window } from '../../../../src/browlet/platform';

declare const window: Window;
declare const event: BeforeUnloadEvent;
declare const body: HTMLBodyElement;
declare const frameset: HTMLFrameSetElement;

const value: string = event.returnValue;
const base: Event = event;
window.dispatchEvent(event);
window.onbeforeunload = () => 'stay';
body.onbeforeunload = () => null;
frameset.onbeforeunload = window.onbeforeunload;
// @ts-expect-error The declared callback returns nullable DOMString, not an ordinary handler's any.
window.onbeforeunload = () => false;
// @ts-expect-error BeforeUnloadEvent has no author-facing constructor.
new window.BeforeUnloadEvent();
void value;
void base;
