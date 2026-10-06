// Generated from Web IDL declarations. Do not edit by hand.

// Platform types only; importing this module does not install or export runtime objects.

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

export type ArrayBufferView = (Int8Array<ArrayBuffer> | Int16Array<ArrayBuffer> | Int32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer> | BigInt64Array<ArrayBuffer> | BigUint64Array<ArrayBuffer> | Float16Array<ArrayBuffer> | Float32Array<ArrayBuffer> | Float64Array<ArrayBuffer> | DataView<ArrayBuffer>);

export type BufferSource = ((Int8Array<ArrayBuffer> | Int16Array<ArrayBuffer> | Int32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer> | BigInt64Array<ArrayBuffer> | BigUint64Array<ArrayBuffer> | Float16Array<ArrayBuffer> | Float32Array<ArrayBuffer> | Float64Array<ArrayBuffer> | DataView<ArrayBuffer>) | ArrayBuffer);

export type AllowSharedBufferSource = (ArrayBuffer | SharedArrayBuffer | (Int8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike> | Uint8ClampedArray<ArrayBufferLike> | BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike> | Float16Array<ArrayBufferLike> | Float32Array<ArrayBufferLike> | Float64Array<ArrayBufferLike> | DataView<ArrayBufferLike>));

export type ReportList = Iterable<Report>;

export type DOMHighResTimeStamp = number;

export type EpochTimeStamp = number;

export type EventHandler = (EventHandlerNonNull | null);

export type TimerHandler = (string | Function);

export type ReadableStreamController = (ReadableStreamDefaultController | ReadableByteStreamController);

export type ReadableStreamReader = (ReadableStreamDefaultReader | ReadableStreamBYOBReader);

export type BlobPart = (((Int8Array<ArrayBuffer> | Int16Array<ArrayBuffer> | Int32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer> | BigInt64Array<ArrayBuffer> | BigUint64Array<ArrayBuffer> | Float16Array<ArrayBuffer> | Float32Array<ArrayBuffer> | Float64Array<ArrayBuffer> | DataView<ArrayBuffer>) | ArrayBuffer) | Blob | string);

export type FormDataEntryValue = (File | string);

export type HeadersInit = (Iterable<Iterable<string>> | Record<string, string>);

export type XMLHttpRequestBodyInit = (Blob | ((Int8Array<ArrayBuffer> | Int16Array<ArrayBuffer> | Int32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer> | BigInt64Array<ArrayBuffer> | BigUint64Array<ArrayBuffer> | Float16Array<ArrayBuffer> | Float32Array<ArrayBuffer> | Float64Array<ArrayBuffer> | DataView<ArrayBuffer>) | ArrayBuffer) | FormData | URLSearchParams | string);

export type BodyInit = (ReadableStream | (Blob | ((Int8Array<ArrayBuffer> | Int16Array<ArrayBuffer> | Int32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer> | BigInt64Array<ArrayBuffer> | BigUint64Array<ArrayBuffer> | Float16Array<ArrayBuffer> | Float32Array<ArrayBuffer> | Float64Array<ArrayBuffer> | DataView<ArrayBuffer>) | ArrayBuffer) | FormData | URLSearchParams | string));

export type RequestInfo = (Request | string);

export type WindowProxy = Window;

export interface QuotaExceededErrorOptions {
  quota?: number;
  requested?: number;
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

export interface ProgressEventInit {
  bubbles?: boolean;
  cancelable?: boolean;
  composed?: boolean;
  lengthComputable?: boolean;
  loaded?: number;
  total?: number;
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

export interface GetRootNodeOptions {
  composed?: boolean;
}

export interface ElementCreationOptions {
  is?: string;
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

export interface RequestInit {
  body?: ((ReadableStream | (Blob | ((Int8Array<ArrayBuffer> | Int16Array<ArrayBuffer> | Int32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer> | BigInt64Array<ArrayBuffer> | BigUint64Array<ArrayBuffer> | Float16Array<ArrayBuffer> | Float32Array<ArrayBuffer> | Float64Array<ArrayBuffer> | DataView<ArrayBuffer>) | ArrayBuffer) | FormData | URLSearchParams | string)) | null);
  cache?: RequestCache;
  credentials?: RequestCredentials;
  duplex?: RequestDuplex;
  headers?: (Iterable<Iterable<string>> | Record<string, string>);
  integrity?: string;
  keepalive?: boolean;
  method?: string;
  mode?: RequestMode;
  priority?: RequestPriority;
  redirect?: RequestRedirect;
  referrer?: string;
  referrerPolicy?: ReferrerPolicy;
  signal?: (AbortSignal | null);
  window?: any;
}

export interface ResponseInit {
  headers?: (Iterable<Iterable<string>> | Record<string, string>);
  status?: number;
  statusText?: string;
}

export type Function = (...arguments_: Array<any>) => any;

export type VoidFunction = () => void;

export type ReportingObserverCallback = (reports: Array<Report>, observer: ReportingObserver) => void;

export type EventHandlerNonNull = (event: Event) => any;

export type QueuingStrategySize = (chunk: any) => number;

export type UnderlyingSourceStartCallback = (controller: (ReadableStreamDefaultController | ReadableByteStreamController)) => any;

export type UnderlyingSourcePullCallback = (controller: (ReadableStreamDefaultController | ReadableByteStreamController)) => (void | PromiseLike<void>);

export type UnderlyingSourceCancelCallback = (reason?: any) => (void | PromiseLike<void>);

export type UnderlyingSinkStartCallback = (controller: WritableStreamDefaultController) => any;

export type UnderlyingSinkWriteCallback = (chunk: any, controller: WritableStreamDefaultController) => (void | PromiseLike<void>);

export type UnderlyingSinkCloseCallback = () => (void | PromiseLike<void>);

export type UnderlyingSinkAbortCallback = (reason?: any) => (void | PromiseLike<void>);

export type TransformerStartCallback = (controller: TransformStreamDefaultController) => any;

export type TransformerFlushCallback = (controller: TransformStreamDefaultController) => (void | PromiseLike<void>);

export type TransformerTransformCallback = (chunk: any, controller: TransformStreamDefaultController) => (void | PromiseLike<void>);

export type TransformerCancelCallback = (reason: any) => (void | PromiseLike<void>);

export type EventListener = {
  handleEvent(event: Event): void;
} | ((event: Event) => void);

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
  readonly quota: (number | null);
  readonly requested: (number | null);
}

export interface QuotaExceededErrorConstructor {
  readonly prototype: QuotaExceededError;
  [Symbol.hasInstance](value: unknown): value is QuotaExceededError;
  new (message?: string, options?: QuotaExceededErrorOptions): QuotaExceededError;
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

export interface CustomElementRegistry {

}

export interface CustomElementRegistryConstructor {
  readonly prototype: CustomElementRegistry;
  [Symbol.hasInstance](value: unknown): value is CustomElementRegistry;
}

export interface HTMLElement extends Element {
  /** The declaration leaves the forwarded property opaque; its assignment type is unknown. */
  get style(): object;
  set style(value: unknown);
}

export interface HTMLElementConstructor {
  readonly prototype: HTMLElement;
  [Symbol.hasInstance](value: unknown): value is HTMLElement;
}

export interface HTMLUnknownElement extends HTMLElement {

}

export interface HTMLUnknownElementConstructor {
  readonly prototype: HTMLUnknownElement;
  [Symbol.hasInstance](value: unknown): value is HTMLUnknownElement;
}

export interface HTMLHeadElement extends HTMLElement {

}

export interface HTMLHeadElementConstructor {
  readonly prototype: HTMLHeadElement;
  [Symbol.hasInstance](value: unknown): value is HTMLHeadElement;
}

export interface HTMLBaseElement extends HTMLElement {
  href: string;
  target: string;
}

export interface HTMLBaseElementConstructor {
  readonly prototype: HTMLBaseElement;
  [Symbol.hasInstance](value: unknown): value is HTMLBaseElement;
}

export interface HTMLStyleElement extends HTMLElement {
  readonly sheet: (object | null);
}

export interface HTMLStyleElementConstructor {
  readonly prototype: HTMLStyleElement;
  [Symbol.hasInstance](value: unknown): value is HTMLStyleElement;
}

export interface HTMLLinkElement extends HTMLElement {
  readonly sheet: (object | null);
}

export interface HTMLLinkElementConstructor {
  readonly prototype: HTMLLinkElement;
  [Symbol.hasInstance](value: unknown): value is HTMLLinkElement;
}

export interface HTMLFormElement extends HTMLElement {

}

export interface HTMLFormElementConstructor {
  readonly prototype: HTMLFormElement;
  [Symbol.hasInstance](value: unknown): value is HTMLFormElement;
}

export interface SVGElement extends Element {
  /** The declaration leaves the forwarded property opaque; its assignment type is unknown. */
  get style(): object;
  set style(value: unknown);
}

export interface SVGElementConstructor {
  readonly prototype: SVGElement;
  [Symbol.hasInstance](value: unknown): value is SVGElement;
}

export interface SVGStyleElement extends SVGElement {
  readonly sheet: (object | null);
}

export interface SVGStyleElementConstructor {
  readonly prototype: SVGStyleElement;
  [Symbol.hasInstance](value: unknown): value is SVGStyleElement;
}

export interface MathMLElement extends Element {
  /** The declaration leaves the forwarded property opaque; its assignment type is unknown. */
  get style(): object;
  set style(value: unknown);
}

export interface MathMLElementConstructor {
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
  readonly body: (ReportBody | null);
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

export interface IntegrityViolationReportBodyConstructor {
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
  readonly referrer: (string | null);
  readonly blockedURL: (string | null);
  readonly effectiveDirective: string;
  readonly originalPolicy: string;
  readonly sourceFile: (string | null);
  readonly sample: (string | null);
  readonly disposition: SecurityPolicyViolationEventDisposition;
  readonly statusCode: number;
  readonly lineNumber: (number | null);
  readonly columnNumber: (number | null);
  toJSON(): object;
}

export interface CSPViolationReportBodyConstructor {
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

export interface SecurityPolicyViolationEventConstructor {
  readonly prototype: SecurityPolicyViolationEvent;
  [Symbol.hasInstance](value: unknown): value is SecurityPolicyViolationEvent;
  new (type: string, eventInitDict?: SecurityPolicyViolationEventInit): SecurityPolicyViolationEvent;
  readonly NONE: 0;
  readonly CAPTURING_PHASE: 1;
  readonly AT_TARGET: 2;
  readonly BUBBLING_PHASE: 3;
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

export interface PerformanceConstructor {
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
  get event(): (Event | undefined);
  set event(value: unknown);
  readonly isSecureContext: boolean;
  setTimeout(handler: (string | Function), timeout?: number, ...arguments_: Array<any>): number;
  clearTimeout(id?: number): void;
  setInterval(handler: (string | Function), timeout?: number, ...arguments_: Array<any>): number;
  clearInterval(id?: number): void;
  queueMicrotask(callback: VoidFunction): void;
  structuredClone<T = any>(value: T, options?: StructuredSerializeOptions): T;
  get performance(): Performance;
  set performance(value: unknown);
  fetch(input: (Request | string), init?: RequestInit): Promise<Response>;
  DOMException: DOMExceptionConstructor;
  QuotaExceededError: QuotaExceededErrorConstructor;
  CustomElementRegistry: CustomElementRegistryConstructor;
  HTMLElement: HTMLElementConstructor;
  HTMLUnknownElement: HTMLUnknownElementConstructor;
  HTMLHeadElement: HTMLHeadElementConstructor;
  HTMLBaseElement: HTMLBaseElementConstructor;
  HTMLStyleElement: HTMLStyleElementConstructor;
  HTMLLinkElement: HTMLLinkElementConstructor;
  HTMLFormElement: HTMLFormElementConstructor;
  SVGElement: SVGElementConstructor;
  SVGStyleElement: SVGStyleElementConstructor;
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
  ProgressEvent: ProgressEventConstructor;
  EventTarget: EventTargetConstructor;
  AbortSignal: AbortSignalConstructor;
  AbortController: AbortControllerConstructor;
  Node: NodeConstructor;
  HTMLCollection: HTMLCollectionConstructor;
  NamedNodeMap: NamedNodeMapConstructor;
  Attr: AttrConstructor;
  CharacterData: CharacterDataConstructor;
  DocumentType: DocumentTypeConstructor;
  Text: TextConstructor;
  Comment: CommentConstructor;
  DocumentFragment: DocumentFragmentConstructor;
  ShadowRoot: ShadowRootConstructor;
  Document: DocumentConstructor;
  Element: ElementConstructor;
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
  URL: URLConstructor;
  webkitURL: URLConstructor;
  URLSearchParams: URLSearchParamsConstructor;
  Headers: HeadersConstructor;
  Request: RequestConstructor;
  Response: ResponseConstructor;
}

export interface WindowConstructor {
  readonly prototype: Window;
  [Symbol.hasInstance](value: unknown): value is Window;
}

export interface Event {
  readonly type: string;
  readonly target: (EventTarget | null);
  readonly srcElement: (EventTarget | null);
  readonly currentTarget: (EventTarget | null);
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

export interface CustomEventConstructor {
  readonly prototype: CustomEvent<any>;
  [Symbol.hasInstance](value: unknown): value is CustomEvent<any>;
  new <T = any>(type: string, eventInitDict?: CustomEventInit<T>): CustomEvent<T>;
  readonly NONE: 0;
  readonly CAPTURING_PHASE: 1;
  readonly AT_TARGET: 2;
  readonly BUBBLING_PHASE: 3;
}

export interface ProgressEvent extends Event {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;
}

export interface ProgressEventConstructor {
  readonly prototype: ProgressEvent;
  [Symbol.hasInstance](value: unknown): value is ProgressEvent;
  new (type: string, eventInitDict?: ProgressEventInit): ProgressEvent;
  readonly NONE: 0;
  readonly CAPTURING_PHASE: 1;
  readonly AT_TARGET: 2;
  readonly BUBBLING_PHASE: 3;
}

export interface EventTarget {
  addEventListener(type: string, callback: (EventListener | null), options?: (AddEventListenerOptions | boolean)): void;
  removeEventListener(type: string, callback: (EventListener | null), options?: (EventListenerOptions | boolean)): void;
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
  onabort: (EventHandlerNonNull | null);
}

export interface AbortSignalConstructor {
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

export interface Node extends EventTarget {
  readonly nodeType: number;
  readonly baseURI: string;
  readonly ownerDocument: (Document | null);
  readonly parentNode: (Node | null);
  readonly parentElement: (Element | null);
  readonly firstChild: (Node | null);
  readonly lastChild: (Node | null);
  readonly previousSibling: (Node | null);
  readonly nextSibling: (Node | null);
  readonly isConnected: boolean;
  getRootNode(options?: GetRootNodeOptions): Node;
  appendChild(node: Node): Node;
  insertBefore(node: Node, child: (Node | null)): Node;
  contains(other: (Node | null)): boolean;
  compareDocumentPosition(other: Node): number;
}

export interface NodeConstructor {
  readonly prototype: Node;
  [Symbol.hasInstance](value: unknown): value is Node;
}

export interface HTMLCollection {
  readonly length: number;
  item(index: number): (Element | null);
  namedItem(name: string): (Element | null);
  readonly [index: number]: (Element | null) | undefined;
  [Symbol.iterator](): IterableIterator<(Element | null)>;
}

export interface HTMLCollectionConstructor {
  readonly prototype: HTMLCollection;
  [Symbol.hasInstance](value: unknown): value is HTMLCollection;
}

export interface NamedNodeMap {
  getNamedItem(qualifiedName: string): (Attr | null);
  setNamedItem(attr: Attr): (Attr | null);
  removeNamedItem(qualifiedName: string): Attr;
  item(index: number): (Attr | null);
  getNamedItemNS(namespace: (string | null), localName: string): (Attr | null);
  setNamedItemNS(attr: Attr): (Attr | null);
  removeNamedItemNS(namespace: (string | null), localName: string): Attr;
  readonly length: number;
  readonly [index: number]: (Attr | null) | undefined;
  [Symbol.iterator](): IterableIterator<(Attr | null)>;
}

export interface NamedNodeMapConstructor {
  readonly prototype: NamedNodeMap;
  [Symbol.hasInstance](value: unknown): value is NamedNodeMap;
}

export interface Attr extends Node {
  readonly namespaceURI: (string | null);
  readonly prefix: (string | null);
  readonly localName: string;
  readonly name: string;
  value: string;
  readonly ownerElement: (Element | null);
  readonly specified: boolean;
}

export interface AttrConstructor {
  readonly prototype: Attr;
  [Symbol.hasInstance](value: unknown): value is Attr;
}

export interface CharacterData extends Node {
  data: string;
  remove(): void;
  readonly previousElementSibling: (Element | null);
  readonly nextElementSibling: (Element | null);
}

export interface CharacterDataConstructor {
  readonly prototype: CharacterData;
  [Symbol.hasInstance](value: unknown): value is CharacterData;
}

export interface DocumentType extends Node {
  readonly name: string;
  readonly publicId: string;
  readonly systemId: string;
  remove(): void;
}

export interface DocumentTypeConstructor {
  readonly prototype: DocumentType;
  [Symbol.hasInstance](value: unknown): value is DocumentType;
}

export interface Text extends CharacterData {

}

export interface TextConstructor {
  readonly prototype: Text;
  [Symbol.hasInstance](value: unknown): value is Text;
  new (data?: string): Text;
}

export interface Comment extends CharacterData {

}

export interface CommentConstructor {
  readonly prototype: Comment;
  [Symbol.hasInstance](value: unknown): value is Comment;
  new (data?: string): Comment;
}

export interface DocumentFragment extends Node {
  readonly children: HTMLCollection;
  readonly firstElementChild: (Element | null);
  readonly lastElementChild: (Element | null);
  readonly childElementCount: number;
}

export interface DocumentFragmentConstructor {
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
  readonly customElementRegistry: (CustomElementRegistry | null);
  readonly styleSheets: object;
  adoptedStyleSheets: any;
}

export interface ShadowRootConstructor {
  readonly prototype: ShadowRoot;
  [Symbol.hasInstance](value: unknown): value is ShadowRoot;
}

export interface Document extends Node {
  readonly URL: string;
  readonly documentURI: string;
  readonly characterSet: string;
  readonly charset: string;
  readonly inputEncoding: string;
  readonly doctype: (DocumentType | null);
  readonly documentElement: (Element | null);
  readonly contentType: string;
  readonly compatMode: string;
  getElementsByClassName(classNames: string): HTMLCollection;
  getElementsByTagName(qualifiedName: string): HTMLCollection;
  getElementsByTagNameNS(namespace: (string | null), localName: string): HTMLCollection;
  createElement(localName: string, options?: (string | ElementCreationOptions)): Element;
  createElementNS(namespace: (string | null), qualifiedName: string, options?: (string | ElementCreationOptions)): Element;
  createTextNode(data: string): Text;
  createComment(data: string): Comment;
  createAttribute(localName: string): Attr;
  getElementById(elementId: string): (Element | null);
  readonly head: (HTMLHeadElement | null);
  readonly body: (HTMLElement | null);
  write(...text: Array<string>): void;
  readonly defaultView: (WindowProxy | null);
  readonly children: HTMLCollection;
  readonly firstElementChild: (Element | null);
  readonly lastElementChild: (Element | null);
  readonly childElementCount: number;
  readonly customElementRegistry: (CustomElementRegistry | null);
  readonly styleSheets: object;
  adoptedStyleSheets: any;
}

export interface DocumentConstructor {
  readonly prototype: Document;
  [Symbol.hasInstance](value: unknown): value is Document;
  new (): Document;
}

export interface Element extends Node {
  readonly namespaceURI: (string | null);
  readonly localName: string;
  readonly attributes: NamedNodeMap;
  getAttribute(qualifiedName: string): (string | null);
  getAttributeNS(namespace: (string | null), localName: string): (string | null);
  getElementsByClassName(classNames: string): HTMLCollection;
  getElementsByTagName(qualifiedName: string): HTMLCollection;
  getElementsByTagNameNS(namespace: (string | null), localName: string): HTMLCollection;
  hasAttribute(qualifiedName: string): boolean;
  hasAttributeNS(namespace: (string | null), localName: string): boolean;
  setAttribute(qualifiedName: string, value: string): void;
  removeAttribute(qualifiedName: string): void;
  readonly children: HTMLCollection;
  readonly firstElementChild: (Element | null);
  readonly lastElementChild: (Element | null);
  readonly childElementCount: number;
  remove(): void;
  readonly previousElementSibling: (Element | null);
  readonly nextElementSibling: (Element | null);
}

export interface ElementConstructor {
  readonly prototype: Element;
  [Symbol.hasInstance](value: unknown): value is Element;
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
  getReader(options?: ReadableStreamGetReaderOptions): (ReadableStreamDefaultReader | ReadableStreamBYOBReader);
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
  from(asyncIterable: (AsyncIterable<any> | Iterable<any>)): ReadableStream;
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
  read(view: (Int8Array<ArrayBuffer> | Int16Array<ArrayBuffer> | Int32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer> | BigInt64Array<ArrayBuffer> | BigUint64Array<ArrayBuffer> | Float16Array<ArrayBuffer> | Float32Array<ArrayBuffer> | Float64Array<ArrayBuffer> | DataView<ArrayBuffer>), options?: ReadableStreamBYOBReaderReadOptions): Promise<ReadableStreamReadResultResult>;
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
  readonly desiredSize: (number | null);
  close(): void;
  enqueue(chunk?: any): void;
  error(e?: any): void;
}

export interface ReadableStreamDefaultControllerConstructor {
  readonly prototype: ReadableStreamDefaultController;
  [Symbol.hasInstance](value: unknown): value is ReadableStreamDefaultController;
}

export interface ReadableByteStreamController {
  readonly byobRequest: (ReadableStreamBYOBRequest | null);
  readonly desiredSize: (number | null);
  close(): void;
  enqueue(chunk: (Int8Array<ArrayBuffer> | Int16Array<ArrayBuffer> | Int32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer> | BigInt64Array<ArrayBuffer> | BigUint64Array<ArrayBuffer> | Float16Array<ArrayBuffer> | Float32Array<ArrayBuffer> | Float64Array<ArrayBuffer> | DataView<ArrayBuffer>)): void;
  error(e?: any): void;
}

export interface ReadableByteStreamControllerConstructor {
  readonly prototype: ReadableByteStreamController;
  [Symbol.hasInstance](value: unknown): value is ReadableByteStreamController;
}

export interface ReadableStreamBYOBRequest {
  readonly view: (Uint8Array<ArrayBuffer> | null);
  respond(bytesWritten: number): void;
  respondWithNewView(view: (Int8Array<ArrayBuffer> | Int16Array<ArrayBuffer> | Int32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer> | BigInt64Array<ArrayBuffer> | BigUint64Array<ArrayBuffer> | Float16Array<ArrayBuffer> | Float32Array<ArrayBuffer> | Float64Array<ArrayBuffer> | DataView<ArrayBuffer>)): void;
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
  readonly desiredSize: (number | null);
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
  readonly desiredSize: (number | null);
  enqueue(chunk?: any): void;
  error(reason?: any): void;
  terminate(): void;
}

export interface TransformStreamDefaultControllerConstructor {
  readonly prototype: TransformStreamDefaultController;
  [Symbol.hasInstance](value: unknown): value is TransformStreamDefaultController;
}

export interface TextDecoder {
  decode(input?: (ArrayBuffer | SharedArrayBuffer | (Int8Array<ArrayBufferLike> | Int16Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike> | Uint16Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike> | Uint8ClampedArray<ArrayBufferLike> | BigInt64Array<ArrayBufferLike> | BigUint64Array<ArrayBufferLike> | Float16Array<ArrayBufferLike> | Float32Array<ArrayBufferLike> | Float64Array<ArrayBufferLike> | DataView<ArrayBufferLike>)), options?: TextDecodeOptions): string;
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
  new (blobParts?: Iterable<(((Int8Array<ArrayBuffer> | Int16Array<ArrayBuffer> | Int32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer> | BigInt64Array<ArrayBuffer> | BigUint64Array<ArrayBuffer> | Float16Array<ArrayBuffer> | Float32Array<ArrayBuffer> | Float64Array<ArrayBuffer> | DataView<ArrayBuffer>) | ArrayBuffer) | Blob | string)>, options?: BlobPropertyBag): Blob;
}

export interface File extends Blob {
  readonly name: string;
  readonly lastModified: number;
}

export interface FileConstructor {
  readonly prototype: File;
  [Symbol.hasInstance](value: unknown): value is File;
  new (fileBits: Iterable<(((Int8Array<ArrayBuffer> | Int16Array<ArrayBuffer> | Int32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer> | BigInt64Array<ArrayBuffer> | BigUint64Array<ArrayBuffer> | Float16Array<ArrayBuffer> | Float32Array<ArrayBuffer> | Float64Array<ArrayBuffer> | DataView<ArrayBuffer>) | ArrayBuffer) | Blob | string)>, fileName: string, options?: FilePropertyBag): File;
}

export interface FileList {
  item(index: number): (File | null);
  readonly length: number;
  readonly [index: number]: (File | null) | undefined;
  [Symbol.iterator](): IterableIterator<(File | null)>;
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
  readonly result: ((string | ArrayBuffer) | null);
  readonly error: (DOMException | null);
  onloadstart: (EventHandlerNonNull | null);
  onprogress: (EventHandlerNonNull | null);
  onload: (EventHandlerNonNull | null);
  onabort: (EventHandlerNonNull | null);
  onerror: (EventHandlerNonNull | null);
  onloadend: (EventHandlerNonNull | null);
}

export interface FileReaderConstructor {
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
  get(name: string): ((File | string) | null);
  getAll(name: string): Array<(File | string)>;
  has(name: string): boolean;
  set(name: string, value: string): void;
  set(name: string, blobValue: Blob, filename?: string): void;
  [Symbol.iterator](): IterableIterator<[string, (File | string)]>;
  values(): IterableIterator<(File | string)>;
  keys(): IterableIterator<string>;
  entries(): IterableIterator<[string, (File | string)]>;
  forEach(callback: (value: (File | string), key: string, parent: this) => void, thisArg?: unknown): void;
}

export interface FormDataConstructor {
  readonly prototype: FormData;
  [Symbol.hasInstance](value: unknown): value is FormData;
  new (form?: HTMLFormElement, submitter?: (HTMLElement | null)): FormData;
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
  parse(url: string, base?: string): (URL | null);
  canParse(url: string, base?: string): boolean;
  createObjectURL(obj: Blob): string;
  revokeObjectURL(url: string): void;
}

export interface URLSearchParams {
  readonly size: number;
  append(name: string, value: string): void;
  delete(name: string, value?: string): void;
  get(name: string): (string | null);
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
  new (init?: (Iterable<Iterable<string>> | Record<string, string> | string)): URLSearchParams;
}

export interface Headers {
  append(name: string, value: string): void;
  delete(name: string): void;
  get(name: string): (string | null);
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
  new (init?: (Iterable<Iterable<string>> | Record<string, string>)): Headers;
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
  readonly body: (ReadableStream | null);
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
  new (input: (Request | string), init?: RequestInit): Request;
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
  readonly body: (ReadableStream | null);
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
  new (body?: ((ReadableStream | (Blob | ((Int8Array<ArrayBuffer> | Int16Array<ArrayBuffer> | Int32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer> | BigInt64Array<ArrayBuffer> | BigUint64Array<ArrayBuffer> | Float16Array<ArrayBuffer> | Float32Array<ArrayBuffer> | Float64Array<ArrayBuffer> | DataView<ArrayBuffer>) | ArrayBuffer) | FormData | URLSearchParams | string)) | null), init?: ResponseInit): Response;
  error(): Response;
  redirect(url: string, status?: number): Response;
  json(data: any, init?: ResponseInit): Response;
}

export interface ReadableStreamReadResultResult {
  done?: boolean;
  value?: any;
}

export interface TextEncoderEncodeIntoResultResult {
  read?: number;
  written?: number;
}
