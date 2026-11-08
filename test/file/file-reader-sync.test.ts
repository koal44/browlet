import { describe, expect, it, vi } from 'vitest';

import {
  BlobData, BlobImpl, BlobReadFailure, FileImpl, FileReaderSyncImpl,
  type BlobReadFailureReason,
} from '../../src/file/index';
import { InternalError } from '../../src/infra/internal-error';
import { DOMExceptionImpl } from '../../src/web-idl/core/index';
import { createEnvironment } from '../support/environment';

describe('File API §6.5: FileReaderSync', () => {
  it('reads composed and sliced Blob/File bytes without exposing their backing', () => {
    const env = createEnvironment();
    const reader = new FileReaderSyncImpl(env);
    const input = Uint8Array.of(0, 65, 255);
    const blob = new BlobImpl(['prefix', input, 'suffix'], {}, env).slice(6, 9, 'text/custom');
    input.fill(0);
    const file = new FileImpl([blob, '!'], 'payload.bin', {}, env);
    const first = reader.readAsArrayBuffer(blob);
    expect([...new Uint8Array(first)]).toEqual([0, 65, 255]);
    new Uint8Array(first).fill(7);
    expect([...new Uint8Array(reader.readAsArrayBuffer(blob))]).toEqual([0, 65, 255]);
    expect(reader.readAsBinaryString(file)).toBe('\0A\xff!');
    expect(reader.readAsDataURL(blob)).toBe('data:text/custom;base64,AEH/');
    expect(reader.readAsText(new BlobImpl(['hello'], {}, env))).toBe('hello');
  });

  it('returns an empty result in every format', () => {
    const env = createEnvironment();
    const reader = new FileReaderSyncImpl(env);
    const blob = new BlobImpl([], {}, env);
    expect(reader.readAsArrayBuffer(blob).byteLength).toBe(0);
    expect(reader.readAsBinaryString(blob)).toBe('');
    expect(reader.readAsText(blob)).toBe('');
    expect(reader.readAsDataURL(blob)).toBe('data:application/octet-stream;base64,');
  });

  it.each([
    { bytes: [0xe9], type: 'text/plain;charset=windows-1252', label: undefined, result: 'é' },
    { bytes: [0xe9], type: 'text/plain;charset=windows-1252', label: 'invalid', result: 'é' },
    { bytes: [0xe9], type: 'text/plain;charset=utf-8', label: 'windows-1252', result: 'é' },
    { bytes: [0xc3, 0xa9], type: '', label: undefined, result: 'é' },
    { bytes: [0xff, 0xfe, 0x41, 0], type: '', label: 'windows-1252', result: 'A' },
    { bytes: [0xff], type: '', label: undefined, result: '\ufffd' },
  ])('decodes $bytes with label $label and MIME $type', ({ bytes, type, label, result }) => {
    const env = createEnvironment();
    const blob = new BlobImpl([Uint8Array.from(bytes)], { type }, env);
    expect(new FileReaderSyncImpl(env).readAsText(blob, label)).toBe(result);
  });

  it('reads the retained host range synchronously without starting asynchronous I/O', () => {
    const env = createEnvironment();
    const read = vi.fn(() => Promise.resolve(Uint8Array.of(1)));
    const readSync = vi.fn((start: number, length: number) => Uint8Array.of(65, 66, 67, 68).slice(start, start + length));
    const data = BlobData.fromSource({ size: 4, snapshotState: 'captured', read, readSync });
    const blob = BlobImpl.create(data, '', 'captured', env).slice(1, 3);
    expect(new FileReaderSyncImpl(env).readAsText(blob)).toBe('BC');
    expect(readSync).toHaveBeenCalledExactlyOnceWith(1, 2);
    expect(read).not.toHaveBeenCalled();
  });

  it.each<{ reason: BlobReadFailureReason; name: string; }>([
    { reason: 'NotFound', name: 'NotFoundError' },
    { reason: 'UnsafeFile', name: 'SecurityError' },
    { reason: 'TooManyReads', name: 'SecurityError' },
    { reason: 'SnapshotState', name: 'NotReadableError' },
    { reason: 'FileLock', name: 'NotReadableError' },
  ])('maps the $reason source failure to $name', ({ reason, name }) => {
    const env = createEnvironment();
    const failure = new BlobReadFailure(reason, 'source failed');
    const data = BlobData.fromSource({
      size: 1, snapshotState: undefined,
      read: () => Promise.reject(failure),
      readSync() { throw failure; },
    });
    const reader = new FileReaderSyncImpl(env);
    const blob = BlobImpl.create(data, '', undefined, env);
    expect(() => reader.readAsText(blob)).toThrow(DOMExceptionImpl);
    expect(() => reader.readAsText(blob)).toThrow(expect.objectContaining({ name, message: 'source failed' }));
  });

  it('rejects an async-only host source instead of trying to pump its Promise', () => {
    const env = createEnvironment();
    const read = vi.fn(() => Promise.resolve(Uint8Array.of(65)));
    const data = BlobData.fromSource({ size: 1, snapshotState: undefined, read });
    const blob = BlobImpl.create(data, '', undefined, env);
    expect(() => new FileReaderSyncImpl(env).readAsText(blob)).toThrow('does not support synchronous reads');
    expect(read).not.toHaveBeenCalled();
  });

  it('preserves internal failures and rejects incomplete source reads', () => {
    const env = createEnvironment();
    const failure = new InternalError('broken source');
    const source = {
      size: 1, snapshotState: undefined,
      read: () => Promise.reject(failure),
      readSync(): Uint8Array { throw failure; },
    };
    const blob = BlobImpl.create(BlobData.fromSource(source), '', undefined, env);
    const reader = new FileReaderSyncImpl(env);
    expect(() => reader.readAsText(blob)).toThrow(failure);
    source.readSync = () => new Uint8Array();
    expect(() => reader.readAsText(blob)).toThrow('complete requested range');
  });
});
