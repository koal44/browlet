import { finished } from 'node:stream';
import { ParserStream } from 'parse5-parser-stream';
import { jsRuntime, type PromiseValue, type RuntimeContext } from '../../../js-engine/index';
import { DocumentImpl } from '../../dom/nodes/document';
import type { ElementImpl } from '../../dom/nodes/element';
import type { EventLoop } from '../../scripting/event-loop';
import { networkingTaskSource, queueTask } from '../../scripting/tasks';
import {
  HTMLTreeAdapter, type HTMLTreeAdapterMap,
} from './tree-adapter';

export class BrowletParser {
  readonly document: DocumentImpl;
  readonly #handleScript: ScriptHandler;
  readonly #eventLoop: EventLoop;
  readonly #stream: ParserStream<HTMLTreeAdapterMap>;
  readonly #treeAdapter: HTMLTreeAdapter;
  readonly #runtime: RuntimeContext;

  constructor(
    document: DocumentImpl,
    handleScript: ScriptHandler,
    eventLoop: EventLoop,
    runtime: RuntimeContext,
  ) {
    this.document = document;
    this.#handleScript = handleScript;
    this.#eventLoop = eventLoop;
    this.#runtime = runtime;
    this.#treeAdapter = new HTMLTreeAdapter(document);
    this.#stream = new ParserStream<HTMLTreeAdapterMap>({
      sourceCodeLocationInfo: true,
      treeAdapter: this.#treeAdapter,
    });
    this.#stream.on('script', (element, write, resume) => {
      this.handleScript(element, write, resume);
    });
  }

  parse(source: string): PromiseValue<void> {
    const complete = this.#runtime.promises.withResolvers<void>();
    // Node owns stream completion; DOM finalization re-enters an HTML task.
    const cleanup = finished(this.#stream, (error) => {
      cleanup();
      this.queueTask(() => {
        try {
          if (error) throw error;
          this.#treeAdapter.finishParsing();
          complete.resolve(undefined);
        } catch (failure) { complete.reject(failure); }
      });
    });
    this.queueTask(() => {
      try { this.#stream.end(source); }
      catch (error) { this.#stream.destroy(toError(error)); }
    });
    return complete.promise;
  }

  // -- Private ----------------------------------------------------------

  private handleScript(
    element: ElementImpl,
    write: DocumentWrite,
    resume: () => void,
  ): void {
    try {
      // HTML §13.2.6.4: Checkpoint before script preparation. Parsing enters
      // through HTML tasks; speculative parsing and full script preparation
      // remain separate parser integration work.
      this.#eventLoop.performMicrotaskCheckpointIfStackEmpty();
      this.runScript(element, write, resume);
    } catch (error) {
      this.#stream.destroy(toError(error));
    }
  }

  private runScript(
    element: ElementImpl,
    write: DocumentWrite,
    resume: () => void,
  ): void {
    try {
      // HTML's blocking wait resumes on the original (networking) task source.
      // Recheck here: another stylesheet can block before that task runs.
      if (DocumentImpl.hasScriptBlockingStyleSheets(this.document)) {
        DocumentImpl.waitForScriptBlockingStyleSheets(this.document, this.#runtime).observe(
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
    try { steps(); }
    catch (error) { this.#stream.destroy(toError(error)); }
  }

  private queueTask(steps: () => void): void {
    queueTask(networkingTaskSource, this.#eventLoop, this.document, jsRuntime.bindAsyncContext(steps));
  }
}

export type ScriptHandler = (
  element: ElementImpl,
  write: DocumentWrite,
) => void | PromiseValue<void>;

export type DocumentWrite = (markup: string) => void;

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
