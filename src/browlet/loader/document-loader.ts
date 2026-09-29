import { populateWithHTMLHeadBody } from '../browsing/browsing-context';
import { createAndInitializeDocument } from '../browsing/document-lifecycle';
import type { NavigationParams } from '../browsing/navigation/navigation';
import type { DocumentImpl } from '../dom/nodes/document';
import { BrowletParser, type ScriptHandler } from '../html/parser/document-parser';
import type { InternalPromise } from '../../infra/promises';

/** Create an HTML document and start consuming its navigation response. */
// https://html.spec.whatwg.org/multipage/document-lifecycle.html#read-html
// SPEC_MISMATCH: load an HTML document(navigationParams) -> Document
export function loadHTMLDocument(params: NavigationParams, handleScript: ScriptHandler): DocumentImpl {
  const document = createAndInitializeDocument('html', 'text/html', params);
  if (document.URL === 'about:blank') {
    populateWithHTMLHeadBody(document);
    return document;
  }

  const { env } = document;
  const parser = new BrowletParser(
    document,
    (element, write) => document.waitForScriptsMayRun().then(() => handleScript(element, write)),
    env.responsibleEventLoop,
    env,
  );
  document.activeParser = parser;
  // PROVISIONAL(HTML bytes): BOM/transport decoding works; full encoding
  // selection and replay for restart remain with the parser integration.
  const parsing: InternalPromise<void> = parser.parseBytes(
    params.response.body,
    params.response.headerList,
    () => document.processLinkHeaders(params.response, 'media'),
  );
  parsing.observe(
    () => env.exec.queueTask('network', () => {
      document.activeParser = null;
      document.finishLoading();
    }),
    () => env.exec.queueTask('network', () => {
      document.abort();
      document.activeParser = null;
    }),
  );
  return document;
}
