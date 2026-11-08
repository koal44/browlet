import type { Window } from '../../../../src/browlet/platform';

declare const window: Window;
const noMessage: void = window.alert();
const message: void = window.alert('message');
// @ts-expect-error the supplied message is a DOMString
window.alert(1);

const confirmed: boolean = window.confirm();
const confirmedMessage: boolean = window.confirm('message');
const confirmedUndefined: boolean = window.confirm(undefined);
const prompted: string | null = window.prompt();
const promptedMessage: string | null = window.prompt('message');
const promptedDefault: string | null = window.prompt('message', 'default');
const promptedUndefined: string | null = window.prompt(undefined, undefined);
// @ts-expect-error confirmation messages use DOMString
window.confirm(1);
// @ts-expect-error prompt defaults use DOMString
window.prompt('message', 1);
