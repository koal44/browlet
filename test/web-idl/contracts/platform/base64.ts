import type { Window } from '../../../../src/browlet/platform';

declare const window: Window;
const encoded: string = window.btoa('binary data');
const decoded: string = window.atob(encoded);
// @ts-expect-error the input argument is required
window.btoa();
// @ts-expect-error the input argument is required
window.atob();
// @ts-expect-error the declared input is DOMString
window.btoa(1);
