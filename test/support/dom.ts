import { getRelevantRealm } from './browlet-binding';
import { Browlet } from '../../src/browlet/browlet';
import type { BrowletEnvironment } from '../../src/browlet/environment';
import type { DocumentImpl } from '../../src/browlet/dom/nodes/document';
import { parseHTMLDocument } from '../../src/browlet/html/parser/parse';

/** Create a detached document through its environment's real binding and execution. */
export function createTestDocument(env: BrowletEnvironment = createDocumentEnvironment()): DocumentImpl {
  return env.exec.createDocument();
}

/** Parse an implementation tree using real browser settings. */
export function parseTestDocument(
  source = '',
  env: BrowletEnvironment = createDocumentEnvironment(),
): DocumentImpl {
  return parseHTMLDocument(source, env);
}

function createDocumentEnvironment(): BrowletEnvironment {
  const browser = new Browlet({ route: () => '' });
  return getRelevantRealm(browser.window).env;
}
