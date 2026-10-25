import { asciiLower } from '../../../../../infra/index';

import { splitOnAsciiWhitespace } from '../../../infra/index';
import type { TokenListAttribute } from '../../../token-list';
import type { ElementImpl } from '../../element';

/** Tokens recognized by HTML and by a blocking attribute's DOMTokenList.supports(). */
// https://html.spec.whatwg.org/multipage/urls-and-fetching.html#possible-blocking-token
const possibleBlockingTokens: ReadonlySet<string> = new Set<BlockingToken>(['render']);
/** Attribute definition shared by internal token-list callers and reflected bindings. */
export const blockingAttribute: TokenListAttribute = { name: 'blocking', supportedTokens: possibleBlockingTokens };

// TODO(HTML resource loading): call Element.blockRendering()/unblockRendering() at the
// specified preparation/completion steps and propagate actual blocking into Fetch request flags.

/** Interpret a supported element's blocking attribute without changing its author-visible token list. */
// https://html.spec.whatwg.org/multipage/urls-and-fetching.html#blocking-tokens-set
export function getBlockingTokens(element: ElementImpl): Set<BlockingToken> {
  const value = element.getAttributeNS(null, 'blocking') ?? '';
  const tokens = new Set<BlockingToken>();
  // SPEC_CLASH(blocking-token-case): HTML lowercases tokens; Chromium/WebKit test exact lowercase membership. Follow HTML.
  for (const token of splitOnAsciiWhitespace(asciiLower(value))) {
    if (possibleBlockingTokens.has(token)) tokens.add(token as BlockingToken);
  }
  return tokens;
}

/** A recognized blocking operation, after case folding and removal of unsupported tokens. */
export type BlockingToken = 'render';
