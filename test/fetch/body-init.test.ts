import { describe, expect, it, vi } from 'vitest';

import { utf8Decode, utf8Encode } from '../../src/encoding/codecs/utf-8';
import { FetchBody, type BodyInitValue } from '../../src/fetch/body';
import { BlobData, BlobImpl, FileImpl } from '../../src/file/index';
import { toScalarValueString } from '../../src/infra/index';
import { ReadableStreamImpl } from '../../src/streams/index';
import { URLSearchParamsImpl } from '../../src/url/api';
import { reference } from '../../src/web-idl/index';
import { FormDataImpl } from '../../src/xhr/index';
import { observe } from '../browlet/streams/implementation-fixture';
import { readBodyBytes } from './body-fixture';
import { createFetchFixture } from './fetch-fixture';

describe('BodyInit extraction', () => {
  it('UTF-8-encodes a converted string and records its byte length and type', async () => {
    const fixture = createFetchFixture();
    const { body, type } = FetchBody.extract('hello 🌍', false, fixture.env);
    expect(type).toBe('text/plain;charset=UTF-8');
    expect(body.source).toEqual(utf8Encode('hello 🌍'));
    expect(body.length).toBe(10);
    expect(await readBodyBytes(body)).toEqual(body.source);
  });

  it('receives scalar strings and interface implementations through the BodyInit union', async () => {
    const fixture = createFetchFixture();
    const convert = (value: unknown) => fixture.context.jsToImpl(value, reference('BodyInit')) as BodyInitValue;
    expect(convert('\ud800')).toBe('\ufffd');
    const blob = fixture.context.construct(BlobImpl, ['contents']);
    const platform = fixture.context.project(BlobImpl, blob);
    expect(convert(platform)).toBe(blob);
    const { body } = FetchBody.extract(convert(platform), false, fixture.env);
    expect(utf8Decode(await readBodyBytes(body))).toBe('contents');
  });

  it.each(['ArrayBuffer', 'Uint8Array', 'DataView'] as const)('copies an author %s before returning', async (kind) => {
    const fixture = createFetchFixture();
    const bytes = Uint8Array.of(9, 1, 2, 9);
    const input = kind === 'ArrayBuffer' ? bytes.buffer : kind === 'DataView'
      ? new DataView(bytes.buffer, 1, 2) : bytes.subarray(1, 3);
    const expected = kind === 'ArrayBuffer' ? [9, 1, 2, 9] : [1, 2];
    const { body, type } = FetchBody.extract(input, false, fixture.env);
    expect(type).toBeNull();
    expect(body.length).toBe(expected.length);
    bytes.fill(0);
    expect([...await readBodyBytes(body)]).toEqual(expected);
    expect([...(body.source as Uint8Array)]).toEqual(expected);
  });

  it('serializes URLSearchParams immediately while preserving repeated fields', async () => {
    const fixture = createFetchFixture();
    const params = fixture.context.construct(URLSearchParamsImpl, 'a=one+two&a=%E2%82%AC');
    const { body, type } = FetchBody.extract(params, false, fixture.env);
    params.append('later', 'ignored');
    expect(type).toBe('application/x-www-form-urlencoded;charset=UTF-8');
    expect(utf8Decode(await readBodyBytes(body))).toBe('a=one+two&a=%E2%82%AC');
    expect(body.length).toBe(21);
  });

  it.each(['', 'text/plain'])('uses Blob data, length, and its %j type', async (type) => {
    const fixture = createFetchFixture();
    const blob = new BlobImpl(['hello'], { type }, fixture.env);
    const extracted = FetchBody.extract(blob, true, fixture.env);
    expect(extracted.body.source).toBe(blob);
    expect(extracted.body.length).toBe(5);
    expect(extracted.type).toBe(type || null);
    expect(utf8Decode(await readBodyBytes(extracted.body))).toBe('hello');
  });

  it('creates a Blob body stream on the extracting environment instead of the Blob creator', async () => {
    const creator = createFetchFixture();
    const consumer = createFetchFixture();
    const blob = creator.context.construct(BlobImpl, ['retained bytes']);
    const { body } = FetchBody.extract(blob, false, consumer.env);
    expect(body.stream.env === consumer.env).toBe(true);
    expect(body.source).toBe(blob);
    expect(utf8Decode(await readBodyBytes(body))).toBe('retained bytes');
  });

  it('retains an undisturbed stream without a replay source, length, or inferred type', async () => {
    const fixture = createFetchFixture();
    const stream = ReadableStreamImpl.createDefault(undefined, undefined, 1, () => 1, fixture.env);
    const { body, type } = FetchBody.extract(stream, false, fixture.env);
    expect(body.stream).toBe(stream);
    expect(body.source).toBeNull();
    expect(body.length).toBeNull();
    expect(type).toBeNull();
    expect(stream.disturbed).toBe(false);
    expect(stream.locked).toBe(false);
    stream.enqueueChunk(Uint8Array.of(1));
    stream.close();
    expect(await readBodyBytes(body)).toEqual(Uint8Array.of(1));
  });

  it.each(['keepalive', 'locked', 'disturbed'] as const)('rejects a %s stream', async (state) => {
    const fixture = createFetchFixture();
    const stream = ReadableStreamImpl.createDefault(undefined, undefined, 1, () => 1, fixture.env);
    if (state === 'locked') stream.getDefaultReader();
    if (state === 'disturbed') await observe(stream.cancelInternal(undefined));
    expect(() => FetchBody.extract(stream, state === 'keepalive', fixture.env)).toThrow(TypeError);
  });
});

describe('multipart BodyInit extraction', () => {
  it('retains lazy File data and snapshots text entries and file metadata', async () => {
    const fixture = createFetchFixture();
    const read = vi.fn(() => Promise.resolve(Uint8Array.of(1, 2)));
    const file = new FileImpl([], 'data.bin', {}, fixture.env);
    file.setSerializationState({
      data: BlobData.fromSource({ size: 2, snapshotState: undefined, read }),
      type: 'application/octet-stream', snapshotState: undefined,
    });
    const form = fixture.context.construct(FormDataImpl);
    form.append(toScalarValueString('name'), toScalarValueString('Eric'));
    form.append(toScalarValueString('file'), file);
    const { body, type } = FetchBody.extract(form, false, fixture.env);
    expect(read).not.toHaveBeenCalled();
    const boundary = type!.slice('multipart/form-data; boundary='.length);
    const expected = BlobData.concatenate([
      BlobData.fromOwnedBytes(utf8Encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nEric\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="data.bin"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
      )),
      BlobData.fromOwnedBytes(Uint8Array.of(1, 2)),
      BlobData.fromOwnedBytes(utf8Encode(`\r\n--${boundary}--\r\n`)),
    ]);
    expect(body.length).toBe(expected.size);
    expect(form.getEntryList()).toHaveLength(2);
    form.set(toScalarValueString('name'), toScalarValueString('later'));
    form.delete(toScalarValueString('file'));
    expect(await readBodyBytes(body)).toEqual(await expected.read());
    expect(read).toHaveBeenCalledExactlyOnceWith(0, 2);
  });

  it('encodes an empty FormData with a closing delimiter', async () => {
    const fixture = createFetchFixture();
    const form = fixture.context.construct(FormDataImpl);
    const { body, type } = FetchBody.extract(form, false, fixture.env);
    const boundary = type!.slice('multipart/form-data; boundary='.length);
    expect(utf8Decode(await readBodyBytes(body))).toBe(`--${boundary}--\r\n`);
    expect(body.length).toBe(boundary.length + 6);
  });

  it('propagates a retained File read failure through the body stream', async () => {
    const fixture = createFetchFixture();
    const failure = new Error('read failed');
    const file = new FileImpl([], 'failed.bin', {}, fixture.env);
    file.setSerializationState({
      data: BlobData.fromSource({ size: 1, snapshotState: undefined, read: () => Promise.reject(failure) }),
      type: '', snapshotState: undefined,
    });
    const form = fixture.context.construct(FormDataImpl);
    form.append(toScalarValueString('file'), file);
    const { body } = FetchBody.extract(form, false, fixture.env);
    await expect(readBodyBytes(body)).rejects.toBe(failure);
  });
});
