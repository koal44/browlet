import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../src/browlet/browlet';
import {
  browletBindings, getRelevantRealm,
} from '../../src/browlet/bindings';
import {
  FileReaderImpl, fileReaderIDL,
} from '../../src/browlet/integration/file/file-reader';
import {
  EventTargetImpl, fireEvent,
} from '../../src/browlet/dom/events/event-target';
import type { ProgressEventImpl } from '../../src/browlet/dom/events/progress-event';
import {
  BlobData, BlobImpl, BlobReadFailure, type BlobByteSource,
} from '../../src/file/index';
import { getBufferSourceCopy } from '../../src/js-engine/index';
import { serializeDefinition } from '../../src/web-idl/declaration/index';
import type { BindingContext } from '../../src/web-idl/projection';
import { performTestMicrotaskCheckpoint } from './test-runtime';

describe('File API FileReader foundation', () => {
  it('starts empty with no result, error, or event handlers', () => {
    const reader = createReader();

    expect(reader).toBeInstanceOf(EventTargetImpl);
    expect(reader.readyState).toBe(0);
    expect(reader.result).toBeNull();
    expect(reader.error).toBeNull();
    expect([
      reader.onloadstart,
      reader.onprogress,
      reader.onload,
      reader.onabort,
      reader.onerror,
      reader.onloadend,
    ]).toEqual([null, null, null, null, null, null]);
  });

  it('keeps each event-handler attribute independent', () => {
    const reader = createReader();
    const load = vi.fn();
    const progress = vi.fn();

    reader.onload = load;
    reader.onprogress = progress;
    fireEvent('load', reader);

    expect(load).toHaveBeenCalledOnce();
    expect(progress).not.toHaveBeenCalled();
    expect(reader.onload).toBe(load);
    expect(reader.onprogress).toBe(progress);

    reader.onload = null;
    fireEvent('load', reader);
    expect(load).toHaveBeenCalledOnce();
    expect(reader.onload).toBeNull();
    expect(reader.onprogress).toBe(progress);
  });

  it('preserves the complete FileReader declaration for later exposure', () => {
    expect(serializeDefinition(fileReaderIDL)).toBe(`
[Exposed=(Window, Worker)]
interface FileReader : EventTarget {
  constructor();
  undefined readAsArrayBuffer(Blob blob);
  undefined readAsBinaryString(Blob blob);
  undefined readAsText(Blob blob, optional DOMString encoding);
  undefined readAsDataURL(Blob blob);
  undefined abort();
  const unsigned short EMPTY = 0;
  const unsigned short LOADING = 1;
  const unsigned short DONE = 2;
  readonly attribute unsigned short readyState;
  readonly attribute (DOMString or ArrayBuffer)? result;
  readonly attribute DOMException? error;
  attribute EventHandler onloadstart;
  attribute EventHandler onprogress;
  attribute EventHandler onload;
  attribute EventHandler onabort;
  attribute EventHandler onerror;
  attribute EventHandler onloadend;
};`.trim());
  });
});

describe('File API §6.2: FileReader reads', () => {
  it('installs FileReader and reads a projected Blob', async () => {
    const window = createWindow();
    const Blob_ = requireFunction(window, 'Blob');
    const FileReader_ = requireFunction(window, 'FileReader');
    const blob = Reflect.construct(Blob_, [['projected']]) as object;
    const reader = Reflect.construct(FileReader_, []) as object;
    const done = new Promise<void>((resolve, reject) => {
      Reflect.set(reader, 'onerror', () => {
        reject(new Error(String(Reflect.get(reader, 'error'))));
      });
      Reflect.set(reader, 'onloadend', () => { resolve(); });
    });

    call(reader, 'readAsText', [blob]);
    await done;

    expect(reader).toBeInstanceOf(FileReader_);
    expect(Reflect.get(reader, 'readyState')).toBe(2);
    expect(Reflect.get(reader, 'result')).toBe('projected');
  });

  it('keeps the same result buffer when its getter is borrowed from another realm', async () => {
    const first = createWindow();
    const second = createWindow();
    const reader = new first.FileReader();
    const done = new Promise<void>((resolve) => {
      reader.addEventListener('loadend', () => { resolve(); });
    });
    reader.readAsArrayBuffer(new first.Blob(['ABC']));
    await done;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- borrowing the getter with an explicit receiver is the behavior under test
    const getter = Object.getOwnPropertyDescriptor(second.FileReader.prototype, 'result')!.get!;
    const result = Reflect.apply(getter, reader, []) as ArrayBuffer;

    expect(result).toBeInstanceOf(first.ArrayBuffer);
    expect(result).toBe(reader.result);
    expect(Reflect.apply(getter, reader, [])).toBe(result);
    expect(Array.from(new Uint8Array(result))).toEqual([65, 66, 67]);
    new Uint8Array(result)[0] = 90;
    expect(new Uint8Array(reader.result as ArrayBuffer)[0]).toBe(90);
    Reflect.apply(requireFunction(first.ArrayBuffer.prototype, 'transfer'), result, []);
    expect(reader.result).toBe(result);
    expect((Reflect.apply(getter, reader, []) as ArrayBuffer).byteLength).toBe(0);
  });

  it('waits for the foreign Blob delivery queue and retains the FileReader result realm', async () => {
    const source = createWindow();
    const destination = createWindow();
    const queues: (() => void)[][] = [[], []];
    const spies = [source, destination].flatMap((window, index) => {
      const scheduling = getContext(window).getRuntime().fileReading;
      const tasks = queues[index]!;
      return [
        vi.spyOn(scheduling, 'runInParallel').mockImplementation((steps) => { steps(); }),
        vi.spyOn(scheduling, 'queueTask').mockImplementation((steps) => {
          tasks.push(steps);
          return {
            remove() {
              const position = tasks.indexOf(steps);
              if (position !== -1) tasks.splice(position, 1);
            },
          };
        }),
      ];
    });
    const turn = async (): Promise<void> => {
      await new Promise<void>((resolve) => { setImmediate(resolve); });
      performTestMicrotaskCheckpoint(source);
      performTestMicrotaskCheckpoint(destination);
    };
    const drain = async (tasks: (() => void)[]): Promise<void> => {
      while (tasks.length !== 0) {
        tasks.shift()!();
        await turn();
      }
    };
    try {
      const reader = new destination.FileReader();
      const events: string[] = [];
      reader.onloadend = () => { events.push('loadend'); };
      reader.readAsArrayBuffer(new source.Blob(['ABC']));
      await turn();
      await drain(queues[1]!);

      expect(reader.readyState).toBe(reader.LOADING);
      expect(reader.result).toBeNull();
      expect(events).toEqual([]);

      await drain(queues[0]!);
      await drain(queues[1]!);
      expect(reader.readyState).toBe(reader.DONE);
      expect(events).toEqual(['loadend']);
      expect(reader.result).toBeInstanceOf(destination.ArrayBuffer);
      expect(Array.from(new Uint8Array(reader.result as ArrayBuffer))).toEqual([65, 66, 67]);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('reads every result mode and creates ArrayBuffer in the relevant realm', async () => {
    const first = createWindow();
    const second = createWindow();
    const context = getContext(first);
    const blob = new BlobImpl([Uint8Array.of(0, 65, 128, 255)], {
      type: 'application/example',
    }, context.getRuntime());

    const dataURL = await read(context, blob, (reader) => {
      reader.readAsDataURL(blob);
    });
    expect(dataURL.result)
      .toBe('data:application/example;base64,AEGA/w==');

    const binary = await read(context, blob, (reader) => {
      reader.readAsBinaryString(blob);
    });
    expect([...binary.result as string].map((value) => value.charCodeAt(0)))
      .toEqual([0, 65, 128, 255]);

    const arrayBuffer = await read(context, blob, (reader) => {
      reader.readAsArrayBuffer(blob);
    });
    expect(arrayBuffer.result)
      .toBeInstanceOf(requireFunction(first, 'ArrayBuffer'));
    const result = Reflect.get(context.project(FileReaderImpl, arrayBuffer), 'result') as object;
    expect(result).toBe(arrayBuffer.result);
    expect(result)
      .toBeInstanceOf(requireFunction(first, 'ArrayBuffer'));
    expect(result)
      .not.toBeInstanceOf(requireFunction(second, 'ArrayBuffer'));
    expect(getBufferSourceCopy(result))
      .toEqual(Uint8Array.of(0, 65, 128, 255));
  });

  it('uses the interoperable octet-stream Data URL fallback', async () => {
    const context = getContext(createWindow());
    const blob = new BlobImpl(['TEST'], {}, context.getRuntime());
    const reader = await read(context, blob, (value) => {
      value.readAsDataURL(blob);
    });

    expect(reader.result)
      .toBe('data:application/octet-stream;base64,VEVTVA==');
  });

  it('selects an explicit encoding, then MIME charset, then UTF-8', async () => {
    const context = getContext(createWindow());
    const windows1252 = new BlobImpl([Uint8Array.of(0x80)], {
      type: 'text/plain;charset=windows-1252',
    }, context.getRuntime());
    const utf8 = new BlobImpl([Uint8Array.of(0x68, 0xC3, 0xB6)], {}, context.getRuntime());

    const explicit = await read(context, windows1252, (reader) => {
      reader.readAsText(windows1252, 'windows-1252');
    });
    const fromType = await read(context, windows1252, (reader) => {
      reader.readAsText(windows1252, 'not-an-encoding');
    });
    const fallback = await read(context, utf8, (reader) => {
      reader.readAsText(utf8);
    });

    expect(explicit.result).toBe('€');
    expect(fromType.result).toBe('€');
    expect(fallback.result).toBe('hö');
  });

  it('lets a byte order mark override the fallback encoding', async () => {
    const context = getContext(createWindow());
    const blob = new BlobImpl([
      Uint8Array.of(0xFE, 0xFF, 0, 0x68, 0, 0x69),
    ], {}, context.getRuntime());
    const reader = await read(context, blob, (value) => {
      value.readAsText(blob, 'UTF-8');
    });

    expect(reader.result).toBe('hi');
  });

  it('fires ordered progress events with state and byte totals', async () => {
    const context = getContext(createWindow());
    const blob = new BlobImpl(['abc'], {}, context.getRuntime());
    const reader = createReader(context);
    const events: Array<{
      type: string;
      readyState: number;
      result: unknown;
      loaded: number;
      total: number;
    }> = [];

    for (const name of ['loadstart', 'progress', 'load', 'loadend'] as const) {
      reader.addEventListener(name, (event) => {
        const progress = event as ProgressEventImpl;
        events.push({
          type: event.type,
          readyState: reader.readyState,
          result: reader.result,
          loaded: progress.loaded,
          total: progress.total,
        });
      });
    }

    const done = waitForLoadEnd(reader);
    reader.readAsText(blob);
    expect(reader.readyState).toBe(1);
    expect(reader.result).toBeNull();
    await done;

    expect(events.map((event) => event.type))
      .toEqual(['loadstart', 'progress', 'load', 'loadend']);
    expect(events.map((event) => event.readyState)).toEqual([1, 1, 2, 2]);
    expect(events.slice(0, 2).map((event) => event.result))
      .toEqual([null, null]);
    expect(events.slice(1).map(({ loaded, total }) => [loaded, total]))
      .toEqual([[3, 3], [3, 3], [3, 3]]);
    expect(reader.result).toBe('abc');
  });

  it('does not fire progress for an empty Blob', async () => {
    const context = getContext(createWindow());
    const blob = new BlobImpl([], {}, context.getRuntime());
    const reader = createReader(context);
    const events: string[] = [];

    reader.onloadstart = (event) => { events.push(event.type); };
    reader.onprogress = (event) => { events.push(event.type); };
    reader.onload = (event) => { events.push(event.type); };
    reader.onloadend = (event) => { events.push(event.type); };
    const done = waitForLoadEnd(reader);
    reader.readAsText(blob);
    await done;

    expect(events).toEqual(['loadstart', 'load', 'loadend']);
    expect(reader.result).toBe('');
  });

  it('throttles intermediate progress and reports the final byte count', async () => {
    const context = getContext(createWindow());
    const size = 128 * 1024 + 1;
    const source: BlobByteSource = {
      size,
      snapshotState: { version: 1 },
      async read(_start, length) {
        await new Promise((resolve) => { setTimeout(resolve, 60); });
        return new Uint8Array(length);
      },
    };
    const blob = BlobImpl.create(
      BlobData.fromSource(source), '', source.snapshotState, context.getRuntime(),
    );
    const reader = createReader(context);
    const loaded: number[] = [];
    reader.onprogress = (event) => {
      loaded.push((event as unknown as ProgressEventImpl).loaded);
    };

    const done = waitForLoadEnd(reader);
    reader.readAsArrayBuffer(blob);
    await done;

    expect(loaded.length).toBeGreaterThanOrEqual(2);
    expect(loaded.at(-1)).toBe(size);
    expect(loaded).toEqual([...loaded].sort((a, b) => a - b));
  });

  it('rejects a concurrent read while leaving the first read active', async () => {
    const context = getContext(createWindow());
    const blob = new BlobImpl(['abc'], {}, context.getRuntime());
    const reader = createReader(context);
    const done = waitForLoadEnd(reader);

    reader.readAsText(blob);
    let error: unknown;
    try {
      reader.readAsDataURL(blob);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('InvalidStateError');
    await done;
    expect(reader.result).toBe('abc');
  });

  it('aborts synchronously and does not disturb another reader', async () => {
    const context = getContext(createWindow());
    const first = createReader(context);
    const second = createReader(context);
    const firstEvents: string[] = [];
    first.onloadstart = (event) => { firstEvents.push(event.type); };
    first.onload = (event) => { firstEvents.push(event.type); };
    first.onabort = (event) => { firstEvents.push(event.type); };
    first.onloadend = (event) => { firstEvents.push(event.type); };

    first.readAsText(new BlobImpl(['first'], {}, context.getRuntime()));
    const secondDone = waitForLoadEnd(second);
    second.readAsText(new BlobImpl(['second'], {}, context.getRuntime()));
    first.abort();

    expect(first.readyState).toBe(2);
    expect(first.result).toBeNull();
    expect(first.error).toBeNull();
    expect(firstEvents).toEqual(['abort', 'loadend']);
    await secondDone;
    expect(second.result).toBe('second');
    expect(firstEvents).toEqual(['abort', 'loadend']);
  });

  it('clears a completed result without firing events when aborted', async () => {
    const context = getContext(createWindow());
    const blob = new BlobImpl(['complete'], {}, context.getRuntime());
    const reader = await read(context, blob, (value) => {
      value.readAsText(blob);
    });
    const abort = vi.fn();
    const loadend = vi.fn();
    reader.onabort = abort;
    reader.onloadend = loadend;

    reader.abort();

    expect(reader.readyState).toBe(2);
    expect(reader.result).toBeNull();
    expect(abort).not.toHaveBeenCalled();
    expect(loadend).not.toHaveBeenCalled();
  });

  it('suppresses the old loadend when onabort starts another read', async () => {
    const context = getContext(createWindow());
    const reader = createReader(context);
    const events: string[] = [];
    let firstLoadStart = true;
    reader.onloadstart = (event) => {
      events.push(event.type);
      if (!firstLoadStart) return;
      firstLoadStart = false;
      reader.abort();
    };
    reader.onabort = (event) => {
      events.push(event.type);
      reader.readAsText(new BlobImpl(['second'], {}, context.getRuntime()));
    };
    reader.onprogress = (event) => { events.push(event.type); };
    reader.onload = (event) => { events.push(event.type); };
    reader.onloadend = (event) => { events.push(event.type); };

    const done = waitForLoadEnd(reader);
    reader.readAsText(new BlobImpl(['first'], {}, context.getRuntime()));
    await done;

    expect(reader.result).toBe('second');
    expect(events).toEqual([
      'loadstart', 'abort',
      'loadstart', 'progress', 'load', 'loadend',
    ]);
  });

  it('stops completion when a final progress handler aborts', async () => {
    const context = getContext(createWindow());
    const reader = createReader(context);
    const events: string[] = [];
    reader.onprogress = (event) => {
      events.push(event.type);
      reader.abort();
    };
    reader.onload = (event) => { events.push(event.type); };
    reader.onabort = (event) => { events.push(event.type); };
    reader.onloadend = (event) => { events.push(event.type); };

    const done = waitForLoadEnd(reader);
    reader.readAsText(new BlobImpl(['unfinished'], {}, context.getRuntime()));
    await done;

    expect(reader.result).toBeNull();
    expect(events).toEqual(['progress', 'abort', 'loadend']);
  });

  it('suppresses the old loadend when onload starts another read', async () => {
    const context = getContext(createWindow());
    const reader = createReader(context);
    const events: string[] = [];
    let firstLoad = true;
    reader.onload = (event) => {
      events.push(event.type);
      if (!firstLoad) return;
      firstLoad = false;
      reader.readAsText(new BlobImpl(['second'], {}, context.getRuntime()));
    };
    reader.onloadend = (event) => { events.push(event.type); };

    const done = waitForLoadEnd(reader);
    reader.readAsText(new BlobImpl(['first'], {}, context.getRuntime()));
    await done;

    expect(reader.result).toBe('second');
    expect(events).toEqual(['load', 'load', 'loadend']);
  });

  it('suppresses the old loadend when onerror starts another read', async () => {
    const context = getContext(createWindow());
    const source: BlobByteSource = {
      size: 1,
      snapshotState: { version: 1 },
      read: () => Promise.reject(new BlobReadFailure('NotFound')),
    };
    const failed = BlobImpl.create(
      BlobData.fromSource(source), '', source.snapshotState, context.getRuntime(),
    );
    const reader = createReader(context);
    const events: string[] = [];
    reader.onerror = (event) => {
      events.push(event.type);
      reader.readAsText(new BlobImpl(['recovered'], {}, context.getRuntime()));
    };
    reader.onload = (event) => { events.push(event.type); };
    reader.onloadend = (event) => { events.push(event.type); };

    const done = waitForLoadEnd(reader);
    reader.readAsText(failed);
    await done;

    expect(reader.result).toBe('recovered');
    expect(reader.error).toBeNull();
    expect(events).toEqual(['error', 'load', 'loadend']);
  });

  it.each([
    ['NotFound', 'NotFoundError'],
    ['UnsafeFile', 'SecurityError'],
    ['TooManyReads', 'SecurityError'],
    ['SnapshotState', 'NotReadableError'],
    ['FileLock', 'NotReadableError'],
  ] as const)('maps the %s read failure to %s', async (reason, name) => {
    const context = getContext(createWindow());
    const source: BlobByteSource = {
      size: 1,
      snapshotState: { version: 1 },
      read: () => Promise.reject(new BlobReadFailure(reason)),
    };
    const blob = BlobImpl.create(
      BlobData.fromSource(source), '', source.snapshotState, context.getRuntime(),
    );
    const reader = createReader(context);
    const events: string[] = [];
    reader.onloadstart = (event) => { events.push(event.type); };
    reader.onerror = (event) => { events.push(event.type); };
    reader.onloadend = (event) => { events.push(event.type); };

    const done = waitForLoadEnd(reader);
    reader.readAsArrayBuffer(blob);
    await done;

    expect(events).toEqual(['error', 'loadend']);
    expect(reader.readyState).toBe(2);
    expect(reader.result).toBeNull();
    expect(reader.error?.name).toBe(name);
    expect(Reflect.get(context.project(FileReaderImpl, reader), 'error'))
      .toBeInstanceOf(requireFunction(context.realm.global, 'DOMException'));
  });
});

function createWindow(): Window & typeof globalThis {
  return new Browlet({ route: () => '' }).window as
    Window & typeof globalThis;
}

function createReader(context = getContext(createWindow())): FileReaderImpl {
  return new FileReaderImpl(context.getRuntime());
}

function getContext(window: object): BindingContext {
  return browletBindings.forRealm(getRelevantRealm(window)).context;
}

async function read(
  context: BindingContext,
  blob: BlobImpl,
  start: (reader: FileReaderImpl) => void,
): Promise<FileReaderImpl> {
  const reader = createReader(context);
  const done = waitForLoadEnd(reader);
  start(reader);
  await done;
  if (reader.error) throw reader.error;
  return reader;
}

function waitForLoadEnd(reader: FileReaderImpl): Promise<void> {
  return new Promise((resolve) => {
    reader.addEventListener('loadend', () => { resolve(); });
  });
}

function call(
  object: object,
  name: string,
  argumentsList: unknown[] = [],
): unknown {
  return Reflect.apply(requireFunction(object, name), object, argumentsList);
}

function requireFunction(object: object, name: string): CallableFunction {
  const value = Reflect.get(object, name) as unknown;
  if (typeof value !== 'function') throw new Error(`${name} is not a function`);
  return value;
}
