import {
  arg, atArg, constant, ctor, defineInterface, idlType, impl, integer, nullable, op, roAttr,
  reference, union, DOMExceptionNames, throwDOMException,
} from '../../../web-idl/index';
import { getBufferSourceCopy, type RuntimeContext } from '../../../js-engine/index';
import {
  packageData, type BlobImpl, type FileReadType,
} from '../../../file/index';
import type { TaskHandle } from '../../../infra/index';
import { fireProgressEvent } from '../../dom/events/progress-event';
import {
  EventHandlerMap, eventHandlerAttr, type EventHandlerCallback,
} from '../../scripting/event-handlers';
import { EventTargetImpl } from '../../dom/events/event-target';
import { unsafeSharedCurrentTime } from '../../performance/high-resolution-time';

/*
 * File API §6.2 — The FileReader API
 *
 * [Exposed=(Window,Worker)]
 * interface FileReader : EventTarget {
 *   constructor();
 *   undefined readAsArrayBuffer(Blob blob);
 *   undefined readAsBinaryString(Blob blob);
 *   undefined readAsText(Blob blob, optional DOMString encoding);
 *   undefined readAsDataURL(Blob blob);
 *   undefined abort();
 *
 *   const unsigned short EMPTY = 0;
 *   const unsigned short LOADING = 1;
 *   const unsigned short DONE = 2;
 *   readonly attribute unsigned short readyState;
 *   readonly attribute (DOMString or ArrayBuffer)? result;
 *   readonly attribute DOMException? error;
 *
 *   attribute EventHandler onloadstart;
 *   attribute EventHandler onprogress;
 *   attribute EventHandler onload;
 *   attribute EventHandler onabort;
 *   attribute EventHandler onerror;
 *   attribute EventHandler onloadend;
 * };
 */
export class FileReaderImpl extends EventTargetImpl {
  readonly #runtime: RuntimeContext;
  #state: FileReaderState = 'empty';
  #result: string | ArrayBuffer | null = null;
  #error: DOMException | null = null;
  #operation: FileReadOperation | null = null;
  readonly #eventHandlers = new EventHandlerMap(this, [
    { name: 'onloadstart', type: 'loadstart' },
    { name: 'onprogress', type: 'progress' },
    { name: 'onload', type: 'load' },
    { name: 'onabort', type: 'abort' },
    { name: 'onerror', type: 'error' },
    { name: 'onloadend', type: 'loadend' },
  ]);

  constructor(runtime: RuntimeContext) {
    super();
    this.#runtime = runtime;
  }

  readAsArrayBuffer(blob: BlobImpl): void {
    this.#read(blob, 'ArrayBuffer');
  }

  readAsBinaryString(blob: BlobImpl): void {
    this.#read(blob, 'BinaryString');
  }

  readAsText(
    blob: BlobImpl,
    encoding?: string,
  ): void {
    this.#read(blob, 'Text', encoding);
  }

  readAsDataURL(blob: BlobImpl): void {
    this.#read(blob, 'DataURL');
  }

  /** File API §6.2.3.5 — The abort() method. */
  abort(): void {
    this.#result = null;
    if (!this.#isLoading()) return;

    const operation = this.#operation;
    if (operation === null) {
      throw new Error('A loading FileReader has no active read operation');
    }

    this.#state = 'done';
    this.#operation = null;
    for (const task of operation.tasks) task.remove();
    operation.tasks.clear();
    operation.cancel();

    // The current draft does not set error to AbortError. Blink, Gecko, and
    // WebKit do; keep the normative state until that divergence is resolved.
    fireProgressEvent('abort', this, operation.loaded, operation.total);
    if (!this.#isLoading()) {
      fireProgressEvent('loadend', this, operation.loaded, operation.total);
    }
  }

  get readyState(): number {
    switch (this.#state) {
      case 'empty': return 0;
      case 'loading': return 1;
      case 'done': return 2;
    }
  }

  get result(): string | ArrayBuffer | null {
    return this.#result;
  }

  get error(): DOMException | null {
    return this.#error;
  }

  get onloadstart(): EventHandlerCallback | null {
    return this.#eventHandlers.get('onloadstart');
  }

  set onloadstart(callback: EventHandlerCallback | null) {
    this.#eventHandlers.set('onloadstart', callback);
  }

  get onprogress(): EventHandlerCallback | null {
    return this.#eventHandlers.get('onprogress');
  }

  set onprogress(callback: EventHandlerCallback | null) {
    this.#eventHandlers.set('onprogress', callback);
  }

  get onload(): EventHandlerCallback | null {
    return this.#eventHandlers.get('onload');
  }

  set onload(callback: EventHandlerCallback | null) {
    this.#eventHandlers.set('onload', callback);
  }

  get onabort(): EventHandlerCallback | null {
    return this.#eventHandlers.get('onabort');
  }

  set onabort(callback: EventHandlerCallback | null) {
    this.#eventHandlers.set('onabort', callback);
  }

  get onerror(): EventHandlerCallback | null {
    return this.#eventHandlers.get('onerror');
  }

  set onerror(callback: EventHandlerCallback | null) {
    this.#eventHandlers.set('onerror', callback);
  }

  get onloadend(): EventHandlerCallback | null {
    return this.#eventHandlers.get('onloadend');
  }

  set onloadend(callback: EventHandlerCallback | null) {
    this.#eventHandlers.set('onloadend', callback);
  }

  /** File API §6.2 — Read operation. */
  #read(
    blob: BlobImpl,
    type: FileReadType,
    encodingLabel?: string,
  ): void {
    if (this.#isLoading()) {
      throwDOMException(DOMExceptionNames.invalidState);
    }

    this.#state = 'loading';
    this.#result = null;
    this.#error = null;

    const { fileReading, promises } = this.#runtime;
    const reader = blob.stream().getDefaultReader();
    const operation: FileReadOperation = {
      cancel() {
        const promise = reader.cancelInternal(undefined);
        promise.observe(() => {}, () => {});
      },
      loaded: 0,
      tasks: new Set(),
      total: blob.size,
    };
    this.#operation = operation;
    const chunks: Uint8Array[] = [];
    let isFirstChunk = true;
    let lastProgressTime: number | undefined;
    let lastProgressByteLength = 0;

    const fire = (name: string): void => {
      fireProgressEvent(name, this, operation.loaded, operation.total);
    };

    const queueTask = (steps: () => void): void => {
      if (this.#operation !== operation) return;
      const task = fileReading.queueTask(() => {
        operation.tasks.delete(task);
        if (this.#operation === operation) steps();
      });
      operation.tasks.add(task);
    };

    const noteFirstChunk = (): void => {
      if (!isFirstChunk) return;
      isFirstChunk = false;
      queueTask(() => {
        fireProgressEvent('loadstart', this, 0, blob.size);
      });
    };

    const readNextChunk = (): void => {
      if (this.#operation !== operation) return;
      reader.readChunk({
        chunkSteps: (chunk) => {
          if (this.#operation !== operation) return;
          noteFirstChunk();
          const bytes = getBufferSourceCopy(chunk as object);
          chunks.push(bytes);
          operation.loaded += bytes.length;

          const now = unsafeSharedCurrentTime().milliseconds;
          if (lastProgressTime === undefined) {
            lastProgressTime = now;
          } else if (now - lastProgressTime >= progressInterval) {
            const transmitted = operation.loaded;
            lastProgressByteLength = transmitted;
            lastProgressTime = now;
            queueTask(() => {
              fireProgressEvent('progress', this, transmitted, blob.size);
            });
          }
          void promises.resolve().then(readNextChunk);
        },
        closeSteps: () => {
          if (this.#operation !== operation) return;
          noteFirstChunk();
          queueTask(() => {
            if (operation.loaded > lastProgressByteLength) {
              fire('progress');
              if (this.#operation !== operation) return;
            }

            this.#state = 'done';
            this.#operation = null;
            const bytes = new Uint8Array(operation.loaded);
            let offset = 0;
            for (const chunk of chunks) {
              bytes.set(chunk, offset);
              offset += chunk.length;
            }

            try {
              this.#result = packageData(
                bytes,
                type,
                blob.type,
                encodingLabel,
                this.#runtime,
              );
              fire('load');
            } catch (error) {
              this.#error = error as DOMException;
              fire('error');
            }
            if (!this.#isLoading()) fire('loadend');
          });
        },
        errorSteps: (error) => {
          if (this.#operation !== operation) return;
          queueTask(() => {
            this.#state = 'done';
            this.#operation = null;
            this.#error = error as DOMException;
            fire('error');
            if (!this.#isLoading()) fire('loadend');
          });
        },
      });
    };

    fileReading.runInParallel(readNextChunk);
  }

  #isLoading(): boolean {
    return this.#state === 'loading';
  }
}

// -- Web IDL ------------------------------------------------------------
// BINDING_INTEGRATION: supply the runtime and realize retained exceptions.
export const fileReaderIDL = defineInterface({
  name: 'FileReader',
  inherits: 'EventTarget',
  exposed: ['Window', 'Worker'],
  implementation: impl(FileReaderImpl, {
    constructWith: [atArg(0, (ctx) => ctx.getRuntime())],
  }),
  members: [
    ctor(),
    op('readAsArrayBuffer', idlType.undefined, [
      arg('blob', reference('Blob')),
    ]),
    op('readAsBinaryString', idlType.undefined, [
      arg('blob', reference('Blob')),
    ]),
    op('readAsText', idlType.undefined, [
      arg('blob', reference('Blob')),
      arg('encoding', idlType.DOMString, { optional: true }),
    ]),
    op('readAsDataURL', idlType.undefined, [
      arg('blob', reference('Blob')),
    ]),
    op('abort', idlType.undefined),
    constant('EMPTY', idlType.unsignedShort, integer(0)),
    constant('LOADING', idlType.unsignedShort, integer(1)),
    constant('DONE', idlType.unsignedShort, integer(2)),
    roAttr('readyState', idlType.unsignedShort),
    roAttr('result', nullable(union(idlType.DOMString, idlType.ArrayBuffer))),
    roAttr('error', nullable(reference('DOMException')), {
      // BINDING_INTEGRATION: realize a retained failure on its first author observation.
      get(context) {
        const error = context.realizeException((this as FileReaderImpl).error);
        return context.convertToImpl(error, nullable(reference('DOMException')));
      },
    }),
    eventHandlerAttr('onloadstart'),
    eventHandlerAttr('onprogress'),
    eventHandlerAttr('onload'),
    eventHandlerAttr('onabort'),
    eventHandlerAttr('onerror'),
    eventHandlerAttr('onloadend'),
  ],
});

type FileReaderState = 'empty' | 'loading' | 'done';

type FileReadOperation = {
  cancel(): void;
  loaded: number;
  readonly tasks: Set<TaskHandle>;
  readonly total: number;
};

const progressInterval = 50;
