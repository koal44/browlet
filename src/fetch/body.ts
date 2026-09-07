import type { BlobImpl } from '../file/index';
import {
  isReadableStreamDisturbed, isReadableStreamLocked, type ReadableStreamImpl,
} from '../streams/index';
import type { URLSearchParamsImpl } from '../url/api';
import {
  defineInterfaceMixin, defineTypedef, idlType, invokeWith, nullable, op,
  promise, reference, roAttr, union, xattr,
} from '../web-idl/declaration/index';
import { bindingContext, type BindingContext } from '../web-idl/projection';
import type { FormDataImpl } from '../xhr/index';
import type { RequestRecord } from './request';
import type { ResponseRecord } from './response';

/** Fetch §2.2.4: a stream and the source/length retained for replay. */
export class BodyRecord {
  stream: ReadableStreamImpl;
  source: Uint8Array | BlobImpl | FormDataImpl | null = null;
  length: number | null = null;

  constructor(stream: ReadableStreamImpl) {
    this.stream = stream;
  }

  clone(): BodyRecord {
    throw new Error('Fetch body cloning is not implemented');
  }
}

export type BodyWithType = { body: BodyRecord; type: string | null; };

/*
 * typedef (Blob or BufferSource or FormData or URLSearchParams or USVString) XMLHttpRequestBodyInit;
 *
 * typedef (ReadableStream or XMLHttpRequestBodyInit) BodyInit;
 *
 * interface mixin Body {
 *   readonly attribute ReadableStream? body;
 *   readonly attribute boolean bodyUsed;
 *   [NewObject] Promise<ArrayBuffer> arrayBuffer();
 *   [NewObject] Promise<Blob> blob();
 *   [NewObject] Promise<Uint8Array> bytes();
 *   [NewObject] Promise<FormData> formData();
 *   [NewObject] Promise<any> json();
 *   [NewObject] Promise<USVString> text();
 *   [NewObject] ReadableStream textStream();
 * };
 */
export class BodyMixin {
  readonly #record: RequestRecord | ResponseRecord;

  // Read the includer's current body and headers, including replacements.
  constructor(record: RequestRecord | ResponseRecord) {
    this.#record = record;
  }

  get body(): ReadableStreamImpl | null {
    return this.#bodyRecord()?.stream ?? null;
  }

  get bodyUsed(): boolean {
    const body = this.#bodyRecord();
    return body !== null && isReadableStreamDisturbed(body.stream);
  }

  get unusable(): boolean {
    const body = this.#bodyRecord();
    return body !== null && (isReadableStreamDisturbed(body.stream) || isReadableStreamLocked(body.stream));
  }

  // Promise-valued operations return Web IDL promise records, as Blob does.
  arrayBuffer(_context: BindingContext): object {
    throw new Error('Body.arrayBuffer is not implemented');
  }

  blob(_context: BindingContext): object {
    throw new Error('Body.blob is not implemented');
  }

  bytes(_context: BindingContext): object {
    throw new Error('Body.bytes is not implemented');
  }

  formData(_context: BindingContext): object {
    throw new Error('Body.formData is not implemented');
  }

  json(_context: BindingContext): object {
    throw new Error('Body.json is not implemented');
  }

  text(_context: BindingContext): object {
    throw new Error('Body.text is not implemented');
  }

  textStream(_context: BindingContext): ReadableStreamImpl {
    throw new Error('Body.textStream is not implemented');
  }

  #bodyRecord(): BodyRecord | null {
    const body = this.#record.body;
    if (body !== null && !(body instanceof BodyRecord)) {
      throw new Error('Fetch request body bytes must be extracted before API use');
    }
    return body;
  }
}

/** Post-conversion BufferSource objects are retained by Web IDL. */
export type XMLHttpRequestBodyInitValue = BlobImpl | FormDataImpl | URLSearchParamsImpl |
  ArrayBuffer | ArrayBufferView | string;
export type BodyInitValue = ReadableStreamImpl | XMLHttpRequestBodyInitValue;

export const xmlHttpRequestBodyInitIDL = defineTypedef({
  name: 'XMLHttpRequestBodyInit',
  type: union(reference('Blob'), reference('BufferSource'), reference('FormData'),
    reference('URLSearchParams'), idlType.USVString),
});

export const bodyInitIDL = defineTypedef({
  name: 'BodyInit',
  type: union(reference('ReadableStream'), reference('XMLHttpRequestBodyInit')),
});

export const bodyIDL = defineInterfaceMixin({
  name: 'Body',
  members: [
    roAttr('body', nullable(reference('ReadableStream'))),
    roAttr('bodyUsed', idlType.boolean),
    op('arrayBuffer', promise(idlType.ArrayBuffer), [], { ...invokeWith(bindingContext), ...xattr('NewObject') }),
    op('blob', promise(reference('Blob')), [], { ...invokeWith(bindingContext), ...xattr('NewObject') }),
    op('bytes', promise(idlType.Uint8Array), [], { ...invokeWith(bindingContext), ...xattr('NewObject') }),
    op('formData', promise(reference('FormData')), [], { ...invokeWith(bindingContext), ...xattr('NewObject') }),
    op('json', promise(idlType.any), [], { ...invokeWith(bindingContext), ...xattr('NewObject') }),
    op('text', promise(idlType.USVString), [], { ...invokeWith(bindingContext), ...xattr('NewObject') }),
    op('textStream', reference('ReadableStream'), [], { ...invokeWith(bindingContext), ...xattr('NewObject') }),
  ],
});
