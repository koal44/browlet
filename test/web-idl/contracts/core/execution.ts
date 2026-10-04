import type { DOMException, DOMExceptionConstructor, WebIDLExecution } from '../../../../src/web-idl/core/index';

// Native hosts satisfy Core's exception contract without importing JS Engine or Binding.
const constructor: DOMExceptionConstructor = globalThis.DOMException;
const exec: WebIDLExecution = { DOMException: constructor };
const exception: DOMException = new exec.DOMException('message', 'AbortError');
exception.name.toUpperCase();
exception.message.toUpperCase();
exception.code.toFixed();

// @ts-expect-error Execution must explicitly supply the exception constructor.
const missingConstructor: WebIDLExecution = {};
// @ts-expect-error Ordinary Error instances lack the DOMException code.
const ordinaryError: DOMExceptionConstructor = Error;
