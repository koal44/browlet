import { finished } from 'node:stream/promises';
import { ParserStream } from 'parse5-parser-stream';
import type { Domlet } from '../domlet/domlet';
import { DocumentImpl, type DomletDocument } from '../domlet/nodes/document';
import type { ElementImpl } from '../domlet/nodes/element';
import type {
  DomletParser, DomletParserTreeAdapterMap,
} from '../domlet/parser/parser';

export class BrowletParser {
  readonly document: DomletDocument;
  readonly #handleScript: ScriptHandler;
  readonly #stream: ParserStream<DomletParserTreeAdapterMap>;
  readonly #treeAdapter: DomletParser;

  constructor(
    domlet: Domlet,
    document: DomletDocument,
    handleScript: ScriptHandler,
  ) {
    this.document = document;
    this.#handleScript = handleScript;
    this.#treeAdapter = domlet.createParser(document);
    this.#stream = new ParserStream<DomletParserTreeAdapterMap>({
      sourceCodeLocationInfo: true,
      treeAdapter: this.#treeAdapter,
    });
    this.#stream.on('script', (element, write, resume) => {
      void this.handleScript(element, write, resume);
    });
  }

  async parse(source: string): Promise<void> {
    const complete = finished(this.#stream);

    this.#stream.end(source);
    await complete;
    this.#treeAdapter.finishParsing();
  }

  // -- Private ----------------------------------------------------------

  private async handleScript(
    element: ElementImpl,
    write: DocumentWrite,
    resume: () => void,
  ): Promise<void> {
    try {
      // Browlet has no nested navigables, so only this Document can block.
      await DocumentImpl.waitForScriptBlockingStyleSheets(this.document);
      await this.#handleScript(element, write);
      resume();
    } catch (error) {
      this.#stream.destroy(toError(error));
    }
  }
}

export type ScriptHandler = (
  element: ElementImpl,
  write: DocumentWrite,
) => void | Promise<void>;

export type DocumentWrite = (markup: string) => void;

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
