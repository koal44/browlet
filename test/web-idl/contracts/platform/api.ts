import type {
  Window, WindowProxy, Document, Element, Event, EventTarget, Blob, File, Response,
  URLSearchParams, Node, Location,
} from '../../../../src/browlet/platform';
import type * as Platform from '../../../../src/browlet/platform';

// These are independent author-side examples. No lib.dom or Node declarations participate.
declare const window: WindowProxy;

const global: Window = window.window;
const document: Document = global.document;
const element: Element = document.createElement('div');
const node: Node = element;
const location: Location = window.location;
window.location = 'https://example.test/next';

const event: Event = new window.Event('ready', { bubbles: true });
const target: EventTarget = new window.EventTarget();
target.addEventListener('ready', (received) => { const type: string = received.type; });
target.addEventListener('ready', { handleEvent(received) { const type: string = received.type; } });
target.dispatchEvent(event);

const blob: Blob = new window.Blob(['text'], { endings: 'native' });
const text: Promise<string> = blob.text();
const bytes: Promise<Uint8Array<ArrayBuffer>> = blob.bytes();
const file: File = new window.File([blob], 'example.txt');
const form = new window.FormData();
form.append('file', file, 'upload.txt');
const entries: IterableIterator<[string, string | File]> = form.entries();
const params: URLSearchParams = new window.URLSearchParams(new Map([['one', '1']]));
const result: Promise<Response> = window.fetch('https://example.test/', { headers: params, mode: 'cors' });

const timeout: number = window.setTimeout(() => {}, 1);
window.clearTimeout(timeout);
window.queueMicrotask(() => {});

const cloned = window.structuredClone({ count: 1 });
const count: number = cloned.count;
// @ts-expect-error structuredClone preserves the input's property types
const wrongCount: string = cloned.count;

const customEvent = new window.CustomEvent('data', { detail: { count: 1 } });
const detailCount: number = customEvent.detail.count;
// @ts-expect-error the constructor infers the event's detail type
const wrongDetail: string = customEvent.detail.count;

declare const unknown: unknown;
if (unknown instanceof window.Node) { const narrowed: Node = unknown; }

// @ts-expect-error the Window platform object has no internal environment
window.env;
// @ts-expect-error generated interfaces do not claim unimplemented lib.dom members
window.alert('hello');
// @ts-expect-error readonly document attribute
window.document = document;
// @ts-expect-error forwarded assignment uses Location.href
window.location = 7;
// @ts-expect-error enum value must be declared
new window.Blob([], { endings: 'invalid' });
// @ts-expect-error Window has an interface object, but no author constructor
new window.Window();
// @ts-expect-error the public Promise carries a Blob's string result
const wrong: Promise<number> = blob.text();
if (element instanceof window.HTMLElement) {
  // @ts-expect-error CSSOM's provisional object declaration does not describe its members
  element.style.cssText;
}
// @ts-expect-error a type export does not create an exported runtime constructor
new Platform.URL('https://example.test/');
