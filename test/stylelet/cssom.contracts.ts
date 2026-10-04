import type { DOMDocument, DOMElement, DOMProcessingInstruction } from '../../src/infra/dom-operations';
import type { CSSStyleSheetInit } from '../../src/stylelet/cssom/css-stylesheet';
import type { MediaListImpl } from '../../src/stylelet/cssom/media-list';
import type { StyleSheetImpl } from '../../src/stylelet/cssom/stylesheet';
import type { StyleletURLConstructor } from '../../src/stylelet/environment';
import { URLImpl } from '../../src/url/index';

// Both providers satisfy the host-neutral surface without platform-type casts.
export const nativeURL: StyleletURLConstructor = URL;
export const browletURL: StyleletURLConstructor = URLImpl;

// Compile-only contracts. The function is never executed.
export function stylesheetTypes(element: DOMElement, instruction: DOMProcessingInstruction, document: DOMDocument, media: MediaListImpl): void {
  const owners: StyleSheetImpl['ownerNode'][] = [element, instruction, null];
  // @ts-expect-error A document cannot own a stylesheet.
  owners.push(document);

  const options: CSSStyleSheetInit = { baseURL: null, media, disabled: true };
  // @ts-expect-error Options accept the MediaList implementation, not a platform-shaped substitute.
  options.media = { mediaText: 'screen' };
}
