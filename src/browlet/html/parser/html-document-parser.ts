import { finished } from 'node:stream';
import { types } from 'node:util';
import { ParserStream } from 'parse5-parser-stream';

import type { InternalPromise } from '../../../infra/index';
import { bindAsyncContext } from '../../../js-engine/index';
import { DOMExceptionImpl, DOMExceptionNames, idlType } from '../../../web-idl/core/index';
import { bomSniff, endOfQueue, getDecoder, getEncoding, IOQueue, type Decoder } from '../../../encoding/index';

import { networkingTaskSource } from '../../scripting/index';
import type { DocumentImpl, ElementImpl } from '../../dom/nodes/index';
import type { ResourceReader } from '../../loader/index';

import { DocumentParser } from './document-parser';
import {
  HTMLTreeAdapter, type HTMLTreeAdapterMap,
} from './tree-adapter';

/** Feeds response text into parse5 while coordinating scripts and document tasks. */
// https://html.spec.whatwg.org/multipage/parsing.html#parsing
export class HTMLDocumentParser extends DocumentParser {
  /** Distinguishes HTML parsing from XML for document readiness timing. */
  kind = 'html' as const;
  /** Host steps run when the parser encounters a script element. */
  #scriptHandler: ScriptHandler;
  /** parse5's character stream and underlying HTML parser. */
  #parse5Stream: ParserStream<HTMLTreeAdapterMap>;
  /** Loaded bytes, including the prefix already inspected for MIME sniffing. */
  #resource?: ResourceReader;

  constructor(document: DocumentImpl, scriptHandler: ScriptHandler) {
    super(document);
    this.#scriptHandler = scriptHandler;
    this.#parse5Stream = new ParserStream<HTMLTreeAdapterMap>({
      sourceCodeLocationInfo: true,
      treeAdapter: new HTMLTreeAdapter(document),
    });
    this.#parse5Stream.on('script', (element, write, resume) => {
      try {
        // HTML's text insertion mode checkpoints before script preparation.
        // https://html.spec.whatwg.org/#parsing-main-incdata
        this.document.env.responsibleEventLoop.performMicrotaskCheckpointIfStackEmpty();
        this.#runScript(element, write, resume);
      } catch (error) {
        this.#parse5Stream.destroy(toError(error));
      }
    });
  }

  /** Feed already-decoded characters to the parser. */
  parse(source: string): InternalPromise<void> {
    return this.#startParsing(() => { this.#parse5Stream.end(source); });
  }

  /** Decode an already-sniffed resource and feed the parser on the document's networking tasks. */
  // Input and EOF steps of "load an HTML document".
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#read-html
  // PROVISIONAL(HTML bytes): BOM and transport charset, otherwise UTF-8.
  // Full encoding selection and restart remain in ROADMAP.md.
  parseBytes(resource: ResourceReader, onFirstInput: () => void): InternalPromise<void> {
    const label = resource.response.headerList.extractMIMEType()?.parameters.get('charset');
    const fallback = label === undefined ? 'UTF-8' : getEncoding(label) ?? 'UTF-8';
    const input = new IOQueue<Uint8Array>();
    const output = new IOQueue<string>();
    let decoder: Decoder | undefined;
    let firstInput = true;
    this.#resource = resource;

    const read = () => {
      if (this.#parse5Stream.destroyed) return;
      resource.read().observe((bytes) => {
        if (bytes === null) this.#resource = undefined;
        this.#queueInput(() => decode(bytes));
      }, (error) => { this.#queueInput(() => { this.#parse5Stream.destroy(toError(error)); }); });
    };

    // Encoding's decode algorithm, continued across chunks.
    // https://encoding.spec.whatwg.org/#decode
    const decode = (bytes: Uint8Array | null) => {
      input.push(bytes ?? endOfQueue);
      if (decoder === undefined) {
        const bom = bomSniff(input);
        // Sniffing peeks at three bytes, or fewer once input has ended.
        if (bom === undefined) { read(); return; }
        const encoding = bom ?? fallback;
        this.document.encoding = encoding;
        decoder = getDecoder(encoding);
        // Remove the recognized BOM bytes before decoding document text.
        if (bom !== null) input.readAvailable(bom === 'UTF-8' ? 3 : 2);
      }
      decoder.decode(input, output, 'replacement');
      write(output.takeString(), bytes === null);
    };

    // Feed decoded text to parse5; request more bytes after it processes the write.
    const write = (text: string, ended: boolean) => {
      if (ended) {
        this.#parse5Stream.end(text);
      } else {
        this.#parse5Stream.write(text, (error) => {
          if (error) this.#parse5Stream.destroy(error);
          else read();
        });
      }
      if (firstInput) {
        firstInput = false;
        onFirstInput();
      }
    };

    return this.#startParsing(read);
  }

  /** Discard further input and stop pending parser continuations. */
  // https://html.spec.whatwg.org/multipage/parsing.html#abort-a-parser
  abort(): void {
    this.#stopInput();
    this.#parse5Stream.destroy();
    this.stopped = true;
    // TODO(HTML parser): stop speculative parsing when that parser exists.
    this.document.updateCurrentDocumentReadiness('interactive');
    // TODO(HTML parser): pop all open elements and finish their parsing hooks.
    this.document.updateCurrentDocumentReadiness('complete');
    this.detach();
  }

  #startParsing(start: () => void): InternalPromise<void> {
    const complete = this.document.env.exec.Promise.withResolvers(idlType.undefined);
    // Node owns stream completion; DOM finalization re-enters an HTML task.
    const cleanup = finished(this.#parse5Stream, (error) => {
      cleanup();
      this.#queueTask(() => {
        try {
          if (error) { this.#stopInput(); throw error; }
          // Abortion can run after Node reports EOF but before this task starts.
          if (this.stopped) throw new DOMExceptionImpl('', DOMExceptionNames.abort);
          // Construction supplies our adapter; parse5 exposes its base interface.
          (this.#parse5Stream.parser.treeAdapter as HTMLTreeAdapter).finishParsing();
          this.stopped = true;
          this.document.updateCurrentDocumentReadiness('interactive');
          complete.resolve(undefined);
        } catch (failure) { complete.reject(failure); }
      });
    });
    this.#queueInput(start);
    return complete.promise;
  }

  #stopInput(): void {
    this.#resource?.cancel().observe(() => {}, () => {});
    this.#resource = undefined;
  }

  #queueInput(steps: () => void): void {
    this.#queueTask(() => {
      if (this.#parse5Stream.destroyed) return;
      try { steps(); }
      catch (error) { this.#parse5Stream.destroy(toError(error)); }
    });
  }

  // https://html.spec.whatwg.org/#parsing-main-incdata
  #runScript(
    element: ElementImpl,
    write: DocumentWrite,
    resume: () => void,
  ): void {
    if (this.#parse5Stream.destroyed) return;
    try {
      // HTML's blocking wait resumes on the original (networking) task source.
      // Recheck here: another stylesheet can block before that task runs.
      if (this.document.hasScriptBlockingStyleSheets()) {
        this.document.waitForScriptBlockingStyleSheets().observe(
          () => { this.#queueTask(() => { this.#runScript(element, write, resume); }); },
          (error) => { this.#parse5Stream.destroy(toError(error)); },
        );
        return;
      }

      const complete = this.#scriptHandler(element, write);
      if (complete === undefined) {
        this.#resume(resume);
      } else {
        complete.observe(
          () => { this.#queueTask(() => { this.#resume(resume); }); },
          (error) => { this.#parse5Stream.destroy(toError(error)); },
        );
      }
    } catch (error) {
      this.#parse5Stream.destroy(toError(error));
    }
  }

  #resume(steps: () => void): void {
    if (this.#parse5Stream.destroyed) return;
    try { steps(); }
    catch (error) { this.#parse5Stream.destroy(toError(error)); }
  }

  #queueTask(steps: () => void): void {
    this.document.env.responsibleEventLoop.queueTask(networkingTaskSource, this.document, bindAsyncContext(steps));
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
