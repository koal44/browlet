import { getRelevantRealm } from '../../src/browlet/bindings';
import { Browlet } from '../../src/browlet/browlet';
import type { BrowletEnvironment } from '../../src/browlet/scripting/environment';
import { DocumentImpl } from '../../src/browlet/dom/nodes/document';
import { parseHTMLDocument } from '../../src/browlet/html/parser/parse';

/** Create a detached document with real realm execution and direct node allocation. */
export function createTestDocument(env: BrowletEnvironment = createDocumentEnvironment()): DocumentImpl {
  return new DocumentImpl(undefined, env);
}

/** Parse an implementation tree using real browser settings. */
export function parseTestDocument(
  source = '',
  env: BrowletEnvironment = createDocumentEnvironment(),
): DocumentImpl {
  return parseHTMLDocument(source, {}, env);
}

function createDocumentEnvironment(): BrowletEnvironment {
  const browser = new Browlet({ route: () => '' });
  return getRelevantRealm(browser.window).env;
}
