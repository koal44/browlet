/** WebDriver BiDi script command bodies, after protocol parameter validation. */
// https://w3c.github.io/webdriver-bidi/#command-script-evaluate
export type EvaluateParameters = {
  expression: string;
  target: ScriptTarget;
  awaitPromise: boolean;
  resultOwnership?: ResultOwnership;
  serializationOptions?: SerializationOptions;
  userActivation?: boolean;
};

// https://w3c.github.io/webdriver-bidi/#command-script-callFunction
export type CallFunctionParameters = Omit<EvaluateParameters, 'expression'> & {
  functionDeclaration: string;
  arguments?: LocalValue[];
  this?: LocalValue;
};

// https://w3c.github.io/webdriver-bidi/#type-script-EvaluateResult
export type EvaluateResult =
  | { type: 'success'; result: RemoteValue; realm: string; }
  | { type: 'exception'; exceptionDetails: ExceptionDetails; realm: string; };

/** Protocol errors currently needed by the script algorithms; command envelopes are separate. */
export type CommandError = { type: 'error'; error: 'invalid argument' | 'no such frame'; message: string; };

/** A subordinate algorithm's success-with-data or protocol error. */
export type StepResult<T> = { type: 'success'; data: T; } | CommandError;

// https://w3c.github.io/webdriver-bidi/#type-script-Target
export type ScriptTarget = { realm: string; } | { context: string; sandbox?: string; };

// https://w3c.github.io/webdriver-bidi/#type-script-ResultOwnership
export type ResultOwnership = 'none' | 'root';

// https://w3c.github.io/webdriver-bidi/#type-script-SerializationOptions
export type SerializationOptions = {
  maxDomDepth?: number | null;
  maxObjectDepth?: number | null;
  includeShadowTree?: 'none' | 'open' | 'all';
};

// https://w3c.github.io/webdriver-bidi/#type-script-ExceptionDetails
export type ExceptionDetails = {
  columnNumber: number;
  exception: RemoteValue;
  lineNumber: number;
  stackTrace: { callFrames: StackFrame[]; };
  text: string;
};

// https://w3c.github.io/webdriver-bidi/#type-script-StackFrame
export type StackFrame = {
  columnNumber: number;
  functionName: string;
  lineNumber: number;
  url: string;
};

// https://w3c.github.io/webdriver-bidi/#type-script-PrimitiveProtocolValue
export type PrimitiveProtocolValue =
  | { type: 'undefined' | 'null'; }
  | { type: 'string'; value: string; }
  | { type: 'number'; value: number | 'NaN' | '-0' | 'Infinity' | '-Infinity'; }
  | { type: 'boolean'; value: boolean; }
  | { type: 'bigint'; value: string; };

// https://w3c.github.io/webdriver-bidi/#type-script-LocalValue
export type LocalValue =
  | RemoteReference
  | PrimitiveProtocolValue
  | { type: 'channel'; value: { channel: string; serializationOptions?: SerializationOptions; ownership?: ResultOwnership; }; }
  | { type: 'array' | 'set'; value: LocalValue[]; }
  | { type: 'map' | 'object'; value: [LocalValue | string, LocalValue][]; }
  | DateValue | RegExpValue;

type RemoteReference = { handle: string; sharedId?: string; } | { sharedId: string; handle?: string; };
type DateValue = { type: 'date'; value: string; };
type RegExpValue = { type: 'regexp'; value: { pattern: string; flags?: string; }; };

// https://w3c.github.io/webdriver-bidi/#type-script-RemoteValue
export type RemoteValue = PrimitiveProtocolValue | (RemoteIdentity & (
  | { type: 'symbol' | 'function' | 'weakmap' | 'weakset' | 'generator' | 'error' | 'proxy' | 'promise' | 'typedarray' | 'arraybuffer'; }
  | { type: 'array' | 'set' | 'nodelist' | 'htmlcollection'; value?: RemoteValue[]; }
  | { type: 'object' | 'map'; value?: [RemoteValue | string, RemoteValue][]; }
  | DateValue | RegExpValue | NodeRemoteValue
  | { type: 'window'; value: { context: string; }; }
));

type RemoteIdentity = { handle?: string; internalId?: string; };
type NodeRemoteValue = RemoteIdentity & {
  type: 'node';
  sharedId?: string;
  value?: {
    nodeType: number;
    childNodeCount: number;
    attributes?: Record<string, string>;
    children?: NodeRemoteValue[];
    localName?: string;
    mode?: 'open' | 'closed';
    namespaceURI?: string;
    nodeValue?: string;
    shadowRoot?: NodeRemoteValue | null;
  };
};
