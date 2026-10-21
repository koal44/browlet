// Generated from Web IDL declarations. Do not edit by hand.

// Platform types only; importing this module does not install or export runtime objects.

/** Inherit static properties; each interface supplies its own construction, prototype, and brand. */
type Ctor<T> = Omit<T, 'prototype' | typeof Symbol.hasInstance>;

export type DocumentReadyState = "loading" | "interactive" | "complete";

export type DocumentVisibilityState = "visible" | "hidden";

export type SecurityPolicyViolationEventDisposition = "enforce" | "report";

export type ShadowRootMode = "open" | "closed";

export type SlotAssignmentMode = "manual" | "named";

export type ReadableStreamType = "bytes";

export type ReadableStreamReaderMode = "byob";

export type EndingType = "transparent" | "native";

export type RequestDestination = "" | "audio" | "audioworklet" | "document" | "embed" | "font" | "frame" | "iframe" | "image" | "json" | "manifest" | "object" | "paintworklet" | "report" | "script" | "sharedworker" | "style" | "text" | "track" | "video" | "worker" | "xslt";

export type RequestMode = "navigate" | "same-origin" | "no-cors" | "cors";

export type RequestCredentials = "omit" | "same-origin" | "include";

export type RequestCache = "default" | "no-store" | "reload" | "no-cache" | "force-cache" | "only-if-cached";

export type RequestRedirect = "follow" | "error" | "manual";

export type RequestDuplex = "half";

export type RequestPriority = "high" | "low" | "auto";

export type ReferrerPolicy = "" | "no-referrer" | "no-referrer-when-downgrade" | "same-origin" | "origin" | "strict-origin" | "origin-when-cross-origin" | "strict-origin-when-cross-origin" | "unsafe-url";

export type ResponseType = "basic" | "cors" | "default" | "error" | "opaque" | "opaqueredirect";

export type ArrayBufferView = Int8Array<ArrayBuffer> | Int16Array<ArrayBuffer> | Int32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer> | BigInt64Array<ArrayBuffer> | BigUint64Array<ArrayBuffer> | Float16Array<ArrayBuffer> | Float32Array<ArrayBuffer> | Float64Array<ArrayBuffer> | DataView<ArrayBuffer>;

export type BufferSource = Int8Array<ArrayBuffer> | Int16Array<ArrayBuffer> | Int32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer> | BigInt64Array<ArrayBuffer> | BigUint64Array<ArrayBuffer> | Float16Array<ArrayBuffer> | Float32Array<ArrayBuffer> | Float64Array<ArrayBuffer> | DataView<ArrayBuffer> | ArrayBuffer;

export type AllowSharedBufferSource = ArrayBuffer | SharedArrayBuffer | Int8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike> | Uint8ClampedArray<ArrayBufferLike> | BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike> | Float16Array<ArrayBufferLike> | Float32Array<ArrayBufferLike> | Float64Array<ArrayBufferLike> | DataView<ArrayBufferLike>;

export type HTMLOrSVGScriptElement = HTMLScriptElement | SVGScriptElement;

export type ReportList = Iterable<Report>;

export type DOMHighResTimeStamp = number;

export type EpochTimeStamp = number;

export type EventHandler = EventHandlerNonNull | null;

export type TimerHandler = string | Function;

export type CSSOMString = string;

export type ReadableStreamController = ReadableStreamDefaultController | ReadableByteStreamController;

export type ReadableStreamReader = ReadableStreamDefaultReader | ReadableStreamBYOBReader;

export type BlobPart = Int8Array<ArrayBuffer> | Int16Array<ArrayBuffer> | Int32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer> | BigInt64Array<ArrayBuffer> | BigUint64Array<ArrayBuffer> | Float16Array<ArrayBuffer> | Float32Array<ArrayBuffer> | Float64Array<ArrayBuffer> | DataView<ArrayBuffer> | ArrayBuffer | Blob | string;

export type FormDataEntryValue = File | string;

export type HeadersInit = Iterable<Iterable<string>> | Record<string, string>;

export type XMLHttpRequestBodyInit = Blob | Int8Array<ArrayBuffer> | Int16Array<ArrayBuffer> | Int32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer> | BigInt64Array<ArrayBuffer> | BigUint64Array<ArrayBuffer> | Float16Array<ArrayBuffer> | Float32Array<ArrayBuffer> | Float64Array<ArrayBuffer> | DataView<ArrayBuffer> | ArrayBuffer | FormData | URLSearchParams | string;

export type BodyInit = ReadableStream | Blob | Int8Array<ArrayBuffer> | Int16Array<ArrayBuffer> | Int32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer> | BigInt64Array<ArrayBuffer> | BigUint64Array<ArrayBuffer> | Float16Array<ArrayBuffer> | Float32Array<ArrayBuffer> | Float64Array<ArrayBuffer> | DataView<ArrayBuffer> | ArrayBuffer | FormData | URLSearchParams | string;

export type RequestInfo = Request | string;

export type TrustedType = TrustedHTML | TrustedScript | TrustedScriptURL;

export type WindowProxy = Window;

export interface QuotaExceededErrorOptions {
  quota?: number;
  requested?: number;
}

export interface ShowPopoverOptions {
  source?: HTMLElement;
}

export interface TogglePopoverOptions {
  source?: HTMLElement;
  force?: boolean;
}

export interface AssignedNodesOptions {
  flatten?: boolean;
}

export interface SecurityPolicyViolationEventInit {
  bubbles?: boolean;
  cancelable?: boolean;
  composed?: boolean;
  blockedURI?: string;
  columnNumber?: number;
  disposition?: SecurityPolicyViolationEventDisposition;
  documentURI?: string;
  effectiveDirective?: string;
  lineNumber?: number;
  originalPolicy?: string;
  referrer?: string;
  sample?: string;
  sourceFile?: string;
  statusCode?: number;
  violatedDirective?: string;
}

export interface ReportingObserverOptions {
  buffered?: boolean;
  types?: Iterable<string>;
}

export interface StructuredSerializeOptions {
  transfer?: Iterable<object>;
}

export interface EventInit {
  bubbles?: boolean;
  cancelable?: boolean;
  composed?: boolean;
}

export interface CustomEventInit<T = any> {
  bubbles?: boolean;
  cancelable?: boolean;
  composed?: boolean;
  detail?: T;
}

export interface EventListenerOptions {
  capture?: boolean;
}

export interface AddEventListenerOptions {
  capture?: boolean;
  once?: boolean;
  passive?: boolean;
  signal?: AbortSignal;
}

export interface StaticRangeInit {
  endContainer: Node;
  endOffset: number;
  startContainer: Node;
  startOffset: number;
}

export interface GetRootNodeOptions {
  composed?: boolean;
}

export interface MutationObserverInit {
  attributeFilter?: Iterable<string>;
  attributeOldValue?: boolean;
  attributes?: boolean;
  characterData?: boolean;
  characterDataOldValue?: boolean;
  childList?: boolean;
  subtree?: boolean;
}

export interface ImportNodeOptions {
  customElementRegistry?: CustomElementRegistry;
  selfOnly?: boolean;
}

export interface ElementCreationOptions {
  customElementRegistry?: CustomElementRegistry | null;
  is?: string;
}

export interface ShadowRootInit {
  clonable?: boolean;
  customElementRegistry?: CustomElementRegistry | null;
  delegatesFocus?: boolean;
  mode: ShadowRootMode;
  serializable?: boolean;
  slotAssignment?: SlotAssignmentMode;
}

export interface CSSStyleSheetInit {
  baseURL?: string | null;
  disabled?: boolean;
  media?: MediaList | string;
}

export interface QueuingStrategy {
  highWaterMark?: number;
  size?: QueuingStrategySize;
}

export interface QueuingStrategyInit {
  highWaterMark: number;
}

export interface UnderlyingSource {
  autoAllocateChunkSize?: number;
  cancel?: UnderlyingSourceCancelCallback;
  pull?: UnderlyingSourcePullCallback;
  start?: UnderlyingSourceStartCallback;
  type?: ReadableStreamType;
}

export interface ReadableStreamGetReaderOptions {
  mode?: ReadableStreamReaderMode;
}

export interface ReadableStreamIteratorOptions {
  preventCancel?: boolean;
}

export interface ReadableWritablePair {
  readable: ReadableStream;
  writable: WritableStream;
}

export interface StreamPipeOptions {
  preventAbort?: boolean;
  preventCancel?: boolean;
  preventClose?: boolean;
  signal?: AbortSignal;
}

export interface ReadableStreamReadResult {
  done?: boolean;
  value?: any;
}

export interface ReadableStreamBYOBReaderReadOptions {
  min?: number;
}

export interface UnderlyingSink {
  abort?: UnderlyingSinkAbortCallback;
  close?: UnderlyingSinkCloseCallback;
  start?: UnderlyingSinkStartCallback;
  type?: any;
  write?: UnderlyingSinkWriteCallback;
}

export interface Transformer {
  cancel?: TransformerCancelCallback;
  flush?: TransformerFlushCallback;
  readableType?: any;
  start?: TransformerStartCallback;
  transform?: TransformerTransformCallback;
  writableType?: any;
}

export interface TextDecoderOptions {
  fatal?: boolean;
  ignoreBOM?: boolean;
}

export interface TextDecodeOptions {
  stream?: boolean;
}

export interface TextEncoderEncodeIntoResult {
  read?: number;
  written?: number;
}

export interface BlobPropertyBag {
  endings?: EndingType;
  type?: string;
}

export interface FilePropertyBag {
  endings?: EndingType;
  type?: string;
  lastModified?: number;
}

export interface ProgressEventInit {
  bubbles?: boolean;
  cancelable?: boolean;
  composed?: boolean;
  lengthComputable?: boolean;
  loaded?: number;
  total?: number;
}

export interface RequestInit {
  body?: ReadableStream | Blob | Int8Array<ArrayBuffer> | Int16Array<ArrayBuffer> | Int32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer> | BigInt64Array<ArrayBuffer> | BigUint64Array<ArrayBuffer> | Float16Array<ArrayBuffer> | Float32Array<ArrayBuffer> | Float64Array<ArrayBuffer> | DataView<ArrayBuffer> | ArrayBuffer | FormData | URLSearchParams | string | null;
  cache?: RequestCache;
  credentials?: RequestCredentials;
  duplex?: RequestDuplex;
  headers?: Iterable<Iterable<string>> | Record<string, string>;
  integrity?: string;
  keepalive?: boolean;
  method?: string;
  mode?: RequestMode;
  priority?: RequestPriority;
  redirect?: RequestRedirect;
  referrer?: string;
  referrerPolicy?: ReferrerPolicy;
  signal?: AbortSignal | null;
  window?: any;
}

export interface ResponseInit {
  headers?: Iterable<Iterable<string>> | Record<string, string>;
  status?: number;
  statusText?: string;
}

export interface TrustedTypePolicyOptions {
  createHTML?: CreateHTMLCallback;
  createScript?: CreateScriptCallback;
  createScriptURL?: CreateScriptURLCallback;
}

export type Function = (...arguments_: Array<any>) => any;

export type VoidFunction = () => void;

export type ReportingObserverCallback = (reports: Array<Report>, observer: ReportingObserver) => void;

export type EventHandlerNonNull = (event: Event) => any;

export type MutationCallback = (mutations: Array<MutationRecord>, observer: MutationObserver) => void;

export type QueuingStrategySize = (chunk: any) => number;

export type UnderlyingSourceStartCallback = (controller: ReadableStreamDefaultController | ReadableByteStreamController) => any;

export type UnderlyingSourcePullCallback = (controller: ReadableStreamDefaultController | ReadableByteStreamController) => void | PromiseLike<void>;

export type UnderlyingSourceCancelCallback = (reason?: any) => void | PromiseLike<void>;

export type UnderlyingSinkStartCallback = (controller: WritableStreamDefaultController) => any;

export type UnderlyingSinkWriteCallback = (chunk: any, controller: WritableStreamDefaultController) => void | PromiseLike<void>;

export type UnderlyingSinkCloseCallback = () => void | PromiseLike<void>;

export type UnderlyingSinkAbortCallback = (reason?: any) => void | PromiseLike<void>;

export type TransformerStartCallback = (controller: TransformStreamDefaultController) => any;

export type TransformerFlushCallback = (controller: TransformStreamDefaultController) => void | PromiseLike<void>;

export type TransformerTransformCallback = (chunk: any, controller: TransformStreamDefaultController) => void | PromiseLike<void>;

export type TransformerCancelCallback = (reason: any) => void | PromiseLike<void>;

export type CreateHTMLCallback = (input: string, ...arguments_: Array<any>) => string | null;

export type CreateScriptCallback = (input: string, ...arguments_: Array<any>) => string | null;

export type CreateScriptURLCallback = (input: string, ...arguments_: Array<any>) => string | null;

export type EventListener = {
  handleEvent(event: Event): void;
} | ((event: Event) => void);

export type NodeFilter = {
  acceptNode(node: Node): number;
} | ((node: Node) => number);

export interface NodeFilterInterfaceObject {
  readonly FILTER_ACCEPT: 1;
  readonly FILTER_REJECT: 2;
  readonly FILTER_SKIP: 3;
  readonly SHOW_ALL: 4294967295;
  readonly SHOW_ELEMENT: 1;
  readonly SHOW_ATTRIBUTE: 2;
  readonly SHOW_TEXT: 4;
  readonly SHOW_CDATA_SECTION: 8;
  readonly SHOW_ENTITY_REFERENCE: 16;
  readonly SHOW_ENTITY: 32;
  readonly SHOW_PROCESSING_INSTRUCTION: 64;
  readonly SHOW_COMMENT: 128;
  readonly SHOW_DOCUMENT: 256;
  readonly SHOW_DOCUMENT_TYPE: 512;
  readonly SHOW_DOCUMENT_FRAGMENT: 1024;
  readonly SHOW_NOTATION: 2048;
}

export interface DOMException {
  readonly name: string;
  readonly message: string;
  readonly code: number;
  readonly INDEX_SIZE_ERR: 1;
  readonly DOMSTRING_SIZE_ERR: 2;
  readonly HIERARCHY_REQUEST_ERR: 3;
  readonly WRONG_DOCUMENT_ERR: 4;
  readonly INVALID_CHARACTER_ERR: 5;
  readonly NO_DATA_ALLOWED_ERR: 6;
  readonly NO_MODIFICATION_ALLOWED_ERR: 7;
  readonly NOT_FOUND_ERR: 8;
  readonly NOT_SUPPORTED_ERR: 9;
  readonly INUSE_ATTRIBUTE_ERR: 10;
  readonly INVALID_STATE_ERR: 11;
  readonly SYNTAX_ERR: 12;
  readonly INVALID_MODIFICATION_ERR: 13;
  readonly NAMESPACE_ERR: 14;
  readonly INVALID_ACCESS_ERR: 15;
  readonly VALIDATION_ERR: 16;
  readonly TYPE_MISMATCH_ERR: 17;
  readonly SECURITY_ERR: 18;
  readonly NETWORK_ERR: 19;
  readonly ABORT_ERR: 20;
  readonly URL_MISMATCH_ERR: 21;
  readonly QUOTA_EXCEEDED_ERR: 22;
  readonly TIMEOUT_ERR: 23;
  readonly INVALID_NODE_TYPE_ERR: 24;
  readonly DATA_CLONE_ERR: 25;
}

export interface DOMExceptionConstructor {
  readonly prototype: DOMException;
  [Symbol.hasInstance](value: unknown): value is DOMException;
  new (message?: string, name?: string): DOMException;
  readonly INDEX_SIZE_ERR: 1;
  readonly DOMSTRING_SIZE_ERR: 2;
  readonly HIERARCHY_REQUEST_ERR: 3;
  readonly WRONG_DOCUMENT_ERR: 4;
  readonly INVALID_CHARACTER_ERR: 5;
  readonly NO_DATA_ALLOWED_ERR: 6;
  readonly NO_MODIFICATION_ALLOWED_ERR: 7;
  readonly NOT_FOUND_ERR: 8;
  readonly NOT_SUPPORTED_ERR: 9;
  readonly INUSE_ATTRIBUTE_ERR: 10;
  readonly INVALID_STATE_ERR: 11;
  readonly SYNTAX_ERR: 12;
  readonly INVALID_MODIFICATION_ERR: 13;
  readonly NAMESPACE_ERR: 14;
  readonly INVALID_ACCESS_ERR: 15;
  readonly VALIDATION_ERR: 16;
  readonly TYPE_MISMATCH_ERR: 17;
  readonly SECURITY_ERR: 18;
  readonly NETWORK_ERR: 19;
  readonly ABORT_ERR: 20;
  readonly URL_MISMATCH_ERR: 21;
  readonly QUOTA_EXCEEDED_ERR: 22;
  readonly TIMEOUT_ERR: 23;
  readonly INVALID_NODE_TYPE_ERR: 24;
  readonly DATA_CLONE_ERR: 25;
}

export interface QuotaExceededError extends DOMException {
  readonly quota: number | null;
  readonly requested: number | null;
}

export interface QuotaExceededErrorConstructor extends Ctor<DOMExceptionConstructor> {
  readonly prototype: QuotaExceededError;
  [Symbol.hasInstance](value: unknown): value is QuotaExceededError;
  new (message?: string, options?: QuotaExceededErrorOptions): QuotaExceededError;
}

export interface HTMLAllCollection {
  readonly length: number;
  namedItem(name: string): HTMLCollection | Element | null;
  item(nameOrIndex?: string): HTMLCollection | Element | null;
  readonly [index: number]: Element | undefined;
  [Symbol.iterator](): IterableIterator<Element>;
}

export interface HTMLAllCollectionConstructor {
  readonly prototype: HTMLAllCollection;
  [Symbol.hasInstance](value: unknown): value is HTMLAllCollection;
}

export interface CustomElementRegistry {

}

export interface CustomElementRegistryConstructor {
  readonly prototype: CustomElementRegistry;
  [Symbol.hasInstance](value: unknown): value is CustomElementRegistry;
}

export interface ElementInternals {
  readonly shadowRoot: ShadowRoot | null;
}

export interface ElementInternalsConstructor {
  readonly prototype: ElementInternals;
  [Symbol.hasInstance](value: unknown): value is ElementInternals;
}

export interface HTMLElement extends Element {
  title: string;
  lang: string;
  translate: boolean;
  dir: string;
  inert: boolean;
  accessKey: string;
  headingOffset: number;
  headingReset: boolean;
  get style(): CSSStyleProperties;
  set style(value: string);
  nonce: string;
  autofocus: boolean;
}

export interface HTMLElementConstructor extends Ctor<ElementConstructor> {
  readonly prototype: HTMLElement;
  [Symbol.hasInstance](value: unknown): value is HTMLElement;
  new (): HTMLElement;
}

export interface HTMLUnknownElement extends HTMLElement {

}

export interface HTMLUnknownElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLUnknownElement;
  [Symbol.hasInstance](value: unknown): value is HTMLUnknownElement;
}

export interface HTMLHtmlElement extends HTMLElement {

}

export interface HTMLHtmlElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLHtmlElement;
  [Symbol.hasInstance](value: unknown): value is HTMLHtmlElement;
  new (): HTMLHtmlElement;
}

export interface HTMLScriptElement extends HTMLElement {
  get blocking(): DOMTokenList;
  set blocking(value: string);
  crossOrigin: string | null;
  referrerPolicy: string;
  fetchPriority: string;
}

export interface HTMLScriptElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLScriptElement;
  [Symbol.hasInstance](value: unknown): value is HTMLScriptElement;
  new (): HTMLScriptElement;
}

export interface HTMLSlotElement extends HTMLElement {
  name: string;
  assignedNodes(options?: AssignedNodesOptions): Array<Node>;
  assignedElements(options?: AssignedNodesOptions): Array<Element>;
  assign(...nodes: Array<Element | Text>): void;
}

export interface HTMLSlotElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLSlotElement;
  [Symbol.hasInstance](value: unknown): value is HTMLSlotElement;
  new (): HTMLSlotElement;
}

export interface HTMLTemplateElement extends HTMLElement {

}

export interface HTMLTemplateElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLTemplateElement;
  [Symbol.hasInstance](value: unknown): value is HTMLTemplateElement;
  new (): HTMLTemplateElement;
}

export interface HTMLCanvasElement extends HTMLElement {

}

export interface HTMLCanvasElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLCanvasElement;
  [Symbol.hasInstance](value: unknown): value is HTMLCanvasElement;
  new (): HTMLCanvasElement;
}

export interface HTMLHeadElement extends HTMLElement {

}

export interface HTMLHeadElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLHeadElement;
  [Symbol.hasInstance](value: unknown): value is HTMLHeadElement;
  new (): HTMLHeadElement;
}

export interface HTMLTitleElement extends HTMLElement {
  text: string;
}

export interface HTMLTitleElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLTitleElement;
  [Symbol.hasInstance](value: unknown): value is HTMLTitleElement;
  new (): HTMLTitleElement;
}

export interface HTMLBaseElement extends HTMLElement {
  href: string;
  target: string;
}

export interface HTMLBaseElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLBaseElement;
  [Symbol.hasInstance](value: unknown): value is HTMLBaseElement;
  new (): HTMLBaseElement;
}

export interface HTMLMetaElement extends HTMLElement {

}

export interface HTMLMetaElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLMetaElement;
  [Symbol.hasInstance](value: unknown): value is HTMLMetaElement;
  new (): HTMLMetaElement;
}

export interface HTMLStyleElement extends HTMLElement {
  media: string;
  get blocking(): DOMTokenList;
  set blocking(value: string);
  readonly sheet: CSSStyleSheet | null;
}

export interface HTMLStyleElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLStyleElement;
  [Symbol.hasInstance](value: unknown): value is HTMLStyleElement;
  new (): HTMLStyleElement;
}

export interface HTMLLinkElement extends HTMLElement {
  crossOrigin: string | null;
  referrerPolicy: string;
  get blocking(): DOMTokenList;
  set blocking(value: string);
  fetchPriority: string;
  readonly sheet: CSSStyleSheet | null;
}

export interface HTMLLinkElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLLinkElement;
  [Symbol.hasInstance](value: unknown): value is HTMLLinkElement;
  new (): HTMLLinkElement;
}

export interface HTMLBodyElement extends HTMLElement {

}

export interface HTMLBodyElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLBodyElement;
  [Symbol.hasInstance](value: unknown): value is HTMLBodyElement;
  new (): HTMLBodyElement;
}

export interface HTMLHeadingElement extends HTMLElement {

}

export interface HTMLHeadingElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLHeadingElement;
  [Symbol.hasInstance](value: unknown): value is HTMLHeadingElement;
  new (): HTMLHeadingElement;
}

export interface HTMLParagraphElement extends HTMLElement {

}

export interface HTMLParagraphElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLParagraphElement;
  [Symbol.hasInstance](value: unknown): value is HTMLParagraphElement;
  new (): HTMLParagraphElement;
}

export interface HTMLHRElement extends HTMLElement {

}

export interface HTMLHRElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLHRElement;
  [Symbol.hasInstance](value: unknown): value is HTMLHRElement;
  new (): HTMLHRElement;
}

export interface HTMLPreElement extends HTMLElement {

}

export interface HTMLPreElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLPreElement;
  [Symbol.hasInstance](value: unknown): value is HTMLPreElement;
  new (): HTMLPreElement;
}

export interface HTMLOListElement extends HTMLElement {

}

export interface HTMLOListElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLOListElement;
  [Symbol.hasInstance](value: unknown): value is HTMLOListElement;
  new (): HTMLOListElement;
}

export interface HTMLUListElement extends HTMLElement {

}

export interface HTMLUListElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLUListElement;
  [Symbol.hasInstance](value: unknown): value is HTMLUListElement;
  new (): HTMLUListElement;
}

export interface HTMLMenuElement extends HTMLElement {

}

export interface HTMLMenuElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLMenuElement;
  [Symbol.hasInstance](value: unknown): value is HTMLMenuElement;
  new (): HTMLMenuElement;
}

export interface HTMLLIElement extends HTMLElement {

}

export interface HTMLLIElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLLIElement;
  [Symbol.hasInstance](value: unknown): value is HTMLLIElement;
  new (): HTMLLIElement;
}

export interface HTMLDListElement extends HTMLElement {

}

export interface HTMLDListElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLDListElement;
  [Symbol.hasInstance](value: unknown): value is HTMLDListElement;
  new (): HTMLDListElement;
}

export interface HTMLDivElement extends HTMLElement {

}

export interface HTMLDivElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLDivElement;
  [Symbol.hasInstance](value: unknown): value is HTMLDivElement;
  new (): HTMLDivElement;
}

export interface HTMLAnchorElement extends HTMLElement {

}

export interface HTMLAnchorElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLAnchorElement;
  [Symbol.hasInstance](value: unknown): value is HTMLAnchorElement;
  new (): HTMLAnchorElement;
}

export interface HTMLQuoteElement extends HTMLElement {

}

export interface HTMLQuoteElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLQuoteElement;
  [Symbol.hasInstance](value: unknown): value is HTMLQuoteElement;
  new (): HTMLQuoteElement;
}

export interface HTMLDataElement extends HTMLElement {

}

export interface HTMLDataElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLDataElement;
  [Symbol.hasInstance](value: unknown): value is HTMLDataElement;
  new (): HTMLDataElement;
}

export interface HTMLTimeElement extends HTMLElement {

}

export interface HTMLTimeElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLTimeElement;
  [Symbol.hasInstance](value: unknown): value is HTMLTimeElement;
  new (): HTMLTimeElement;
}

export interface HTMLSpanElement extends HTMLElement {

}

export interface HTMLSpanElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLSpanElement;
  [Symbol.hasInstance](value: unknown): value is HTMLSpanElement;
  new (): HTMLSpanElement;
}

export interface HTMLBRElement extends HTMLElement {

}

export interface HTMLBRElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLBRElement;
  [Symbol.hasInstance](value: unknown): value is HTMLBRElement;
  new (): HTMLBRElement;
}

export interface HTMLModElement extends HTMLElement {

}

export interface HTMLModElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLModElement;
  [Symbol.hasInstance](value: unknown): value is HTMLModElement;
  new (): HTMLModElement;
}

export interface HTMLPictureElement extends HTMLElement {

}

export interface HTMLPictureElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLPictureElement;
  [Symbol.hasInstance](value: unknown): value is HTMLPictureElement;
  new (): HTMLPictureElement;
}

export interface HTMLSourceElement extends HTMLElement {

}

export interface HTMLSourceElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLSourceElement;
  [Symbol.hasInstance](value: unknown): value is HTMLSourceElement;
  new (): HTMLSourceElement;
}

export interface HTMLImageElement extends HTMLElement {
  loading: string;
  fetchPriority: string;
}

export interface HTMLImageElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLImageElement;
  [Symbol.hasInstance](value: unknown): value is HTMLImageElement;
  new (): HTMLImageElement;
}

export interface HTMLIFrameElement extends HTMLElement {
  loading: string;
}

export interface HTMLIFrameElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLIFrameElement;
  [Symbol.hasInstance](value: unknown): value is HTMLIFrameElement;
  new (): HTMLIFrameElement;
}

export interface HTMLEmbedElement extends HTMLElement {

}

export interface HTMLEmbedElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLEmbedElement;
  [Symbol.hasInstance](value: unknown): value is HTMLEmbedElement;
  new (): HTMLEmbedElement;
}

export interface HTMLObjectElement extends HTMLElement {

}

export interface HTMLObjectElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLObjectElement;
  [Symbol.hasInstance](value: unknown): value is HTMLObjectElement;
  new (): HTMLObjectElement;
}

export interface HTMLMediaElement extends HTMLElement {
  loading: string;
}

export interface HTMLMediaElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLMediaElement;
  [Symbol.hasInstance](value: unknown): value is HTMLMediaElement;
}

export interface HTMLAudioElement extends HTMLMediaElement {

}

export interface HTMLAudioElementConstructor extends Ctor<HTMLMediaElementConstructor> {
  readonly prototype: HTMLAudioElement;
  [Symbol.hasInstance](value: unknown): value is HTMLAudioElement;
  new (): HTMLAudioElement;
}

export interface HTMLVideoElement extends HTMLMediaElement {

}

export interface HTMLVideoElementConstructor extends Ctor<HTMLMediaElementConstructor> {
  readonly prototype: HTMLVideoElement;
  [Symbol.hasInstance](value: unknown): value is HTMLVideoElement;
  new (): HTMLVideoElement;
}

export interface HTMLTrackElement extends HTMLElement {

}

export interface HTMLTrackElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLTrackElement;
  [Symbol.hasInstance](value: unknown): value is HTMLTrackElement;
  new (): HTMLTrackElement;
}

export interface HTMLMapElement extends HTMLElement {

}

export interface HTMLMapElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLMapElement;
  [Symbol.hasInstance](value: unknown): value is HTMLMapElement;
  new (): HTMLMapElement;
}

export interface HTMLAreaElement extends HTMLElement {

}

export interface HTMLAreaElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLAreaElement;
  [Symbol.hasInstance](value: unknown): value is HTMLAreaElement;
  new (): HTMLAreaElement;
}

export interface HTMLTableElement extends HTMLElement {

}

export interface HTMLTableElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLTableElement;
  [Symbol.hasInstance](value: unknown): value is HTMLTableElement;
  new (): HTMLTableElement;
}

export interface HTMLTableCaptionElement extends HTMLElement {

}

export interface HTMLTableCaptionElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLTableCaptionElement;
  [Symbol.hasInstance](value: unknown): value is HTMLTableCaptionElement;
  new (): HTMLTableCaptionElement;
}

export interface HTMLTableColElement extends HTMLElement {

}

export interface HTMLTableColElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLTableColElement;
  [Symbol.hasInstance](value: unknown): value is HTMLTableColElement;
  new (): HTMLTableColElement;
}

export interface HTMLTableSectionElement extends HTMLElement {

}

export interface HTMLTableSectionElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLTableSectionElement;
  [Symbol.hasInstance](value: unknown): value is HTMLTableSectionElement;
  new (): HTMLTableSectionElement;
}

export interface HTMLTableRowElement extends HTMLElement {

}

export interface HTMLTableRowElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLTableRowElement;
  [Symbol.hasInstance](value: unknown): value is HTMLTableRowElement;
  new (): HTMLTableRowElement;
}

export interface HTMLTableCellElement extends HTMLElement {

}

export interface HTMLTableCellElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLTableCellElement;
  [Symbol.hasInstance](value: unknown): value is HTMLTableCellElement;
  new (): HTMLTableCellElement;
}

export interface HTMLFormElement extends HTMLElement {
  readonly elements: HTMLFormControlsCollection;
}

export interface HTMLFormElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLFormElement;
  [Symbol.hasInstance](value: unknown): value is HTMLFormElement;
  new (): HTMLFormElement;
}

export interface HTMLLabelElement extends HTMLElement {

}

export interface HTMLLabelElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLLabelElement;
  [Symbol.hasInstance](value: unknown): value is HTMLLabelElement;
  new (): HTMLLabelElement;
}

export interface HTMLInputElement extends HTMLElement {
  type: string;
  defaultChecked: boolean;
  checked: boolean;
}

export interface HTMLInputElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLInputElement;
  [Symbol.hasInstance](value: unknown): value is HTMLInputElement;
  new (): HTMLInputElement;
}

export interface HTMLButtonElement extends HTMLElement {

}

export interface HTMLButtonElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLButtonElement;
  [Symbol.hasInstance](value: unknown): value is HTMLButtonElement;
  new (): HTMLButtonElement;
}

export interface HTMLSelectElement extends HTMLElement {
  readonly options: HTMLOptionsCollection;
  selectedIndex: number;
}

export interface HTMLSelectElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLSelectElement;
  [Symbol.hasInstance](value: unknown): value is HTMLSelectElement;
  new (): HTMLSelectElement;
}

export interface HTMLOptionElement extends HTMLElement {
  defaultSelected: boolean;
  selected: boolean;
}

export interface HTMLOptionElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLOptionElement;
  [Symbol.hasInstance](value: unknown): value is HTMLOptionElement;
  new (): HTMLOptionElement;
}

export interface HTMLOptGroupElement extends HTMLElement {

}

export interface HTMLOptGroupElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLOptGroupElement;
  [Symbol.hasInstance](value: unknown): value is HTMLOptGroupElement;
  new (): HTMLOptGroupElement;
}

export interface HTMLDataListElement extends HTMLElement {

}

export interface HTMLDataListElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLDataListElement;
  [Symbol.hasInstance](value: unknown): value is HTMLDataListElement;
  new (): HTMLDataListElement;
}

export interface HTMLTextAreaElement extends HTMLElement {

}

export interface HTMLTextAreaElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLTextAreaElement;
  [Symbol.hasInstance](value: unknown): value is HTMLTextAreaElement;
  new (): HTMLTextAreaElement;
}

export interface HTMLOutputElement extends HTMLElement {

}

export interface HTMLOutputElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLOutputElement;
  [Symbol.hasInstance](value: unknown): value is HTMLOutputElement;
  new (): HTMLOutputElement;
}

export interface HTMLProgressElement extends HTMLElement {

}

export interface HTMLProgressElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLProgressElement;
  [Symbol.hasInstance](value: unknown): value is HTMLProgressElement;
  new (): HTMLProgressElement;
}

export interface HTMLMeterElement extends HTMLElement {

}

export interface HTMLMeterElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLMeterElement;
  [Symbol.hasInstance](value: unknown): value is HTMLMeterElement;
  new (): HTMLMeterElement;
}

export interface HTMLFieldSetElement extends HTMLElement {

}

export interface HTMLFieldSetElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLFieldSetElement;
  [Symbol.hasInstance](value: unknown): value is HTMLFieldSetElement;
  new (): HTMLFieldSetElement;
}

export interface HTMLLegendElement extends HTMLElement {

}

export interface HTMLLegendElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLLegendElement;
  [Symbol.hasInstance](value: unknown): value is HTMLLegendElement;
  new (): HTMLLegendElement;
}

export interface HTMLSelectedContentElement extends HTMLElement {

}

export interface HTMLSelectedContentElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLSelectedContentElement;
  [Symbol.hasInstance](value: unknown): value is HTMLSelectedContentElement;
  new (): HTMLSelectedContentElement;
}

export interface HTMLFormControlsCollection extends Omit<HTMLCollection, "namedItem"> {
  namedItem(name: string): RadioNodeList | Element | null;
  readonly [index: number]: Element | null | undefined;
  [Symbol.iterator](): IterableIterator<Element | null>;
}

export interface HTMLFormControlsCollectionConstructor extends Ctor<HTMLCollectionConstructor> {
  readonly prototype: HTMLFormControlsCollection;
  [Symbol.hasInstance](value: unknown): value is HTMLFormControlsCollection;
}

export interface RadioNodeList extends NodeList {
  value: string;
  readonly [index: number]: Node | null | undefined;
}

export interface RadioNodeListConstructor extends Ctor<NodeListConstructor> {
  readonly prototype: RadioNodeList;
  [Symbol.hasInstance](value: unknown): value is RadioNodeList;
}

export interface HTMLOptionsCollection extends Omit<HTMLCollection, "length"> {
  length: number;
  add(element: HTMLOptionElement | HTMLOptGroupElement, before?: HTMLElement | number | null): void;
  remove(index: number): void;
  selectedIndex: number;
  [index: number]: Element | null | undefined;
  [Symbol.iterator](): IterableIterator<Element | null>;
}

export interface HTMLOptionsCollectionConstructor extends Ctor<HTMLCollectionConstructor> {
  readonly prototype: HTMLOptionsCollection;
  [Symbol.hasInstance](value: unknown): value is HTMLOptionsCollection;
}

export interface HTMLDetailsElement extends HTMLElement {

}

export interface HTMLDetailsElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLDetailsElement;
  [Symbol.hasInstance](value: unknown): value is HTMLDetailsElement;
  new (): HTMLDetailsElement;
}

export interface HTMLDialogElement extends HTMLElement {

}

export interface HTMLDialogElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLDialogElement;
  [Symbol.hasInstance](value: unknown): value is HTMLDialogElement;
  new (): HTMLDialogElement;
}

export interface HTMLFrameSetElement extends HTMLElement {

}

export interface HTMLFrameSetElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLFrameSetElement;
  [Symbol.hasInstance](value: unknown): value is HTMLFrameSetElement;
  new (): HTMLFrameSetElement;
}

export interface HTMLFrameElement extends HTMLElement {

}

export interface HTMLFrameElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLFrameElement;
  [Symbol.hasInstance](value: unknown): value is HTMLFrameElement;
  new (): HTMLFrameElement;
}

export interface HTMLDirectoryElement extends HTMLElement {

}

export interface HTMLDirectoryElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLDirectoryElement;
  [Symbol.hasInstance](value: unknown): value is HTMLDirectoryElement;
  new (): HTMLDirectoryElement;
}

export interface HTMLFontElement extends HTMLElement {

}

export interface HTMLFontElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLFontElement;
  [Symbol.hasInstance](value: unknown): value is HTMLFontElement;
  new (): HTMLFontElement;
}

export interface HTMLMarqueeElement extends HTMLElement {

}

export interface HTMLMarqueeElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLMarqueeElement;
  [Symbol.hasInstance](value: unknown): value is HTMLMarqueeElement;
  new (): HTMLMarqueeElement;
}

export interface HTMLParamElement extends HTMLElement {

}

export interface HTMLParamElementConstructor extends Ctor<HTMLElementConstructor> {
  readonly prototype: HTMLParamElement;
  [Symbol.hasInstance](value: unknown): value is HTMLParamElement;
  new (): HTMLParamElement;
}

export interface SVGElement extends Element {
  get style(): CSSStyleProperties;
  set style(value: string);
  nonce: string;
  autofocus: boolean;
}

export interface SVGElementConstructor extends Ctor<ElementConstructor> {
  readonly prototype: SVGElement;
  [Symbol.hasInstance](value: unknown): value is SVGElement;
}

export interface SVGGraphicsElement extends SVGElement {

}

export interface SVGGraphicsElementConstructor extends Ctor<SVGElementConstructor> {
  readonly prototype: SVGGraphicsElement;
  [Symbol.hasInstance](value: unknown): value is SVGGraphicsElement;
}

export interface SVGSVGElement extends SVGGraphicsElement {

}

export interface SVGSVGElementConstructor extends Ctor<SVGGraphicsElementConstructor> {
  readonly prototype: SVGSVGElement;
  [Symbol.hasInstance](value: unknown): value is SVGSVGElement;
}

export interface SVGStyleElement extends SVGElement {
  readonly sheet: CSSStyleSheet | null;
}

export interface SVGStyleElementConstructor extends Ctor<SVGElementConstructor> {
  readonly prototype: SVGStyleElement;
  [Symbol.hasInstance](value: unknown): value is SVGStyleElement;
}

export interface SVGScriptElement extends SVGElement {

}

export interface SVGScriptElementConstructor extends Ctor<SVGElementConstructor> {
  readonly prototype: SVGScriptElement;
  [Symbol.hasInstance](value: unknown): value is SVGScriptElement;
}

export interface SVGTitleElement extends SVGElement {

}

export interface SVGTitleElementConstructor extends Ctor<SVGElementConstructor> {
  readonly prototype: SVGTitleElement;
  [Symbol.hasInstance](value: unknown): value is SVGTitleElement;
}

export interface MathMLElement extends Element {
  get style(): CSSStyleProperties;
  set style(value: string);
  nonce: string;
  autofocus: boolean;
}

export interface MathMLElementConstructor extends Ctor<ElementConstructor> {
  readonly prototype: MathMLElement;
  [Symbol.hasInstance](value: unknown): value is MathMLElement;
}

export interface Origin {
  readonly opaque: boolean;
  isSameOrigin(other: Origin): boolean;
  isSameSite(other: Origin): boolean;
}

export interface OriginConstructor {
  readonly prototype: Origin;
  [Symbol.hasInstance](value: unknown): value is Origin;
  new (): Origin;
  from(value: any): Origin;
}

export interface Location {
  href: string;
  toString(): string;
  readonly origin: string;
  protocol: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  assign(url: string): void;
  replace(url: string): void;
  reload(): void;
}

export interface LocationConstructor {
  readonly prototype: Location;
  [Symbol.hasInstance](value: unknown): value is Location;
}

export interface Report {
  readonly type: string;
  readonly url: string;
  readonly body: ReportBody | null;
  toJSON(): object;
}

export interface ReportBody {
  toJSON(): object;
}

export interface ReportBodyConstructor {
  readonly prototype: ReportBody;
  [Symbol.hasInstance](value: unknown): value is ReportBody;
}

export interface IntegrityViolationReportBody extends ReportBody {
  readonly documentURL: string;
  readonly blockedURL: string;
  readonly destination: string;
  readonly reportOnly: boolean;
  toJSON(): object;
}

export interface IntegrityViolationReportBodyConstructor extends Ctor<ReportBodyConstructor> {
  readonly prototype: IntegrityViolationReportBody;
  [Symbol.hasInstance](value: unknown): value is IntegrityViolationReportBody;
}

export interface TestReportBody extends ReportBody {
  readonly message: string;
  toJSON(): object;
}

export interface COEPViolationReportBody extends ReportBody {
  readonly type: string;
  readonly blockedURL: string;
  readonly destination: string;
  readonly disposition: string;
  toJSON(): object;
}

export interface CSPViolationReportBody extends ReportBody {
  readonly documentURL: string;
  readonly referrer: string | null;
  readonly blockedURL: string | null;
  readonly effectiveDirective: string;
  readonly originalPolicy: string;
  readonly sourceFile: string | null;
  readonly sample: string | null;
  readonly disposition: SecurityPolicyViolationEventDisposition;
  readonly statusCode: number;
  readonly lineNumber: number | null;
  readonly columnNumber: number | null;
  toJSON(): object;
}

export interface CSPViolationReportBodyConstructor extends Ctor<ReportBodyConstructor> {
  readonly prototype: CSPViolationReportBody;
  [Symbol.hasInstance](value: unknown): value is CSPViolationReportBody;
}

export interface SecurityPolicyViolationEvent extends Event {
  readonly documentURI: string;
  readonly referrer: string;
  readonly blockedURI: string;
  readonly effectiveDirective: string;
  readonly violatedDirective: string;
  readonly originalPolicy: string;
  readonly sourceFile: string;
  readonly sample: string;
  readonly disposition: SecurityPolicyViolationEventDisposition;
  readonly statusCode: number;
  readonly lineNumber: number;
  readonly columnNumber: number;
}

export interface SecurityPolicyViolationEventConstructor extends Ctor<EventConstructor> {
  readonly prototype: SecurityPolicyViolationEvent;
  [Symbol.hasInstance](value: unknown): value is SecurityPolicyViolationEvent;
  new (type: string, eventInitDict?: SecurityPolicyViolationEventInit): SecurityPolicyViolationEvent;
}

export interface ReportingObserver {
  observe(): void;
  disconnect(): void;
  takeRecords(): Array<Report>;
}

export interface ReportingObserverConstructor {
  readonly prototype: ReportingObserver;
  [Symbol.hasInstance](value: unknown): value is ReportingObserver;
  new (callback: ReportingObserverCallback, options?: ReportingObserverOptions): ReportingObserver;
}

export interface Performance extends EventTarget {
  now(): number;
  readonly timeOrigin: number;
  toJSON(): object;
}

export interface PerformanceConstructor extends Ctor<EventTargetConstructor> {
  readonly prototype: Performance;
  [Symbol.hasInstance](value: unknown): value is Performance;
}

export interface Window extends EventTarget {
  readonly window: WindowProxy;
  get self(): WindowProxy;
  set self(value: unknown);
  readonly document: Document;
  get location(): Location;
  set location(value: string);
  get event(): Event | undefined;
  set event(value: unknown);
  getComputedStyle(elt: Element, pseudoElt?: string | null): CSSStyleProperties;
  readonly isSecureContext: boolean;
  setTimeout(handler: string | Function, timeout?: number, ...arguments_: Array<any>): number;
  clearTimeout(id?: number): void;
  setInterval(handler: string | Function, timeout?: number, ...arguments_: Array<any>): number;
  clearInterval(id?: number): void;
  queueMicrotask(callback: VoidFunction): void;
  structuredClone<T = any>(value: T, options?: StructuredSerializeOptions): T;
  get performance(): Performance;
  set performance(value: unknown);
  readonly trustedTypes: TrustedTypePolicyFactory;
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
  DOMException: DOMExceptionConstructor;
  QuotaExceededError: QuotaExceededErrorConstructor;
  HTMLAllCollection: HTMLAllCollectionConstructor;
  CustomElementRegistry: CustomElementRegistryConstructor;
  ElementInternals: ElementInternalsConstructor;
  HTMLElement: HTMLElementConstructor;
  HTMLUnknownElement: HTMLUnknownElementConstructor;
  HTMLHtmlElement: HTMLHtmlElementConstructor;
  HTMLScriptElement: HTMLScriptElementConstructor;
  HTMLSlotElement: HTMLSlotElementConstructor;
  HTMLTemplateElement: HTMLTemplateElementConstructor;
  HTMLCanvasElement: HTMLCanvasElementConstructor;
  HTMLHeadElement: HTMLHeadElementConstructor;
  HTMLTitleElement: HTMLTitleElementConstructor;
  HTMLBaseElement: HTMLBaseElementConstructor;
  HTMLMetaElement: HTMLMetaElementConstructor;
  HTMLStyleElement: HTMLStyleElementConstructor;
  HTMLLinkElement: HTMLLinkElementConstructor;
  HTMLBodyElement: HTMLBodyElementConstructor;
  HTMLHeadingElement: HTMLHeadingElementConstructor;
  HTMLParagraphElement: HTMLParagraphElementConstructor;
  HTMLHRElement: HTMLHRElementConstructor;
  HTMLPreElement: HTMLPreElementConstructor;
  HTMLOListElement: HTMLOListElementConstructor;
  HTMLUListElement: HTMLUListElementConstructor;
  HTMLMenuElement: HTMLMenuElementConstructor;
  HTMLLIElement: HTMLLIElementConstructor;
  HTMLDListElement: HTMLDListElementConstructor;
  HTMLDivElement: HTMLDivElementConstructor;
  HTMLAnchorElement: HTMLAnchorElementConstructor;
  HTMLQuoteElement: HTMLQuoteElementConstructor;
  HTMLDataElement: HTMLDataElementConstructor;
  HTMLTimeElement: HTMLTimeElementConstructor;
  HTMLSpanElement: HTMLSpanElementConstructor;
  HTMLBRElement: HTMLBRElementConstructor;
  HTMLModElement: HTMLModElementConstructor;
  HTMLPictureElement: HTMLPictureElementConstructor;
  HTMLSourceElement: HTMLSourceElementConstructor;
  HTMLImageElement: HTMLImageElementConstructor;
  HTMLIFrameElement: HTMLIFrameElementConstructor;
  HTMLEmbedElement: HTMLEmbedElementConstructor;
  HTMLObjectElement: HTMLObjectElementConstructor;
  HTMLMediaElement: HTMLMediaElementConstructor;
  HTMLAudioElement: HTMLAudioElementConstructor;
  HTMLVideoElement: HTMLVideoElementConstructor;
  HTMLTrackElement: HTMLTrackElementConstructor;
  HTMLMapElement: HTMLMapElementConstructor;
  HTMLAreaElement: HTMLAreaElementConstructor;
  HTMLTableElement: HTMLTableElementConstructor;
  HTMLTableCaptionElement: HTMLTableCaptionElementConstructor;
  HTMLTableColElement: HTMLTableColElementConstructor;
  HTMLTableSectionElement: HTMLTableSectionElementConstructor;
  HTMLTableRowElement: HTMLTableRowElementConstructor;
  HTMLTableCellElement: HTMLTableCellElementConstructor;
  HTMLFormElement: HTMLFormElementConstructor;
  HTMLLabelElement: HTMLLabelElementConstructor;
  HTMLInputElement: HTMLInputElementConstructor;
  HTMLButtonElement: HTMLButtonElementConstructor;
  HTMLSelectElement: HTMLSelectElementConstructor;
  HTMLOptionElement: HTMLOptionElementConstructor;
  HTMLOptGroupElement: HTMLOptGroupElementConstructor;
  HTMLDataListElement: HTMLDataListElementConstructor;
  HTMLTextAreaElement: HTMLTextAreaElementConstructor;
  HTMLOutputElement: HTMLOutputElementConstructor;
  HTMLProgressElement: HTMLProgressElementConstructor;
  HTMLMeterElement: HTMLMeterElementConstructor;
  HTMLFieldSetElement: HTMLFieldSetElementConstructor;
  HTMLLegendElement: HTMLLegendElementConstructor;
  HTMLSelectedContentElement: HTMLSelectedContentElementConstructor;
  HTMLFormControlsCollection: HTMLFormControlsCollectionConstructor;
  RadioNodeList: RadioNodeListConstructor;
  HTMLOptionsCollection: HTMLOptionsCollectionConstructor;
  HTMLDetailsElement: HTMLDetailsElementConstructor;
  HTMLDialogElement: HTMLDialogElementConstructor;
  HTMLFrameSetElement: HTMLFrameSetElementConstructor;
  HTMLFrameElement: HTMLFrameElementConstructor;
  HTMLDirectoryElement: HTMLDirectoryElementConstructor;
  HTMLFontElement: HTMLFontElementConstructor;
  HTMLMarqueeElement: HTMLMarqueeElementConstructor;
  HTMLParamElement: HTMLParamElementConstructor;
  SVGElement: SVGElementConstructor;
  SVGGraphicsElement: SVGGraphicsElementConstructor;
  SVGSVGElement: SVGSVGElementConstructor;
  SVGStyleElement: SVGStyleElementConstructor;
  SVGScriptElement: SVGScriptElementConstructor;
  SVGTitleElement: SVGTitleElementConstructor;
  MathMLElement: MathMLElementConstructor;
  Origin: OriginConstructor;
  Location: LocationConstructor;
  ReportBody: ReportBodyConstructor;
  IntegrityViolationReportBody: IntegrityViolationReportBodyConstructor;
  CSPViolationReportBody: CSPViolationReportBodyConstructor;
  SecurityPolicyViolationEvent: SecurityPolicyViolationEventConstructor;
  ReportingObserver: ReportingObserverConstructor;
  Performance: PerformanceConstructor;
  Window: WindowConstructor;
  Event: EventConstructor;
  CustomEvent: CustomEventConstructor;
  EventTarget: EventTargetConstructor;
  AbortSignal: AbortSignalConstructor;
  AbortController: AbortControllerConstructor;
  AbstractRange: AbstractRangeConstructor;
  StaticRange: StaticRangeConstructor;
  Range: RangeConstructor;
  NodeIterator: NodeIteratorConstructor;
  TreeWalker: TreeWalkerConstructor;
  DOMStringList: DOMStringListConstructor;
  DOMTokenList: DOMTokenListConstructor;
  Node: NodeConstructor;
  HTMLCollection: HTMLCollectionConstructor;
  NodeList: NodeListConstructor;
  MutationObserver: MutationObserverConstructor;
  MutationRecord: MutationRecordConstructor;
  NamedNodeMap: NamedNodeMapConstructor;
  Attr: AttrConstructor;
  CharacterData: CharacterDataConstructor;
  DocumentType: DocumentTypeConstructor;
  Text: TextConstructor;
  CDATASection: CDATASectionConstructor;
  ProcessingInstruction: ProcessingInstructionConstructor;
  Comment: CommentConstructor;
  DocumentFragment: DocumentFragmentConstructor;
  ShadowRoot: ShadowRootConstructor;
  Document: DocumentConstructor;
  XMLDocument: XMLDocumentConstructor;
  DOMImplementation: DOMImplementationConstructor;
  Element: ElementConstructor;
  MediaList: MediaListConstructor;
  StyleSheet: StyleSheetConstructor;
  StyleSheetList: StyleSheetListConstructor;
  CSSRule: CSSRuleConstructor;
  CSSRuleList: CSSRuleListConstructor;
  CSSGroupingRule: CSSGroupingRuleConstructor;
  CSSStyleRule: CSSStyleRuleConstructor;
  CSSNestedDeclarations: CSSNestedDeclarationsConstructor;
  CSSPropertyRule: CSSPropertyRuleConstructor;
  CSSStyleDeclaration: CSSStyleDeclarationConstructor;
  CSSStyleSheet: CSSStyleSheetConstructor;
  CSSStyleProperties: CSSStylePropertiesConstructor;
  ByteLengthQueuingStrategy: ByteLengthQueuingStrategyConstructor;
  CountQueuingStrategy: CountQueuingStrategyConstructor;
  ReadableStream: ReadableStreamConstructor;
  ReadableStreamDefaultReader: ReadableStreamDefaultReaderConstructor;
  ReadableStreamBYOBReader: ReadableStreamBYOBReaderConstructor;
  ReadableStreamDefaultController: ReadableStreamDefaultControllerConstructor;
  ReadableByteStreamController: ReadableByteStreamControllerConstructor;
  ReadableStreamBYOBRequest: ReadableStreamBYOBRequestConstructor;
  WritableStream: WritableStreamConstructor;
  WritableStreamDefaultController: WritableStreamDefaultControllerConstructor;
  WritableStreamDefaultWriter: WritableStreamDefaultWriterConstructor;
  TransformStream: TransformStreamConstructor;
  TransformStreamDefaultController: TransformStreamDefaultControllerConstructor;
  TextDecoder: TextDecoderConstructor;
  TextEncoder: TextEncoderConstructor;
  TextDecoderStream: TextDecoderStreamConstructor;
  TextEncoderStream: TextEncoderStreamConstructor;
  Blob: BlobConstructor;
  File: FileConstructor;
  FileList: FileListConstructor;
  FileReader: FileReaderConstructor;
  FormData: FormDataConstructor;
  ProgressEvent: ProgressEventConstructor;
  URL: URLConstructor;
  webkitURL: URLConstructor;
  URLSearchParams: URLSearchParamsConstructor;
  Headers: HeadersConstructor;
  Request: RequestConstructor;
  Response: ResponseConstructor;
  TrustedHTML: TrustedHTMLConstructor;
  TrustedScript: TrustedScriptConstructor;
  TrustedScriptURL: TrustedScriptURLConstructor;
  TrustedTypePolicy: TrustedTypePolicyConstructor;
  TrustedTypePolicyFactory: TrustedTypePolicyFactoryConstructor;
  NodeFilter: NodeFilterInterfaceObject;
}

export interface WindowConstructor extends Ctor<EventTargetConstructor> {
  readonly prototype: Window;
  [Symbol.hasInstance](value: unknown): value is Window;
}

export interface Event {
  readonly type: string;
  readonly target: EventTarget | null;
  readonly srcElement: EventTarget | null;
  readonly currentTarget: EventTarget | null;
  composedPath(): Array<EventTarget>;
  readonly NONE: 0;
  readonly CAPTURING_PHASE: 1;
  readonly AT_TARGET: 2;
  readonly BUBBLING_PHASE: 3;
  readonly eventPhase: number;
  stopPropagation(): void;
  cancelBubble: boolean;
  stopImmediatePropagation(): void;
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  returnValue: boolean;
  preventDefault(): void;
  readonly defaultPrevented: boolean;
  readonly composed: boolean;
  readonly isTrusted: boolean;
  readonly timeStamp: number;
  initEvent(type: string, bubbles?: boolean, cancelable?: boolean): void;
}

export interface EventConstructor {
  readonly prototype: Event;
  [Symbol.hasInstance](value: unknown): value is Event;
  new (type: string, eventInitDict?: EventInit): Event;
  readonly NONE: 0;
  readonly CAPTURING_PHASE: 1;
  readonly AT_TARGET: 2;
  readonly BUBBLING_PHASE: 3;
}

export interface CustomEvent<T = any> extends Event {
  readonly detail: T;
  initCustomEvent(type: string, bubbles?: boolean, cancelable?: boolean, detail?: T): void;
}

export interface CustomEventConstructor extends Ctor<EventConstructor> {
  readonly prototype: CustomEvent<any>;
  [Symbol.hasInstance](value: unknown): value is CustomEvent<any>;
  new <T = any>(type: string, eventInitDict?: CustomEventInit<T>): CustomEvent<T>;
}

export interface EventTarget {
  addEventListener(type: string, callback: EventListener | null, options?: AddEventListenerOptions | boolean): void;
  removeEventListener(type: string, callback: EventListener | null, options?: EventListenerOptions | boolean): void;
  dispatchEvent(event: Event): boolean;
}

export interface EventTargetConstructor {
  readonly prototype: EventTarget;
  [Symbol.hasInstance](value: unknown): value is EventTarget;
  new (): EventTarget;
}

export interface AbortSignal extends EventTarget {
  readonly aborted: boolean;
  readonly reason: any;
  throwIfAborted(): void;
  onabort: EventHandlerNonNull | null;
}

export interface AbortSignalConstructor extends Ctor<EventTargetConstructor> {
  readonly prototype: AbortSignal;
  [Symbol.hasInstance](value: unknown): value is AbortSignal;
  abort(reason?: any): AbortSignal;
  timeout(milliseconds: number): AbortSignal;
  any(signals: Iterable<AbortSignal>): AbortSignal;
}

export interface AbortController {
  readonly signal: AbortSignal;
  abort(reason?: any): void;
}

export interface AbortControllerConstructor {
  readonly prototype: AbortController;
  [Symbol.hasInstance](value: unknown): value is AbortController;
  new (): AbortController;
}

export interface AbstractRange {
  readonly startContainer: Node;
  readonly startOffset: number;
  readonly endContainer: Node;
  readonly endOffset: number;
  readonly collapsed: boolean;
}

export interface AbstractRangeConstructor {
  readonly prototype: AbstractRange;
  [Symbol.hasInstance](value: unknown): value is AbstractRange;
}

export interface StaticRange extends AbstractRange {

}

export interface StaticRangeConstructor extends Ctor<AbstractRangeConstructor> {
  readonly prototype: StaticRange;
  [Symbol.hasInstance](value: unknown): value is StaticRange;
  new (init: StaticRangeInit): StaticRange;
}

export interface Range extends AbstractRange {
  readonly commonAncestorContainer: Node;
  setStart(node: Node, offset: number): void;
  setEnd(node: Node, offset: number): void;
  setStartBefore(node: Node): void;
  setStartAfter(node: Node): void;
  setEndBefore(node: Node): void;
  setEndAfter(node: Node): void;
  collapse(toStart?: boolean): void;
  selectNode(node: Node): void;
  selectNodeContents(node: Node): void;
  readonly START_TO_START: 0;
  readonly START_TO_END: 1;
  readonly END_TO_END: 2;
  readonly END_TO_START: 3;
  compareBoundaryPoints(how: number, sourceRange: Range): number;
  deleteContents(): void;
  extractContents(): DocumentFragment;
  cloneContents(): DocumentFragment;
  insertNode(node: Node): void;
  surroundContents(newParent: Node): void;
  cloneRange(): Range;
  detach(): void;
  isPointInRange(node: Node, offset: number): boolean;
  comparePoint(node: Node, offset: number): number;
  intersectsNode(node: Node): boolean;
  toString(): string;
}

export interface RangeConstructor extends Ctor<AbstractRangeConstructor> {
  readonly prototype: Range;
  [Symbol.hasInstance](value: unknown): value is Range;
  new (): Range;
  readonly START_TO_START: 0;
  readonly START_TO_END: 1;
  readonly END_TO_END: 2;
  readonly END_TO_START: 3;
}

export interface NodeIterator {
  readonly root: Node;
  readonly referenceNode: Node;
  readonly pointerBeforeReferenceNode: boolean;
  readonly whatToShow: number;
  readonly filter: NodeFilter | null;
  nextNode(): Node | null;
  previousNode(): Node | null;
  detach(): void;
}

export interface NodeIteratorConstructor {
  readonly prototype: NodeIterator;
  [Symbol.hasInstance](value: unknown): value is NodeIterator;
}

export interface TreeWalker {
  readonly root: Node;
  readonly whatToShow: number;
  readonly filter: NodeFilter | null;
  currentNode: Node;
  parentNode(): Node | null;
  firstChild(): Node | null;
  lastChild(): Node | null;
  previousSibling(): Node | null;
  nextSibling(): Node | null;
  previousNode(): Node | null;
  nextNode(): Node | null;
}

export interface TreeWalkerConstructor {
  readonly prototype: TreeWalker;
  [Symbol.hasInstance](value: unknown): value is TreeWalker;
}

export interface DOMStringList {
  readonly length: number;
  item(index: number): string | null;
  contains(string_: string): boolean;
  readonly [index: number]: string | null | undefined;
  [Symbol.iterator](): IterableIterator<string | null>;
}

export interface DOMStringListConstructor {
  readonly prototype: DOMStringList;
  [Symbol.hasInstance](value: unknown): value is DOMStringList;
}

export interface DOMTokenList {
  readonly length: number;
  item(index: number): string | null;
  contains(token: string): boolean;
  add(...tokens: Array<string>): void;
  remove(...tokens: Array<string>): void;
  toggle(token: string, force?: boolean): boolean;
  replace(token: string, newToken: string): boolean;
  supports(token: string): boolean;
  value: string;
  toString(): string;
  readonly [index: number]: string | null | undefined;
  [Symbol.iterator](): IterableIterator<string>;
  values(): IterableIterator<string>;
  keys(): IterableIterator<number>;
  entries(): IterableIterator<[number, string]>;
  forEach(callback: (value: string, key: number, parent: this) => void, thisArg?: unknown): void;
}

export interface DOMTokenListConstructor {
  readonly prototype: DOMTokenList;
  [Symbol.hasInstance](value: unknown): value is DOMTokenList;
}

export interface Node extends EventTarget {
  readonly ELEMENT_NODE: 1;
  readonly ATTRIBUTE_NODE: 2;
  readonly TEXT_NODE: 3;
  readonly CDATA_SECTION_NODE: 4;
  readonly ENTITY_REFERENCE_NODE: 5;
  readonly ENTITY_NODE: 6;
  readonly PROCESSING_INSTRUCTION_NODE: 7;
  readonly COMMENT_NODE: 8;
  readonly DOCUMENT_NODE: 9;
  readonly DOCUMENT_TYPE_NODE: 10;
  readonly DOCUMENT_FRAGMENT_NODE: 11;
  readonly NOTATION_NODE: 12;
  readonly nodeType: number;
  readonly nodeName: string;
  readonly baseURI: string;
  readonly isConnected: boolean;
  readonly ownerDocument: Document | null;
  getRootNode(options?: GetRootNodeOptions): Node;
  readonly parentNode: Node | null;
  readonly parentElement: Element | null;
  hasChildNodes(): boolean;
  readonly childNodes: NodeList;
  readonly firstChild: Node | null;
  readonly lastChild: Node | null;
  readonly previousSibling: Node | null;
  readonly nextSibling: Node | null;
  nodeValue: string | null;
  textContent: string | null;
  normalize(): void;
  cloneNode(subtree?: boolean): Node;
  isEqualNode(otherNode: Node | null): boolean;
  isSameNode(otherNode: Node | null): boolean;
  readonly DOCUMENT_POSITION_DISCONNECTED: 1;
  readonly DOCUMENT_POSITION_PRECEDING: 2;
  readonly DOCUMENT_POSITION_FOLLOWING: 4;
  readonly DOCUMENT_POSITION_CONTAINS: 8;
  readonly DOCUMENT_POSITION_CONTAINED_BY: 16;
  readonly DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC: 32;
  compareDocumentPosition(other: Node): number;
  contains(other: Node | null): boolean;
  lookupPrefix(namespace: string | null): string | null;
  lookupNamespaceURI(prefix: string | null): string | null;
  isDefaultNamespace(namespace: string | null): boolean;
  insertBefore(node: Node, child: Node | null): Node;
  appendChild(node: Node): Node;
  replaceChild(node: Node, child: Node): Node;
  removeChild(child: Node): Node;
}

export interface NodeConstructor extends Ctor<EventTargetConstructor> {
  readonly prototype: Node;
  [Symbol.hasInstance](value: unknown): value is Node;
  readonly ELEMENT_NODE: 1;
  readonly ATTRIBUTE_NODE: 2;
  readonly TEXT_NODE: 3;
  readonly CDATA_SECTION_NODE: 4;
  readonly ENTITY_REFERENCE_NODE: 5;
  readonly ENTITY_NODE: 6;
  readonly PROCESSING_INSTRUCTION_NODE: 7;
  readonly COMMENT_NODE: 8;
  readonly DOCUMENT_NODE: 9;
  readonly DOCUMENT_TYPE_NODE: 10;
  readonly DOCUMENT_FRAGMENT_NODE: 11;
  readonly NOTATION_NODE: 12;
  readonly DOCUMENT_POSITION_DISCONNECTED: 1;
  readonly DOCUMENT_POSITION_PRECEDING: 2;
  readonly DOCUMENT_POSITION_FOLLOWING: 4;
  readonly DOCUMENT_POSITION_CONTAINS: 8;
  readonly DOCUMENT_POSITION_CONTAINED_BY: 16;
  readonly DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC: 32;
}

export interface HTMLCollection {
  readonly length: number;
  item(index: number): Element | null;
  namedItem(name: string): Element | null;
  readonly [index: number]: Element | null | undefined;
  [Symbol.iterator](): IterableIterator<Element | null>;
}

export interface HTMLCollectionConstructor {
  readonly prototype: HTMLCollection;
  [Symbol.hasInstance](value: unknown): value is HTMLCollection;
}

export interface NodeList {
  item(index: number): Node | null;
  readonly length: number;
  readonly [index: number]: Node | null | undefined;
  [Symbol.iterator](): IterableIterator<Node>;
  values(): IterableIterator<Node>;
  keys(): IterableIterator<number>;
  entries(): IterableIterator<[number, Node]>;
  forEach(callback: (value: Node, key: number, parent: this) => void, thisArg?: unknown): void;
}

export interface NodeListConstructor {
  readonly prototype: NodeList;
  [Symbol.hasInstance](value: unknown): value is NodeList;
}

export interface MutationObserver {
  observe(target: Node, options?: MutationObserverInit): void;
  disconnect(): void;
  takeRecords(): Array<MutationRecord>;
}

export interface MutationObserverConstructor {
  readonly prototype: MutationObserver;
  [Symbol.hasInstance](value: unknown): value is MutationObserver;
  new (callback: MutationCallback): MutationObserver;
}

export interface MutationRecord {
  readonly type: string;
  readonly target: Node;
  readonly addedNodes: NodeList;
  readonly removedNodes: NodeList;
  readonly previousSibling: Node | null;
  readonly nextSibling: Node | null;
  readonly attributeName: string | null;
  readonly attributeNamespace: string | null;
  readonly oldValue: string | null;
}

export interface MutationRecordConstructor {
  readonly prototype: MutationRecord;
  [Symbol.hasInstance](value: unknown): value is MutationRecord;
}

export interface NamedNodeMap {
  readonly length: number;
  item(index: number): Attr | null;
  getNamedItem(qualifiedName: string): Attr | null;
  getNamedItemNS(namespace: string | null, localName: string): Attr | null;
  setNamedItem(attr: Attr): Attr | null;
  setNamedItemNS(attr: Attr): Attr | null;
  removeNamedItem(qualifiedName: string): Attr;
  removeNamedItemNS(namespace: string | null, localName: string): Attr;
  readonly [index: number]: Attr | null | undefined;
  [Symbol.iterator](): IterableIterator<Attr | null>;
}

export interface NamedNodeMapConstructor {
  readonly prototype: NamedNodeMap;
  [Symbol.hasInstance](value: unknown): value is NamedNodeMap;
}

export interface Attr extends Node {
  readonly namespaceURI: string | null;
  readonly prefix: string | null;
  readonly localName: string;
  readonly name: string;
  value: string;
  readonly ownerElement: Element | null;
  readonly specified: boolean;
}

export interface AttrConstructor extends Ctor<NodeConstructor> {
  readonly prototype: Attr;
  [Symbol.hasInstance](value: unknown): value is Attr;
}

export interface CharacterData extends Node {
  data: string;
  readonly length: number;
  substringData(offset: number, count: number): string;
  appendData(data: string): void;
  insertData(offset: number, data: string): void;
  deleteData(offset: number, count: number): void;
  replaceData(offset: number, count: number, data: string): void;
  before(...nodes: Array<Node | string>): void;
  after(...nodes: Array<Node | string>): void;
  replaceWith(...nodes: Array<Node | string>): void;
  remove(): void;
  readonly previousElementSibling: Element | null;
  readonly nextElementSibling: Element | null;
}

export interface CharacterDataConstructor extends Ctor<NodeConstructor> {
  readonly prototype: CharacterData;
  [Symbol.hasInstance](value: unknown): value is CharacterData;
}

export interface DocumentType extends Node {
  readonly name: string;
  readonly publicId: string;
  readonly systemId: string;
  before(...nodes: Array<Node | string>): void;
  after(...nodes: Array<Node | string>): void;
  replaceWith(...nodes: Array<Node | string>): void;
  remove(): void;
}

export interface DocumentTypeConstructor extends Ctor<NodeConstructor> {
  readonly prototype: DocumentType;
  [Symbol.hasInstance](value: unknown): value is DocumentType;
}

export interface Text extends CharacterData {
  splitText(offset: number): Text;
  readonly wholeText: string;
  readonly assignedSlot: HTMLSlotElement | null;
}

export interface TextConstructor extends Ctor<CharacterDataConstructor> {
  readonly prototype: Text;
  [Symbol.hasInstance](value: unknown): value is Text;
  new (data?: string): Text;
}

export interface CDATASection extends Text {

}

export interface CDATASectionConstructor extends Ctor<TextConstructor> {
  readonly prototype: CDATASection;
  [Symbol.hasInstance](value: unknown): value is CDATASection;
}

export interface ProcessingInstruction extends CharacterData {
  readonly target: string;
  hasAttributes(): boolean;
  getAttributeNames(): Array<string>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  toggleAttribute(name: string, force?: boolean): boolean;
  hasAttribute(name: string): boolean;
  readonly sheet: CSSStyleSheet | null;
}

export interface ProcessingInstructionConstructor extends Ctor<CharacterDataConstructor> {
  readonly prototype: ProcessingInstruction;
  [Symbol.hasInstance](value: unknown): value is ProcessingInstruction;
  new (target: string, data?: string): ProcessingInstruction;
}

export interface Comment extends CharacterData {

}

export interface CommentConstructor extends Ctor<CharacterDataConstructor> {
  readonly prototype: Comment;
  [Symbol.hasInstance](value: unknown): value is Comment;
  new (data?: string): Comment;
}

export interface DocumentFragment extends Node {
  readonly children: HTMLCollection;
  readonly firstElementChild: Element | null;
  readonly lastElementChild: Element | null;
  readonly childElementCount: number;
  prepend(...nodes: Array<Node | string>): void;
  append(...nodes: Array<Node | string>): void;
  replaceChildren(...nodes: Array<Node | string>): void;
  moveBefore(node: Node, child: Node | null): void;
  querySelector(selectors: string): Element | null;
  querySelectorAll(selectors: string): NodeList;
  getElementById(elementId: string): Element | null;
}

export interface DocumentFragmentConstructor extends Ctor<NodeConstructor> {
  readonly prototype: DocumentFragment;
  [Symbol.hasInstance](value: unknown): value is DocumentFragment;
  new (): DocumentFragment;
}

export interface ShadowRoot extends DocumentFragment {
  readonly mode: ShadowRootMode;
  readonly delegatesFocus: boolean;
  readonly slotAssignment: SlotAssignmentMode;
  readonly clonable: boolean;
  readonly serializable: boolean;
  readonly host: Element;
  onslotchange: EventHandlerNonNull | null;
  readonly customElementRegistry: CustomElementRegistry | null;
  readonly activeElement: Element | null;
  readonly styleSheets: StyleSheetList;
  adoptedStyleSheets: Array<CSSStyleSheet>;
}

export interface ShadowRootConstructor extends Ctor<DocumentFragmentConstructor> {
  readonly prototype: ShadowRoot;
  [Symbol.hasInstance](value: unknown): value is ShadowRoot;
}

export interface Document extends Node {
  readonly implementation: DOMImplementation;
  readonly URL: string;
  readonly documentURI: string;
  readonly compatMode: string;
  readonly characterSet: string;
  readonly charset: string;
  readonly inputEncoding: string;
  readonly contentType: string;
  readonly doctype: DocumentType | null;
  readonly documentElement: Element | null;
  getElementsByTagName(qualifiedName: string): HTMLCollection;
  getElementsByTagNameNS(namespace: string | null, localName: string): HTMLCollection;
  getElementsByClassName(classNames: string): HTMLCollection;
  createElement(localName: string, options?: string | ElementCreationOptions): Element;
  createElementNS(namespace: string | null, qualifiedName: string, options?: string | ElementCreationOptions): Element;
  createDocumentFragment(): DocumentFragment;
  createTextNode(data: string): Text;
  createCDATASection(data: string): CDATASection;
  createComment(data: string): Comment;
  createProcessingInstruction(target: string, data: string): ProcessingInstruction;
  importNode(node: Node, options?: boolean | ImportNodeOptions): Node;
  adoptNode(node: Node): Node;
  createAttribute(localName: string): Attr;
  createAttributeNS(namespace: string | null, qualifiedName: string): Attr;
  createEvent(interface_: string): Event;
  createRange(): Range;
  createNodeIterator(root: Node, whatToShow?: number, filter?: NodeFilter | null): NodeIterator;
  createTreeWalker(root: Node, whatToShow?: number, filter?: NodeFilter | null): TreeWalker;
  readonly referrer: string;
  cookie: string;
  readonly lastModified: string;
  readonly readyState: DocumentReadyState;
  title: string;
  dir: string;
  body: HTMLElement | null;
  readonly head: HTMLHeadElement | null;
  readonly images: HTMLCollection;
  readonly embeds: HTMLCollection;
  readonly plugins: HTMLCollection;
  readonly links: HTMLCollection;
  readonly forms: HTMLCollection;
  readonly scripts: HTMLCollection;
  getElementsByName(elementName: string): NodeList;
  readonly currentScript: HTMLScriptElement | SVGScriptElement | null;
  write(...text: Array<string>): void;
  readonly defaultView: WindowProxy | null;
  onreadystatechange: EventHandlerNonNull | null;
  readonly all: HTMLAllCollection;
  readonly children: HTMLCollection;
  readonly firstElementChild: Element | null;
  readonly lastElementChild: Element | null;
  readonly childElementCount: number;
  prepend(...nodes: Array<Node | string>): void;
  append(...nodes: Array<Node | string>): void;
  replaceChildren(...nodes: Array<Node | string>): void;
  moveBefore(node: Node, child: Node | null): void;
  querySelector(selectors: string): Element | null;
  querySelectorAll(selectors: string): NodeList;
  getElementById(elementId: string): Element | null;
  readonly customElementRegistry: CustomElementRegistry | null;
  readonly activeElement: Element | null;
  readonly styleSheets: StyleSheetList;
  adoptedStyleSheets: Array<CSSStyleSheet>;
}

export interface DocumentConstructor extends Ctor<NodeConstructor> {
  readonly prototype: Document;
  [Symbol.hasInstance](value: unknown): value is Document;
  new (): Document;
}

export interface XMLDocument extends Document {

}

export interface XMLDocumentConstructor extends Ctor<DocumentConstructor> {
  readonly prototype: XMLDocument;
  [Symbol.hasInstance](value: unknown): value is XMLDocument;
}

export interface DOMImplementation {
  createDocumentType(name: string, publicId: string, systemId: string): DocumentType;
  createDocument(namespace: string | null, qualifiedName: string, doctype?: DocumentType | null): XMLDocument;
  createHTMLDocument(title?: string): Document;
  hasFeature(): boolean;
}

export interface DOMImplementationConstructor {
  readonly prototype: DOMImplementation;
  [Symbol.hasInstance](value: unknown): value is DOMImplementation;
}

export interface Element extends Node {
  readonly namespaceURI: string | null;
  readonly prefix: string | null;
  readonly localName: string;
  readonly tagName: string;
  id: string;
  className: string;
  get classList(): DOMTokenList;
  set classList(value: string);
  slot: string;
  hasAttributes(): boolean;
  readonly attributes: NamedNodeMap;
  getAttributeNames(): Array<string>;
  getAttribute(qualifiedName: string): string | null;
  getAttributeNS(namespace: string | null, localName: string): string | null;
  setAttribute(qualifiedName: string, value: TrustedHTML | TrustedScript | TrustedScriptURL | string): void;
  setAttributeNS(namespace: string | null, qualifiedName: string, value: TrustedHTML | TrustedScript | TrustedScriptURL | string): void;
  removeAttribute(qualifiedName: string): void;
  removeAttributeNS(namespace: string | null, localName: string): void;
  toggleAttribute(qualifiedName: string, force?: boolean): boolean;
  hasAttribute(qualifiedName: string): boolean;
  hasAttributeNS(namespace: string | null, localName: string): boolean;
  getAttributeNode(qualifiedName: string): Attr | null;
  getAttributeNodeNS(namespace: string | null, localName: string): Attr | null;
  setAttributeNode(attr: Attr): Attr | null;
  setAttributeNodeNS(attr: Attr): Attr | null;
  removeAttributeNode(attr: Attr): Attr;
  attachShadow(init: ShadowRootInit): ShadowRoot;
  readonly shadowRoot: ShadowRoot | null;
  closest(selectors: string): Element | null;
  matches(selectors: string): boolean;
  webkitMatchesSelector(selectors: string): boolean;
  getElementsByTagName(qualifiedName: string): HTMLCollection;
  getElementsByTagNameNS(namespace: string | null, localName: string): HTMLCollection;
  getElementsByClassName(classNames: string): HTMLCollection;
  insertAdjacentElement(where: string, element: Element): Element | null;
  insertAdjacentText(where: string, data: string): void;
  readonly children: HTMLCollection;
  readonly firstElementChild: Element | null;
  readonly lastElementChild: Element | null;
  readonly childElementCount: number;
  prepend(...nodes: Array<Node | string>): void;
  append(...nodes: Array<Node | string>): void;
  replaceChildren(...nodes: Array<Node | string>): void;
  moveBefore(node: Node, child: Node | null): void;
  querySelector(selectors: string): Element | null;
  querySelectorAll(selectors: string): NodeList;
  before(...nodes: Array<Node | string>): void;
  after(...nodes: Array<Node | string>): void;
  replaceWith(...nodes: Array<Node | string>): void;
  remove(): void;
  readonly previousElementSibling: Element | null;
  readonly nextElementSibling: Element | null;
  readonly assignedSlot: HTMLSlotElement | null;
}

export interface ElementConstructor extends Ctor<NodeConstructor> {
  readonly prototype: Element;
  [Symbol.hasInstance](value: unknown): value is Element;
}

export interface MediaList {
  mediaText: string;
  toString(): string;
  readonly length: number;
  item(index: number): string | null;
  appendMedium(medium: string): void;
  deleteMedium(medium: string): void;
  readonly [index: number]: string | null | undefined;
  [Symbol.iterator](): IterableIterator<string | null>;
}

export interface MediaListConstructor {
  readonly prototype: MediaList;
  [Symbol.hasInstance](value: unknown): value is MediaList;
}

export interface StyleSheet {
  readonly type: string;
  readonly href: string | null;
  readonly ownerNode: Element | ProcessingInstruction | null;
  readonly parentStyleSheet: CSSStyleSheet | null;
  readonly title: string | null;
  get media(): MediaList;
  set media(value: string);
  disabled: boolean;
}

export interface StyleSheetConstructor {
  readonly prototype: StyleSheet;
  [Symbol.hasInstance](value: unknown): value is StyleSheet;
}

export interface StyleSheetList {
  item(index: number): CSSStyleSheet | null;
  readonly length: number;
  readonly [index: number]: CSSStyleSheet | null | undefined;
  [Symbol.iterator](): IterableIterator<CSSStyleSheet | null>;
}

export interface StyleSheetListConstructor {
  readonly prototype: StyleSheetList;
  [Symbol.hasInstance](value: unknown): value is StyleSheetList;
}

export interface CSSRule {
  cssText: string;
  readonly parentRule: CSSRule | null;
  readonly parentStyleSheet: CSSStyleSheet | null;
  readonly type: number;
  readonly STYLE_RULE: 1;
  readonly CHARSET_RULE: 2;
  readonly IMPORT_RULE: 3;
  readonly MEDIA_RULE: 4;
  readonly FONT_FACE_RULE: 5;
  readonly PAGE_RULE: 6;
  readonly MARGIN_RULE: 9;
  readonly NAMESPACE_RULE: 10;
  readonly KEYFRAMES_RULE: 7;
  readonly KEYFRAME_RULE: 8;
  readonly COUNTER_STYLE_RULE: 11;
  readonly SUPPORTS_RULE: 12;
  readonly FONT_FEATURE_VALUES_RULE: 14;
}

export interface CSSRuleConstructor {
  readonly prototype: CSSRule;
  [Symbol.hasInstance](value: unknown): value is CSSRule;
  readonly STYLE_RULE: 1;
  readonly CHARSET_RULE: 2;
  readonly IMPORT_RULE: 3;
  readonly MEDIA_RULE: 4;
  readonly FONT_FACE_RULE: 5;
  readonly PAGE_RULE: 6;
  readonly MARGIN_RULE: 9;
  readonly NAMESPACE_RULE: 10;
  readonly KEYFRAMES_RULE: 7;
  readonly KEYFRAME_RULE: 8;
  readonly COUNTER_STYLE_RULE: 11;
  readonly SUPPORTS_RULE: 12;
  readonly FONT_FEATURE_VALUES_RULE: 14;
}

export interface CSSRuleList {
  item(index: number): CSSRule | null;
  readonly length: number;
  readonly [index: number]: CSSRule | null | undefined;
  [Symbol.iterator](): IterableIterator<CSSRule | null>;
}

export interface CSSRuleListConstructor {
  readonly prototype: CSSRuleList;
  [Symbol.hasInstance](value: unknown): value is CSSRuleList;
}

export interface CSSGroupingRule extends CSSRule {
  readonly cssRules: CSSRuleList;
  insertRule(rule: string, index?: number): number;
  deleteRule(index: number): void;
}

export interface CSSGroupingRuleConstructor extends Ctor<CSSRuleConstructor> {
  readonly prototype: CSSGroupingRule;
  [Symbol.hasInstance](value: unknown): value is CSSGroupingRule;
}

export interface CSSStyleRule extends CSSGroupingRule {
  selectorText: string;
  get style(): CSSStyleProperties;
  set style(value: string);
}

export interface CSSStyleRuleConstructor extends Ctor<CSSGroupingRuleConstructor> {
  readonly prototype: CSSStyleRule;
  [Symbol.hasInstance](value: unknown): value is CSSStyleRule;
}

export interface CSSNestedDeclarations extends CSSRule {
  get style(): CSSStyleProperties;
  set style(value: string);
}

export interface CSSNestedDeclarationsConstructor extends Ctor<CSSRuleConstructor> {
  readonly prototype: CSSNestedDeclarations;
  [Symbol.hasInstance](value: unknown): value is CSSNestedDeclarations;
}

export interface CSSPropertyRule extends CSSRule {
  readonly name: string;
  readonly syntax: string;
  readonly inherits: boolean;
  readonly initialValue: string | null;
}

export interface CSSPropertyRuleConstructor extends Ctor<CSSRuleConstructor> {
  readonly prototype: CSSPropertyRule;
  [Symbol.hasInstance](value: unknown): value is CSSPropertyRule;
}

export interface CSSStyleDeclaration {
  cssText: string;
  readonly length: number;
  item(index: number): string;
  getPropertyValue(property: string): string;
  getPropertyPriority(property: string): string;
  setProperty(property: string, value: string, priority?: string): void;
  removeProperty(property: string): string;
  readonly parentRule: CSSRule | null;
  readonly [index: number]: string | undefined;
  [Symbol.iterator](): IterableIterator<string>;
}

export interface CSSStyleDeclarationConstructor {
  readonly prototype: CSSStyleDeclaration;
  [Symbol.hasInstance](value: unknown): value is CSSStyleDeclaration;
}

export interface CSSStyleSheet extends StyleSheet {
  readonly ownerRule: CSSRule | null;
  readonly cssRules: CSSRuleList;
  insertRule(rule: string, index?: number): number;
  deleteRule(index: number): void;
  replace(text: string): Promise<CSSStyleSheet>;
  replaceSync(text: string): void;
  readonly rules: CSSRuleList;
  addRule(selector?: string, style?: string, index?: number): number;
  removeRule(index?: number): void;
}

export interface CSSStyleSheetConstructor extends Ctor<StyleSheetConstructor> {
  readonly prototype: CSSStyleSheet;
  [Symbol.hasInstance](value: unknown): value is CSSStyleSheet;
  new (options?: CSSStyleSheetInit): CSSStyleSheet;
}

export interface CSSStyleProperties extends CSSStyleDeclaration {
  cssFloat: string;
  backgroundColor: string;
  "background-color": string;
  color: string;
  marginBottom: string;
  "margin-bottom": string;
  marginLeft: string;
  "margin-left": string;
  marginRight: string;
  "margin-right": string;
  marginTop: string;
  "margin-top": string;
  opacity: string;
  readonly [index: number]: string | undefined;
  [Symbol.iterator](): IterableIterator<string>;
}

export interface CSSStylePropertiesConstructor extends Ctor<CSSStyleDeclarationConstructor> {
  readonly prototype: CSSStyleProperties;
  [Symbol.hasInstance](value: unknown): value is CSSStyleProperties;
}

export interface ByteLengthQueuingStrategy {
  readonly highWaterMark: number;
  readonly size: Function;
}

export interface ByteLengthQueuingStrategyConstructor {
  readonly prototype: ByteLengthQueuingStrategy;
  [Symbol.hasInstance](value: unknown): value is ByteLengthQueuingStrategy;
  new (init: QueuingStrategyInit): ByteLengthQueuingStrategy;
}

export interface CountQueuingStrategy {
  readonly highWaterMark: number;
  readonly size: Function;
}

export interface CountQueuingStrategyConstructor {
  readonly prototype: CountQueuingStrategy;
  [Symbol.hasInstance](value: unknown): value is CountQueuingStrategy;
  new (init: QueuingStrategyInit): CountQueuingStrategy;
}

export interface ReadableStream {
  readonly locked: boolean;
  cancel(reason?: any): Promise<void>;
  getReader(options?: ReadableStreamGetReaderOptions): ReadableStreamDefaultReader | ReadableStreamBYOBReader;
  pipeThrough(transform: ReadableWritablePair, options?: StreamPipeOptions): ReadableStream;
  pipeTo(destination: WritableStream, options?: StreamPipeOptions): Promise<void>;
  tee(): Array<ReadableStream>;
  [Symbol.asyncIterator](options?: ReadableStreamIteratorOptions): AsyncIterableIterator<any>;
  values(options?: ReadableStreamIteratorOptions): AsyncIterableIterator<any>;
}

export interface ReadableStreamConstructor {
  readonly prototype: ReadableStream;
  [Symbol.hasInstance](value: unknown): value is ReadableStream;
  new (underlyingSource?: object, strategy?: QueuingStrategy): ReadableStream;
  from(asyncIterable: AsyncIterable<any> | Iterable<any>): ReadableStream;
}

export interface ReadableStreamDefaultReader {
  read(): Promise<ReadableStreamReadResultResult>;
  releaseLock(): void;
  readonly closed: Promise<void>;
  cancel(reason?: any): Promise<void>;
}

export interface ReadableStreamDefaultReaderConstructor {
  readonly prototype: ReadableStreamDefaultReader;
  [Symbol.hasInstance](value: unknown): value is ReadableStreamDefaultReader;
  new (stream: ReadableStream): ReadableStreamDefaultReader;
}

export interface ReadableStreamBYOBReader {
  read(view: Int8Array<ArrayBuffer> | Int16Array<ArrayBuffer> | Int32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer> | BigInt64Array<ArrayBuffer> | BigUint64Array<ArrayBuffer> | Float16Array<ArrayBuffer> | Float32Array<ArrayBuffer> | Float64Array<ArrayBuffer> | DataView<ArrayBuffer>, options?: ReadableStreamBYOBReaderReadOptions): Promise<ReadableStreamReadResultResult>;
  releaseLock(): void;
  readonly closed: Promise<void>;
  cancel(reason?: any): Promise<void>;
}

export interface ReadableStreamBYOBReaderConstructor {
  readonly prototype: ReadableStreamBYOBReader;
  [Symbol.hasInstance](value: unknown): value is ReadableStreamBYOBReader;
  new (stream: ReadableStream): ReadableStreamBYOBReader;
}

export interface ReadableStreamDefaultController {
  readonly desiredSize: number | null;
  close(): void;
  enqueue(chunk?: any): void;
  error(e?: any): void;
}

export interface ReadableStreamDefaultControllerConstructor {
  readonly prototype: ReadableStreamDefaultController;
  [Symbol.hasInstance](value: unknown): value is ReadableStreamDefaultController;
}

export interface ReadableByteStreamController {
  readonly byobRequest: ReadableStreamBYOBRequest | null;
  readonly desiredSize: number | null;
  close(): void;
  enqueue(chunk: Int8Array<ArrayBuffer> | Int16Array<ArrayBuffer> | Int32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer> | BigInt64Array<ArrayBuffer> | BigUint64Array<ArrayBuffer> | Float16Array<ArrayBuffer> | Float32Array<ArrayBuffer> | Float64Array<ArrayBuffer> | DataView<ArrayBuffer>): void;
  error(e?: any): void;
}

export interface ReadableByteStreamControllerConstructor {
  readonly prototype: ReadableByteStreamController;
  [Symbol.hasInstance](value: unknown): value is ReadableByteStreamController;
}

export interface ReadableStreamBYOBRequest {
  readonly view: Uint8Array<ArrayBuffer> | null;
  respond(bytesWritten: number): void;
  respondWithNewView(view: Int8Array<ArrayBuffer> | Int16Array<ArrayBuffer> | Int32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer> | BigInt64Array<ArrayBuffer> | BigUint64Array<ArrayBuffer> | Float16Array<ArrayBuffer> | Float32Array<ArrayBuffer> | Float64Array<ArrayBuffer> | DataView<ArrayBuffer>): void;
}

export interface ReadableStreamBYOBRequestConstructor {
  readonly prototype: ReadableStreamBYOBRequest;
  [Symbol.hasInstance](value: unknown): value is ReadableStreamBYOBRequest;
}

export interface WritableStream {
  readonly locked: boolean;
  abort(reason?: any): Promise<void>;
  close(): Promise<void>;
  getWriter(): WritableStreamDefaultWriter;
}

export interface WritableStreamConstructor {
  readonly prototype: WritableStream;
  [Symbol.hasInstance](value: unknown): value is WritableStream;
  new (underlyingSink?: object, strategy?: QueuingStrategy): WritableStream;
}

export interface WritableStreamDefaultController {
  readonly signal: AbortSignal;
  error(e?: any): void;
}

export interface WritableStreamDefaultControllerConstructor {
  readonly prototype: WritableStreamDefaultController;
  [Symbol.hasInstance](value: unknown): value is WritableStreamDefaultController;
}

export interface WritableStreamDefaultWriter {
  readonly closed: Promise<void>;
  readonly desiredSize: number | null;
  readonly ready: Promise<void>;
  abort(reason?: any): Promise<void>;
  close(): Promise<void>;
  releaseLock(): void;
  write(chunk?: any): Promise<void>;
}

export interface WritableStreamDefaultWriterConstructor {
  readonly prototype: WritableStreamDefaultWriter;
  [Symbol.hasInstance](value: unknown): value is WritableStreamDefaultWriter;
  new (stream: WritableStream): WritableStreamDefaultWriter;
}

export interface TransformStream {
  readonly readable: ReadableStream;
  readonly writable: WritableStream;
}

export interface TransformStreamConstructor {
  readonly prototype: TransformStream;
  [Symbol.hasInstance](value: unknown): value is TransformStream;
  new (transformer?: object, writableStrategy?: QueuingStrategy, readableStrategy?: QueuingStrategy): TransformStream;
}

export interface TransformStreamDefaultController {
  readonly desiredSize: number | null;
  enqueue(chunk?: any): void;
  error(reason?: any): void;
  terminate(): void;
}

export interface TransformStreamDefaultControllerConstructor {
  readonly prototype: TransformStreamDefaultController;
  [Symbol.hasInstance](value: unknown): value is TransformStreamDefaultController;
}

export interface TextDecoder {
  decode(input?: ArrayBuffer | SharedArrayBuffer | Int8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike> | Uint8ClampedArray<ArrayBufferLike> | BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike> | Float16Array<ArrayBufferLike> | Float32Array<ArrayBufferLike> | Float64Array<ArrayBufferLike> | DataView<ArrayBufferLike>, options?: TextDecodeOptions): string;
  readonly encoding: string;
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;
}

export interface TextDecoderConstructor {
  readonly prototype: TextDecoder;
  [Symbol.hasInstance](value: unknown): value is TextDecoder;
  new (label?: string, options?: TextDecoderOptions): TextDecoder;
}

export interface TextEncoder {
  encode(input?: string): Uint8Array<ArrayBuffer>;
  encodeInto(source: string, destination: Uint8Array<ArrayBufferLike>): TextEncoderEncodeIntoResultResult;
  readonly encoding: string;
}

export interface TextEncoderConstructor {
  readonly prototype: TextEncoder;
  [Symbol.hasInstance](value: unknown): value is TextEncoder;
  new (): TextEncoder;
}

export interface TextDecoderStream {
  readonly encoding: string;
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;
  readonly readable: ReadableStream;
  readonly writable: WritableStream;
}

export interface TextDecoderStreamConstructor {
  readonly prototype: TextDecoderStream;
  [Symbol.hasInstance](value: unknown): value is TextDecoderStream;
  new (label?: string, options?: TextDecoderOptions): TextDecoderStream;
}

export interface TextEncoderStream {
  readonly encoding: string;
  readonly readable: ReadableStream;
  readonly writable: WritableStream;
}

export interface TextEncoderStreamConstructor {
  readonly prototype: TextEncoderStream;
  [Symbol.hasInstance](value: unknown): value is TextEncoderStream;
  new (): TextEncoderStream;
}

export interface Blob {
  readonly size: number;
  readonly type: string;
  slice(start?: number, end?: number, contentType?: string): Blob;
  stream(): ReadableStream;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  textStream(): ReadableStream;
  bytes(): Promise<Uint8Array<ArrayBuffer>>;
}

export interface BlobConstructor {
  readonly prototype: Blob;
  [Symbol.hasInstance](value: unknown): value is Blob;
  new (blobParts?: Iterable<Int8Array<ArrayBuffer> | Int16Array<ArrayBuffer> | Int32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer> | BigInt64Array<ArrayBuffer> | BigUint64Array<ArrayBuffer> | Float16Array<ArrayBuffer> | Float32Array<ArrayBuffer> | Float64Array<ArrayBuffer> | DataView<ArrayBuffer> | ArrayBuffer | Blob | string>, options?: BlobPropertyBag): Blob;
}

export interface File extends Blob {
  readonly name: string;
  readonly lastModified: number;
}

export interface FileConstructor extends Ctor<BlobConstructor> {
  readonly prototype: File;
  [Symbol.hasInstance](value: unknown): value is File;
  new (fileBits: Iterable<Int8Array<ArrayBuffer> | Int16Array<ArrayBuffer> | Int32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer> | BigInt64Array<ArrayBuffer> | BigUint64Array<ArrayBuffer> | Float16Array<ArrayBuffer> | Float32Array<ArrayBuffer> | Float64Array<ArrayBuffer> | DataView<ArrayBuffer> | ArrayBuffer | Blob | string>, fileName: string, options?: FilePropertyBag): File;
}

export interface FileList {
  item(index: number): File | null;
  readonly length: number;
  readonly [index: number]: File | null | undefined;
  [Symbol.iterator](): IterableIterator<File | null>;
}

export interface FileListConstructor {
  readonly prototype: FileList;
  [Symbol.hasInstance](value: unknown): value is FileList;
}

export interface FileReader extends EventTarget {
  readAsArrayBuffer(blob: Blob): void;
  readAsBinaryString(blob: Blob): void;
  readAsText(blob: Blob, encoding?: string): void;
  readAsDataURL(blob: Blob): void;
  abort(): void;
  readonly EMPTY: 0;
  readonly LOADING: 1;
  readonly DONE: 2;
  readonly readyState: number;
  readonly result: string | ArrayBuffer | null;
  readonly error: DOMException | null;
  onloadstart: EventHandlerNonNull | null;
  onprogress: EventHandlerNonNull | null;
  onload: EventHandlerNonNull | null;
  onabort: EventHandlerNonNull | null;
  onerror: EventHandlerNonNull | null;
  onloadend: EventHandlerNonNull | null;
}

export interface FileReaderConstructor extends Ctor<EventTargetConstructor> {
  readonly prototype: FileReader;
  [Symbol.hasInstance](value: unknown): value is FileReader;
  new (): FileReader;
  readonly EMPTY: 0;
  readonly LOADING: 1;
  readonly DONE: 2;
}

export interface FormData {
  append(name: string, value: string): void;
  append(name: string, blobValue: Blob, filename?: string): void;
  delete(name: string): void;
  get(name: string): File | string | null;
  getAll(name: string): Array<File | string>;
  has(name: string): boolean;
  set(name: string, value: string): void;
  set(name: string, blobValue: Blob, filename?: string): void;
  [Symbol.iterator](): IterableIterator<[string, File | string]>;
  values(): IterableIterator<File | string>;
  keys(): IterableIterator<string>;
  entries(): IterableIterator<[string, File | string]>;
  forEach(callback: (value: File | string, key: string, parent: this) => void, thisArg?: unknown): void;
}

export interface FormDataConstructor {
  readonly prototype: FormData;
  [Symbol.hasInstance](value: unknown): value is FormData;
  new (form?: HTMLFormElement, submitter?: HTMLElement | null): FormData;
}

export interface ProgressEvent extends Event {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;
}

export interface ProgressEventConstructor extends Ctor<EventConstructor> {
  readonly prototype: ProgressEvent;
  [Symbol.hasInstance](value: unknown): value is ProgressEvent;
  new (type: string, eventInitDict?: ProgressEventInit): ProgressEvent;
}

export interface URL {
  href: string;
  toString(): string;
  readonly origin: string;
  protocol: string;
  username: string;
  password: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  readonly searchParams: URLSearchParams;
  hash: string;
  toJSON(): string;
}

export interface URLConstructor {
  readonly prototype: URL;
  [Symbol.hasInstance](value: unknown): value is URL;
  new (url: string, base?: string): URL;
  parse(url: string, base?: string): URL | null;
  canParse(url: string, base?: string): boolean;
  createObjectURL(obj: Blob): string;
  revokeObjectURL(url: string): void;
}

export interface URLSearchParams {
  readonly size: number;
  append(name: string, value: string): void;
  delete(name: string, value?: string): void;
  get(name: string): string | null;
  getAll(name: string): Array<string>;
  has(name: string, value?: string): boolean;
  set(name: string, value: string): void;
  sort(): void;
  toString(): string;
  [Symbol.iterator](): IterableIterator<[string, string]>;
  values(): IterableIterator<string>;
  keys(): IterableIterator<string>;
  entries(): IterableIterator<[string, string]>;
  forEach(callback: (value: string, key: string, parent: this) => void, thisArg?: unknown): void;
}

export interface URLSearchParamsConstructor {
  readonly prototype: URLSearchParams;
  [Symbol.hasInstance](value: unknown): value is URLSearchParams;
  new (init?: Iterable<Iterable<string>> | Record<string, string> | string): URLSearchParams;
}

export interface Headers {
  append(name: string, value: string): void;
  delete(name: string): void;
  get(name: string): string | null;
  getSetCookie(): Array<string>;
  has(name: string): boolean;
  set(name: string, value: string): void;
  [Symbol.iterator](): IterableIterator<[string, string]>;
  values(): IterableIterator<string>;
  keys(): IterableIterator<string>;
  entries(): IterableIterator<[string, string]>;
  forEach(callback: (value: string, key: string, parent: this) => void, thisArg?: unknown): void;
}

export interface HeadersConstructor {
  readonly prototype: Headers;
  [Symbol.hasInstance](value: unknown): value is Headers;
  new (init?: Iterable<Iterable<string>> | Record<string, string>): Headers;
}

export interface Request {
  readonly method: string;
  readonly url: string;
  readonly headers: Headers;
  readonly destination: RequestDestination;
  readonly referrer: string;
  readonly referrerPolicy: ReferrerPolicy;
  readonly mode: RequestMode;
  readonly credentials: RequestCredentials;
  readonly cache: RequestCache;
  readonly redirect: RequestRedirect;
  readonly integrity: string;
  readonly keepalive: boolean;
  readonly isReloadNavigation: boolean;
  readonly isHistoryNavigation: boolean;
  readonly signal: AbortSignal;
  readonly duplex: RequestDuplex;
  clone(): Request;
  readonly body: ReadableStream | null;
  readonly bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  blob(): Promise<Blob>;
  bytes(): Promise<Uint8Array<ArrayBuffer>>;
  formData(): Promise<FormData>;
  json(): Promise<any>;
  text(): Promise<string>;
  textStream(): ReadableStream;
}

export interface RequestConstructor {
  readonly prototype: Request;
  [Symbol.hasInstance](value: unknown): value is Request;
  new (input: Request | string, init?: RequestInit): Request;
}

export interface Response {
  readonly type: ResponseType;
  readonly url: string;
  readonly redirected: boolean;
  readonly status: number;
  readonly ok: boolean;
  readonly statusText: string;
  readonly headers: Headers;
  clone(): Response;
  readonly body: ReadableStream | null;
  readonly bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  blob(): Promise<Blob>;
  bytes(): Promise<Uint8Array<ArrayBuffer>>;
  formData(): Promise<FormData>;
  json(): Promise<any>;
  text(): Promise<string>;
  textStream(): ReadableStream;
}

export interface ResponseConstructor {
  readonly prototype: Response;
  [Symbol.hasInstance](value: unknown): value is Response;
  new (body?: ReadableStream | Blob | Int8Array<ArrayBuffer> | Int16Array<ArrayBuffer> | Int32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer> | BigInt64Array<ArrayBuffer> | BigUint64Array<ArrayBuffer> | Float16Array<ArrayBuffer> | Float32Array<ArrayBuffer> | Float64Array<ArrayBuffer> | DataView<ArrayBuffer> | ArrayBuffer | FormData | URLSearchParams | string | null, init?: ResponseInit): Response;
  error(): Response;
  redirect(url: string, status?: number): Response;
  json(data: any, init?: ResponseInit): Response;
}

export interface TrustedHTML {
  toString(): string;
  toJSON(): string;
}

export interface TrustedHTMLConstructor {
  readonly prototype: TrustedHTML;
  [Symbol.hasInstance](value: unknown): value is TrustedHTML;
}

export interface TrustedScript {
  toString(): string;
  toJSON(): string;
}

export interface TrustedScriptConstructor {
  readonly prototype: TrustedScript;
  [Symbol.hasInstance](value: unknown): value is TrustedScript;
}

export interface TrustedScriptURL {
  toString(): string;
  toJSON(): string;
}

export interface TrustedScriptURLConstructor {
  readonly prototype: TrustedScriptURL;
  [Symbol.hasInstance](value: unknown): value is TrustedScriptURL;
}

export interface TrustedTypePolicy {
  readonly name: string;
  createHTML(input: string, ...arguments_: Array<any>): TrustedHTML;
  createScript(input: string, ...arguments_: Array<any>): TrustedScript;
  createScriptURL(input: string, ...arguments_: Array<any>): TrustedScriptURL;
}

export interface TrustedTypePolicyConstructor {
  readonly prototype: TrustedTypePolicy;
  [Symbol.hasInstance](value: unknown): value is TrustedTypePolicy;
}

export interface TrustedTypePolicyFactory {
  createPolicy(policyName: string, policyOptions?: TrustedTypePolicyOptions): TrustedTypePolicy;
  isHTML(value: any): boolean;
  isScript(value: any): boolean;
  isScriptURL(value: any): boolean;
  readonly emptyHTML: TrustedHTML;
  readonly emptyScript: TrustedScript;
  getAttributeType(tagName: string, attribute: string, elementNs?: string | null, attrNs?: string | null): string | null;
  getPropertyType(tagName: string, property: string, elementNs?: string | null): string | null;
  readonly defaultPolicy: TrustedTypePolicy | null;
}

export interface TrustedTypePolicyFactoryConstructor {
  readonly prototype: TrustedTypePolicyFactory;
  [Symbol.hasInstance](value: unknown): value is TrustedTypePolicyFactory;
}

export interface ReadableStreamReadResultResult {
  done?: boolean;
  value?: any;
}

export interface TextEncoderEncodeIntoResultResult {
  read?: number;
  written?: number;
}
