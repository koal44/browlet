import { idlType } from '../../../web-idl/index';
import { finished } from 'node:stream';
import { types } from 'node:util';
import { ParserStream } from 'parse5-parser-stream';
import { bindAsyncContext, getBufferSourceCopy, getBufferTypeName, type JSEnvironment } from '../../../js-engine/index';
import { bomSniff, endOfQueue, getDecoder, getEncoding, IOQueue, type Decoder } from '../../../encoding/index';
import type { FetchBody, FetchHeaders } from '../../../fetch/index';
import type { ReadableStreamDefaultReaderImpl } from '../../../streams/index';
import { InternalError } from '../../../infra/internal-error';
import type { InternalPromise } from '../../../infra/promises';
import type { DocumentImpl } from '../../dom/nodes/document';
import type { ElementImpl } from '../../dom/nodes/element';
import type { EventLoop } from '../../scripting/event-loop';
import { networkingTaskSource } from '../../scripting/tasks';
import {
  HTMLTreeAdapter, type HTMLTreeAdapterMap,
} from './tree-adapter';

export class BrowletParser {
  document: DocumentImpl;
  #handleScript: ScriptHandler;
  #eventLoop: EventLoop;
  #stream: ParserStream<HTMLTreeAdapterMap>;
  #treeAdapter: HTMLTreeAdapter;
  #env: JSEnvironment;
  #bodyReader?: ReadableStreamDefaultReaderImpl;
  #body?: FetchBody;

  constructor(
    document: DocumentImpl,
    handleScript: ScriptHandler,
    eventLoop: EventLoop,
    env: JSEnvironment,
  ) {
    this.document = document;
    this.#handleScript = handleScript;
    this.#eventLoop = eventLoop;
    this.#env = env;
    this.#treeAdapter = new HTMLTreeAdapter(document);
    this.#stream = new ParserStream<HTMLTreeAdapterMap>({
      sourceCodeLocationInfo: true,
      treeAdapter: this.#treeAdapter,
    });
    this.#stream.on('script', (element, write, resume) => {
      this.handleScript(element, write, resume);
    });
  }

  /** Feed already-decoded characters to the parser. */
  parse(source: string): InternalPromise<void> {
    return this.startParsing(() => { this.#stream.end(source); });
  }

  /** Decode response chunks and feed the parser on the document's networking tasks. */
  // Input and EOF steps of "load an HTML document".
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#read-html
  // PROVISIONAL(HTML bytes): BOM and transport charset, otherwise UTF-8.
  // Full encoding selection and restart remain in ROADMAP.md.
  parseBytes(body: FetchBody | null, headers: FetchHeaders, onFirstInput: () => void): InternalPromise<void> {
    const label = headers.extractMIMEType()?.parameters.get('charset');
    const fallback = label === undefined ? 'UTF-8' : getEncoding(label) ?? 'UTF-8';
    const input = new IOQueue<Uint8Array>();
    const output = new IOQueue<string>();
    let decoder: Decoder | undefined;
    let firstInput = true;
    this.#body = body ?? undefined;

    // Encoding's decode algorithm, continued across chunks.
    // https://encoding.spec.whatwg.org/#decode
    const consume = (bytes?: Uint8Array) => {
      input.push(bytes ?? endOfQueue);
      if (decoder === undefined) {
        const bom = bomSniff(input);
        if (bom === undefined) { read(); return; }
        this.document.encoding = bom ?? fallback;
        decoder = getDecoder(bom ?? fallback);
        if (bom !== null) input.readAvailable(bom === 'UTF-8' ? 3 : 2);
      }
      decoder.decode(input, output, 'replacement');
      const text = output.takeString();
      if (bytes === undefined) {
        this.#stream.end(text);
      } else {
        this.#stream.write(text, (error) => {
          if (error) this.#stream.destroy(error);
          else read();
        });
      }
      if (firstInput) {
        firstInput = false;
        onFirstInput();
      }
    };
    const read = () => {
      if (this.#stream.destroyed) return;
      this.queueBodyTask(() => {
        if (this.#stream.destroyed) return;
        this.#bodyReader ??= body!.stream.getDefaultReader();
        this.#bodyReader.readChunk({
          chunkSteps: (chunk) => {
            if (typeof chunk !== 'object' || chunk === null || getBufferTypeName(chunk) !== 'Uint8Array') {
              this.#stream.destroy(new InternalError('HTML response body produced a non-byte chunk'));
              return;
            }
            const bytes = getBufferSourceCopy(chunk);
            this.queueInput(() => consume(bytes));
          },
          closeSteps: () => {
            if (this.#stream.destroyed) return;
            this.#bodyReader!.release();
            this.#bodyReader = undefined;
            this.#body = undefined;
            this.queueInput(() => consume());
          },
          errorSteps: (error) => { this.#stream.destroy(toError(error)); },
        });
      });
    };
    return this.startParsing(() => {
      if (body === null) consume();
      else read();
    });
  }

  /** Discard further input and stop pending parser continuations. */
  // https://html.spec.whatwg.org/multipage/parsing.html#abort-a-parser
  abort(): void {
    this.stopInput();
    this.#stream.destroy();
    if (this.document.activeParser === this) this.document.activeParser = null;
    // PROVISIONAL(HTML parser): readiness events, open-element cleanup, and
    // speculative-parser cancellation enter with the full parser lifecycle.
    this.document.currentDocumentReadiness = 'complete';
  }

  // -- Private ----------------------------------------------------------

  private startParsing(start: () => void): InternalPromise<void> {
    const complete = this.#env.exec.Promise.withResolvers(idlType.undefined);
    // Node owns stream completion; DOM finalization re-enters an HTML task.
    const cleanup = finished(this.#stream, (error) => {
      cleanup();
      this.queueTask(() => {
        try {
          if (error) { this.stopInput(); throw error; }
          this.#treeAdapter.finishParsing();
          complete.resolve(undefined);
        } catch (failure) { complete.reject(failure); }
      });
    });
    this.queueInput(start);
    return complete.promise;
  }

  private stopInput(): void {
    const body = this.#body;
    if (body === undefined) return;
    const reader = this.#bodyReader;
    this.#bodyReader = undefined;
    this.queueBodyTask(() => {
      body.stream.cancelInternal(undefined).observe(() => {}, () => {});
      reader?.release();
    });
    this.#body = undefined;
  }

  private queueBodyTask(steps: () => void): void {
    // Navigation bodies can belong to the browser sandbox rather than this
    // Document. Stream reads and cancellation enter that owner's checkpoint.
    const env = this.#body!.stream.env;
    env.exec.networking.queueGlobalTask(env.exec.global, () => {
      try { steps(); }
      catch (error) { this.#stream.destroy(toError(error)); }
    });
  }

  private queueInput(steps: () => void): void {
    this.queueTask(() => {
      if (this.#stream.destroyed) return;
      try { steps(); }
      catch (error) { this.#stream.destroy(toError(error)); }
    });
  }

  // HTML's text insertion mode, at the end tag of a script element.
  // https://html.spec.whatwg.org/#parsing-main-incdata
  private handleScript(
    element: ElementImpl,
    write: DocumentWrite,
    resume: () => void,
  ): void {
    try {
      // Checkpoint before script preparation.
      this.#eventLoop.performMicrotaskCheckpointIfStackEmpty();
      this.runScript(element, write, resume);
    } catch (error) {
      this.#stream.destroy(toError(error));
    }
  }

  // https://html.spec.whatwg.org/#parsing-main-incdata
  private runScript(
    element: ElementImpl,
    write: DocumentWrite,
    resume: () => void,
  ): void {
    if (this.#stream.destroyed) return;
    try {
      // HTML's blocking wait resumes on the original (networking) task source.
      // Recheck here: another stylesheet can block before that task runs.
      if (this.document.hasScriptBlockingStyleSheets()) {
        this.document.waitForScriptBlockingStyleSheets(this.#env).observe(
          () => { this.queueTask(() => { this.runScript(element, write, resume); }); },
          (error) => { this.#stream.destroy(toError(error)); },
        );
        return;
      }

      const complete = this.#handleScript(element, write);
      if (complete === undefined) {
        this.resume(resume);
      } else {
        complete.observe(
          () => { this.queueTask(() => { this.resume(resume); }); },
          (error) => { this.#stream.destroy(toError(error)); },
        );
      }
    } catch (error) {
      this.#stream.destroy(toError(error));
    }
  }

  private resume(steps: () => void): void {
    if (this.#stream.destroyed) return;
    try { steps(); }
    catch (error) { this.#stream.destroy(toError(error)); }
  }

  private queueTask(steps: () => void): void {
    this.#eventLoop.queueTask(networkingTaskSource, this.document, bindAsyncContext(steps));
  }
}

export type ScriptHandler = (
  element: ElementImpl,
  write: DocumentWrite,
) => void | InternalPromise<void>;

export type DocumentWrite = (markup: string) => void;

function toError(value: unknown): Error {
  // Preserve errors from page realms when passing failures to Node's stream.
  // eslint-disable-next-line no-restricted-globals -- Node streams require an Error; preserve an arbitrary thrown value as its message.
  return types.isNativeError(value) ? value : new Error(String(value));
}
