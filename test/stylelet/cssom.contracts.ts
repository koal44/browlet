import type { DOMDocument, DOMElement, DOMProcessingInstruction } from '../../src/infra/dom-operations';
import type { CSSStyleSheetInit } from '../../src/stylelet/cssom/css-stylesheet';
import type { MediaListImpl } from '../../src/stylelet/cssom/media/media-list';
import type { StyleSheetImpl } from '../../src/stylelet/cssom/stylesheet';
import { Stylelet, type StyleletEnvironment } from '../../src/stylelet/index';

// Compile-only contracts. The function is never executed.
export function stylesheetTypes(
  element: DOMElement, instruction: DOMProcessingInstruction, document: DOMDocument,
  media: MediaListImpl, env: StyleletEnvironment,
): void {
  const owners: StyleSheetImpl['ownerNode'][] = [element, instruction, null];
  // @ts-expect-error A document cannot own a stylesheet.
  owners.push(document);

  const options: CSSStyleSheetInit = { baseURL: null, media, disabled: true };
  // @ts-expect-error Options accept the MediaList implementation, not a platform-shaped substitute.
  options.media = { mediaText: 'screen' };

  Stylelet.create(document, { env });
  // @ts-expect-error The owning host must supply an environment.
  Stylelet.create(document);
  // @ts-expect-error Options must contain the owning environment.
  Stylelet.create(document, {});
}
