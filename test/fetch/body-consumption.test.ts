import { describe, expect, it } from 'vitest';

import { utf8Encode } from '../../src/encoding/codecs/utf-8';
import { BodyMixin, FetchBody } from '../../src/fetch/body';
import { RequestImpl } from '../../src/fetch/request';
import { FetchResponse, ResponseImpl } from '../../src/fetch/response';
import { BlobImpl } from '../../src/file/index';
import { getBufferSourceCopy } from '../../src/js-engine/index';
import { FormDataImpl } from '../../src/xhr/index';
import { createFetchFixture, createFetchRequest } from './fetch-fixture';

describe('Body mixin state', () => {
  it('reads replacement bodies and stream state through the same mixin', () => {
    const fixture = createFetchFixture();
    const record = new FetchResponse();
    const response = fixture.createResponse(record);
    const mixin = new BodyMixin(record, fixture.env);
    const first = fixture.createBody();
    expect(first.source).toBeNull();
    expect(first.length).toBeNull();
    record.body = first;
    expect(response.body).toBe(first.stream);
    const reader = first.stream.getDefaultReader();
    expect(mixin.unusable).toBe(true);
    expect(response.bodyUsed).toBe(false);
    reader.readChunk({ chunkSteps() {}, closeSteps() {}, errorSteps() {} });
    expect(response.bodyUsed).toBe(true);
    reader.release(fixture.env);
    const second = fixture.createBody();
    record.body = second;
    expect(response.body).toBe(second.stream);
    expect(response.bodyUsed).toBe(false);
    expect(mixin.unusable).toBe(false);
    record.body = null;
    expect(response.body).toBeNull();
  });
});

describe.each(['Request', 'Response'] as const)('%s Body consumption', (kind) => {
  it('reads UTF-8 text once and marks the body used immediately', async () => {
    const fixture = createFetchFixture();
    const body = FetchBody.fromBytes(Uint8Array.of(0xef, 0xbb, 0xbf, 0xc3, 0xa9, 0xff), fixture.env);
    const api = projectBody(fixture, kind, body);
    expect(api.bodyUsed).toBe(false);
    const result = api.text();
    expect(result).toBeInstanceOf(fixture.realm.intrinsics.promise.constructor);
    expect(api.bodyUsed).toBe(true);
    expect(await result).toBe('é\ufffd');
    await expect(api.text()).rejects.toBeInstanceOf(fixture.realm.intrinsics.typeError);
  });

  it('returns fresh empty results for a null body without marking it used', async () => {
    const fixture = createFetchFixture();
    const api = projectBody(fixture, kind, null);
    expect(api.body).toBeNull();
    expect(await api.text()).toBe('');
    const first = api.bytes();
    const second = api.bytes();
    expect(first).not.toBe(second);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toHaveLength(0);
    expect(a).not.toBe(b);
    expect((await api.arrayBuffer()).byteLength).toBe(0);
    expect((await api.blob()).size).toBe(0);
    await expect(api.json()).rejects.toBeInstanceOf(fixture.realm.intrinsics.syntaxError);
    await expect(api.formData()).rejects.toBeInstanceOf(fixture.realm.intrinsics.typeError);
    expect(api.bodyUsed).toBe(false);
  });

  it.each(['arrayBuffer', 'bytes'] as const)('allocates %s in the receiver realm', async (method) => {
    const fixture = createFetchFixture();
    const other = createFetchFixture(fixture.bindings);
    const source = Uint8Array.of(1, 2, 3);
    const api = projectBody(fixture, kind, FetchBody.fromBytes(source, fixture.env));
    const foreign = projectBody(other, kind, null);
    const result = method === 'arrayBuffer' ? foreign.arrayBuffer.call(api) : foreign.bytes.call(api);
    expect(result).toBeInstanceOf(fixture.realm.intrinsics.promise.constructor);
    const value = await result;
    const constructor = method === 'arrayBuffer'
      ? fixture.realm.intrinsics.bufferSource.arrayBuffer
      : fixture.realm.intrinsics.bufferSource.views.Uint8Array!;
    expect(value).toBeInstanceOf(constructor);
    expect(getBufferSourceCopy(value)).toEqual(source);
    new Uint8Array(method === 'arrayBuffer' ? value as ArrayBuffer : (value as Uint8Array).buffer)[0] = 99;
    expect(source).toEqual(Uint8Array.of(1, 2, 3));
  });

  it('creates a Blob with the current parsed MIME type', async () => {
    const fixture = createFetchFixture();
    const api = projectBody(fixture, kind, FetchBody.fromBytes(Uint8Array.of(1, 2), fixture.env),
      'TEXT/PLAIN; charset=utf-8');
    const result = await api.blob();
    expect(fixture.bindings.getRealm(result)).toBe(fixture.realm);
    expect(result.type).toBe('text/plain;charset=utf-8');
    expect(result.size).toBe(2);
    expect(await result.arrayBuffer()).toBeInstanceOf(fixture.realm.intrinsics.bufferSource.arrayBuffer);
  });

  it('parses JSON with captured receiver-realm intrinsics, including nested values', async () => {
    const fixture = createFetchFixture();
    const other = createFetchFixture(fixture.bindings);
    const api = projectBody(fixture, kind,
      FetchBody.fromBytes(utf8Encode('\ufeff{"items":[{"answer":42}]}'), fixture.env));
    const foreign = projectBody(other, kind, null);
    const json = Reflect.get(fixture.realm.global, 'JSON') as object;
    Reflect.set(json, 'parse', () => { throw new Error('Author replacement must not run'); });
    const value = await foreign.json.call(api) as { items: { answer: number; }[]; };
    expect(value).toEqual({ items: [{ answer: 42 }] });
    expect(Object.getPrototypeOf(value)).toBe(fixture.realm.intrinsics.objectPrototype);
    expect(value.items).toBeInstanceOf(fixture.realm.intrinsics.array);
    expect(Object.getPrototypeOf(value.items[0])).toBe(fixture.realm.intrinsics.objectPrototype);
  });

  it('rejects malformed JSON with a receiver-realm SyntaxError', async () => {
    const fixture = createFetchFixture();
    const api = projectBody(fixture, kind, FetchBody.fromBytes(utf8Encode('{'), fixture.env));
    await expect(api.json()).rejects.toBeInstanceOf(fixture.realm.intrinsics.syntaxError);
    expect(api.bodyUsed).toBe(true);
  });

  it('parses URL-encoded fields and retains duplicate names', async () => {
    const fixture = createFetchFixture();
    const api = projectBody(fixture, kind,
      FetchBody.fromBytes(utf8Encode('a=one+two&a=%E2%82%AC&empty=&bad=%FF'), fixture.env),
      'application/x-www-form-urlencoded;charset=windows-1252');
    const form = await api.formData();
    expect(fixture.bindings.getRealm(form)).toBe(fixture.realm);
    expect([...form]).toEqual([['a', 'one two'], ['a', '€'], ['empty', ''], ['bad', '\ufffd']]);
    expect(form.getAll('a')).toEqual(['one two', '€']);
    form.append('later', 'still mutable');
    expect(form.get('later')).toBe('still mutable');
  });

  it.each([null, 'text/plain', 'multipart/form-data'])('rejects formData for Content-Type %j after consuming', async (type) => {
    const fixture = createFetchFixture();
    const api = projectBody(fixture, kind, FetchBody.fromBytes(utf8Encode('data'), fixture.env), type);
    await expect(api.formData()).rejects.toBeInstanceOf(fixture.realm.intrinsics.typeError);
    expect(api.bodyUsed).toBe(true);
  });

  it('checks the current MIME type when reading completes', async () => {
    const fixture = createFetchFixture();
    const body = fixture.createBody();
    const api = projectBody(fixture, kind, body, 'text/plain');
    const result = api.formData();
    api.headers.set('Content-Type', 'application/x-www-form-urlencoded');
    body.stream.enqueueChunk(utf8Encode('a=b'));
    body.stream.close();
    expect([...(await result)]).toEqual([['a', 'b']]);
  });

  it('returns distinct empty FormData objects for a null URL-encoded body', async () => {
    const fixture = createFetchFixture();
    const api = projectBody(fixture, kind, null, 'application/x-www-form-urlencoded');
    const first = await api.formData();
    const second = await api.formData();
    expect(first).not.toBe(second);
    expect([...first]).toEqual([]);
    expect(api.bodyUsed).toBe(false);
  });

  it.each(['arrayBuffer', 'blob', 'bytes', 'formData', 'json', 'text'] as const)('rejects %s for a locked body without disturbing it', async (method) => {
    const fixture = createFetchFixture();
    const body = fixture.createBody();
    const reader = body.stream.getDefaultReader();
    const api = projectBody(fixture, kind, body);
    await expect(api[method]()).rejects.toBeInstanceOf(fixture.realm.intrinsics.typeError);
    expect(api.bodyUsed).toBe(false);
    reader.release(fixture.env);
    body.stream.close();
    expect(await api.text()).toBe('');
  });

  it('preserves an author stream rejection without changing its identity', async () => {
    const fixture = createFetchFixture();
    const body = fixture.createBody();
    const failure = { reason: 'author failure' };
    body.stream.error(failure);
    const api = projectBody(fixture, kind, body);
    await expect(api.text()).rejects.toBe(failure);
  });

  it('rejects a non-byte chunk in the consuming realm', async () => {
    const fixture = createFetchFixture();
    const body = fixture.createBody();
    body.stream.enqueueChunk('not bytes');
    const api = projectBody(fixture, kind, body);
    await expect(api.text()).rejects.toBeInstanceOf(fixture.realm.intrinsics.typeError);
  });

  it('decodes a text stream incrementally across split UTF-8 and BOM bytes', async () => {
    const fixture = createFetchFixture();
    const body = fixture.createBody();
    const api = projectBody(fixture, kind, body);
    const text = api.textStream();
    expect(fixture.bindings.getRealm(text)).toBe(fixture.realm);
    expect(body.stream.locked).toBe(true);
    const reader = text.getReader();
    const first = reader.read();
    body.stream.enqueueChunk(Uint8Array.of(0xef));
    body.stream.enqueueChunk(Uint8Array.of(0xbb, 0xbf, 0xe2));
    body.stream.enqueueChunk(Uint8Array.of(0x82, 0xac));
    expect(await first).toEqual({ value: '€', done: false });
    body.stream.enqueueChunk(Uint8Array.of(0xc3));
    body.stream.close();
    expect(await reader.read()).toEqual({ value: '\ufffd', done: false });
    expect(await reader.read()).toEqual({ value: undefined, done: true });
    await expect(api.text()).rejects.toBeInstanceOf(fixture.realm.intrinsics.typeError);
  });

  it('returns a closed default text stream for a null body', async () => {
    const fixture = createFetchFixture();
    const api = projectBody(fixture, kind, null);
    const stream = api.textStream();
    expect(fixture.bindings.getRealm(stream)).toBe(fixture.realm);
    expect(await stream.getReader().read()).toEqual({ value: undefined, done: true });
    expect(api.bodyUsed).toBe(false);
  });

  it('propagates cancellation from the text stream to the original body', async () => {
    const fixture = createFetchFixture();
    const body = fixture.createBody();
    const api = projectBody(fixture, kind, body);
    await api.textStream().cancel('finished');
    expect(body.stream.isClosed).toBe(true);
    expect(body.stream.disturbed).toBe(true);
    expect(api.bodyUsed).toBe(true);
  });

  it('preserves the original error through textStream decoding', async () => {
    const fixture = createFetchFixture();
    const body = fixture.createBody();
    const api = projectBody(fixture, kind, body);
    const reader = api.textStream().getReader();
    const reading = reader.read();
    const error = { failure: 'source' };
    body.stream.error(error);
    await expect(reading).rejects.toBe(error);
  });

  it('throws synchronously when textStream encounters a locked body', () => {
    const fixture = createFetchFixture();
    const body = fixture.createBody();
    body.stream.getDefaultReader();
    const api = projectBody(fixture, kind, body);
    expect(() => api.textStream()).toThrow(fixture.realm.intrinsics.typeError);
  });
});

describe.each(['Request', 'Response'] as const)('%s multipart consumption', (kind) => {
  it.each(['get', 'getAll', 'iteration'] as const)('keeps the producing realm when a File is first exposed by borrowed %s', async (method) => {
    const fixture = createFetchFixture();
    const other = createFetchFixture(fixture.bindings);
    const api = projectBody(fixture, kind, FetchBody.fromBytes(multipart, fixture.env), 'multipart/form-data; boundary=boundary');
    const form = await projectBody(other, kind, null).formData.call(api);
    expect(fixture.bindings.getRealm(form)).toBe(fixture.realm);
    const foreign = other.context.project(FormDataImpl, other.context.construct(FormDataImpl)) as unknown as FormData;
    const first = method === 'get' ? foreign.get.call(form, 'file') : method === 'getAll'
      ? foreign.getAll.call(form, 'file')[0] : [...foreign.entries.call(form)][1]![1];
    expect(first).toBe(form.get('file'));
    expect(first).toBe(form.getAll('file')[0]);
    expect(first).toBe([...form][1]![1]);
    const file = first as File;
    expect(fixture.bindings.getRealm(file)).toBe(fixture.realm);
    expect(file.name).toBe('data.txt');
    expect(file.type).toBe('text/plain');
    expect(await file.text()).toBe('file contents');
    expect(form.get('text')).toBe('\ufefftext');
    // New entries still use HTML's create-an-entry capability and the same runtime.
    const blob = fixture.context.project(BlobImpl, new BlobImpl(['new'], {}, fixture.env)) as unknown as Blob;
    form.append('added', blob, 'added.txt');
    expect((form.get('added') as File).name).toBe('added.txt');
    expect(fixture.bindings.getRealm(form.get('added') as File)).toBe(fixture.realm);
  });

  it('rejects malformed multipart data in the consuming realm', async () => {
    const fixture = createFetchFixture();
    const api = projectBody(fixture, kind,
      FetchBody.fromBytes(utf8Encode('--boundary\r\n'), fixture.env), 'multipart/form-data; boundary=boundary');
    await expect(api.formData()).rejects.toBeInstanceOf(fixture.realm.intrinsics.typeError);
  });
});

type BodyAPI = Body & {
  headers: Headers;
  textStream(): ReadableStream<string>;
};

function projectBody(
  fixture: ReturnType<typeof createFetchFixture>,
  kind: 'Request' | 'Response',
  body: FetchBody | null,
  type: string | null = null,
): BodyAPI {
  const record = kind === 'Request' ? createFetchRequest() : new FetchResponse();
  record.body = body;
  if (type !== null) record.headerList.set('Content-Type', type);
  const platform = kind === 'Request'
    ? fixture.context.project(RequestImpl, fixture.createRequest(
      record as ReturnType<typeof createFetchRequest>, fixture.env.exec.createAbortController().signal,
    ))
    : fixture.context.project(ResponseImpl, fixture.createResponse(record as FetchResponse));
  return platform as unknown as BodyAPI;
}

const multipart = utf8Encode(
  '--boundary\r\nContent-Disposition: form-data; name="text"\r\n\r\n\ufefftext\r\n' +
  '--boundary\r\nContent-Disposition: form-data; name="file"; filename="data.txt"\r\n\r\nfile contents\r\n' +
  '--boundary--\r\n',
);
