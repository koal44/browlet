import type { DOMException, DOMExceptionConstructor } from '../../../../src/web-idl/core/index';

// Native hosts satisfy Core's exception contract without importing JS Engine or Binding.
const constructor: DOMExceptionConstructor = globalThis.DOMException;
const exception: DOMException = new constructor('message', 'AbortError');
exception.name.toUpperCase();
exception.message.toUpperCase();
exception.code.toFixed();

// @ts-expect-error Ordinary Error instances lack the DOMException code.
const ordinaryError: DOMExceptionConstructor = Error;
