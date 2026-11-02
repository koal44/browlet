import type {
  Window, WindowProxy, Document, Element, Event, EventTarget, Blob, File, Response,
  URLSearchParams, Node, Location,
} from '../../../../src/browlet/platform';
import type * as Platform from '../../../../src/browlet/platform';

// These are independent author-side examples. No lib.dom or Node declarations participate.
declare const window: WindowProxy;

const childWindow: WindowProxy | undefined = window[0];
const grandchildWindow: WindowProxy | undefined = childWindow?.[0];
const childThroughFrames: WindowProxy | undefined = window.frames[0];
// @ts-expect-error an index can be absent
const requiredChild: WindowProxy = window[0];
// @ts-expect-error child indices cannot be assigned
window[0] = window;
// @ts-expect-error WindowProxy has no iterator
window[Symbol.iterator]();
// @ts-expect-error numeric child access does not declare arbitrary named properties
window.undeclaredChildName;

const global: Window = window.window;
const document: Document = global.document;
const originAgentCluster: boolean = window.originAgentCluster;
const domain: string = document.domain;
document.domain = domain;
const element: Element = document.createElement('div');
const node: Node = element;
const tokens: Platform.DOMTokenList = element.classList;
element.classList = 'one two';
tokens.value = 'one';
tokens.add('two', 'three');
const token: string | null = tokens.item(0);
const tokenEntries: IterableIterator<[number, string]> = tokens.entries();
tokens.forEach((value, index, list) => { const typed: [string, number, Platform.DOMTokenList] = [value, index, list]; });
// @ts-expect-error length is readonly
tokens.length = 0;
// @ts-expect-error forwarded classList assignment uses DOMTokenList.value
element.classList = 3;
// @ts-expect-error DOMTokenList has no public constructor
new window.DOMTokenList();
const location: Location = window.location;
window.location = 'https://example.test/next';

declare const strings: Platform.DOMStringList;
const stringItem: string | null = strings.item(0);
const hasString: boolean = strings.contains('value');
// Indexed declaration types conservatively retain the nullable IDL getter result.
const stringIndex: string | null | undefined = strings[0];
const stringValues: IterableIterator<string | null> = strings[Symbol.iterator]();
// @ts-expect-error length is readonly
strings.length = 0;
// @ts-expect-error indexed strings cannot be replaced
strings[0] = 'replacement';
// @ts-expect-error DOMStringList has no public constructor
new window.DOMStringList();

const walker: Platform.TreeWalker = document.createTreeWalker(node, window.NodeFilter.SHOW_ELEMENT,
  { acceptNode: (candidate) => candidate === element ? window.NodeFilter.FILTER_ACCEPT : window.NodeFilter.FILTER_SKIP });
walker.currentNode = document;
const nextNode: Node | null = walker.nextNode();
// @ts-expect-error a traversal root cannot be replaced
walker.root = node;
// @ts-expect-error TreeWalker has no public constructor
new window.TreeWalker();

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
  const cssText: string = element.style.cssText;
  element.style.cssText = cssText;
}
// @ts-expect-error a type export does not create an exported runtime constructor
new Platform.URL('https://example.test/');

const trustedPolicy: Platform.TrustedTypePolicy = window.trustedTypes.createPolicy('app', {
  createHTML: (input, ...args) => args.length ? input : null,
  createScriptURL: (input) => input,
});
const trustedValue: Platform.TrustedType = trustedPolicy.createHTML('<b>text</b>');
element.setAttribute('srcdoc', trustedValue);
element.setAttributeNS(null, 'srcdoc', trustedValue);
element.setAttribute('title', 'ordinary');
const attribute = window.document.createAttribute('srcdoc');
// @ts-expect-error Attr.value remains DOMString, rather than the Element setters' trusted union
attribute.value = trustedValue;
const trustedJSON: string = trustedValue.toJSON();
const defaultPolicy: Platform.TrustedTypePolicy | null = window.trustedTypes.defaultPolicy;
const sinkType: string | null = window.trustedTypes.getAttributeType('script', 'src', null);
void [trustedJSON, defaultPolicy, sinkType];
// @ts-expect-error trusted values are made by policies, not public constructors
new window.TrustedHTML();
// @ts-expect-error parser options await the Sanitizer integration
trustedPolicy.createParserOptions({});
// @ts-expect-error factory identity is read-only on the global
window.trustedTypes = {} as Platform.TrustedTypePolicyFactory;

const wasmModule: Platform.Module = new window.WebAssembly.Module(new Uint8Array(), {
  builtins: ['js-string'], importedStringConstants: 'strings',
});
const wasmSections: ArrayBuffer[] = window.WebAssembly.Module.customSections(wasmModule, 'meta');
// @ts-expect-error Module construction requires a buffer source
new window.WebAssembly.Module();
// @ts-expect-error a constructor cannot be called without new
window.WebAssembly.Module(new Uint8Array());
// @ts-expect-error Module lives on the WebAssembly namespace
new window.Module(new Uint8Array());

const wasmInstance: Platform.Instance = new window.WebAssembly.Instance(wasmModule);
new window.WebAssembly.Instance(wasmModule, { env: { run: () => 42 } });
// @ts-expect-error Instance construction requires a Module
new window.WebAssembly.Instance();
// @ts-expect-error importObject must be an object when supplied
new window.WebAssembly.Instance(wasmModule, 42);
// @ts-expect-error Instance lives on the WebAssembly namespace
new window.Instance(wasmModule);

const wasmMemory: Platform.Memory = new window.WebAssembly.Memory({ initial: 1, maximum: 2 });
new window.WebAssembly.Memory({ address: 'i64', initial: 0n, maximum: 1n, shared: true });
// @ts-expect-error Memory construction requires an initial size
new window.WebAssembly.Memory({ maximum: 2 });
// @ts-expect-error AddressType is an enum, not an arbitrary string
new window.WebAssembly.Memory({ initial: 0, address: 'bad' });
// @ts-expect-error Memory lives on the WebAssembly namespace
new window.Memory({ initial: 0 });

const wasmTable: Platform.Table = new window.WebAssembly.Table({ element: 'externref', initial: 1 }, window.document);
new window.WebAssembly.Table({ address: 'i64', element: 'anyfunc', initial: 0n, maximum: 1n });
// @ts-expect-error Table construction requires its element type
new window.WebAssembly.Table({ initial: 0 });
// @ts-expect-error Table construction requires its initial size
new window.WebAssembly.Table({ element: 'externref' });
// @ts-expect-error TableKind follows the current draft's two reference kinds
new window.WebAssembly.Table({ element: 'funcref', initial: 0 });
// @ts-expect-error Table lives on the WebAssembly namespace
new window.Table({ element: 'externref', initial: 0 });

const wasmGlobal: Platform.Global = new window.WebAssembly.Global({ value: 'externref', mutable: true }, window.document);
new window.WebAssembly.Global({ value: 'i64' }, 1n);
// @ts-expect-error Global construction requires its value type
new window.WebAssembly.Global({ mutable: true });
// @ts-expect-error ValueType follows the current draft, not V8's extended reference kinds
new window.WebAssembly.Global({ value: 'anyref' });
// @ts-expect-error Global lives on the WebAssembly namespace
new window.Global({ value: 'i32' });
