import type { DocumentImpl } from '../document';
import type { ElementImpl } from '../element';
import type { TextImpl } from '../text';

import { ContentCategory, modelAllowsImplicitParagraphs, resolveContentModelTransparency } from './content-model';
import { ElementTag } from './element-tag';

/**
 * Discover all paragraphs in a document, outer runs before their nested paragraphs.
 * Whole-document scope preserves runs spanning a/ins/del/map boundaries.
 * Results retain node identities and describe the tree at the time of this call.
 */
// https://html.spec.whatwg.org/multipage/dom.html#paragraphs
export function getParagraphs(document: DocumentImpl): ParagraphRecord[] {
  const paragraphs: ParagraphRecord[] = [];
  const children: (ElementImpl | TextImpl)[] = [];
  collectParagraphChildren(document, children);
  for (const child of children) {
    if (child.isElement()) collectParagraphs(child, paragraphs);
  }
  return paragraphs;
}

/** A snapshot description using original DOM identities; no live Range or mutation tracking. */
export type ParagraphRecord = ExplicitParagraph | ImplicitParagraph;

/** A paragraph formed by a p element, including an empty one. */
export type ExplicitParagraph = { kind: 'explicit'; element: ElementImpl; };

/** The interval immediately before first through immediately after last in the original DOM. */
export type ImplicitParagraph = { kind: 'implicit'; first: ElementImpl | TextImpl; last: ElementImpl | TextImpl; };

/** Append paragraphs rooted at a retained view element, placing outer runs before nested paragraphs. */
function collectParagraphs(element: ElementImpl, paragraphs: ParagraphRecord[]): void {
  const explicit = element.tag === ElementTag.HTMLP;
  if (explicit) paragraphs.push({ kind: 'explicit', element });
  if (element.firstChild === null) return;

  const children: (ElementImpl | TextImpl)[] = [];
  collectParagraphChildren(element, children);
  if (explicit) {
    for (const child of children) {
      if (child.isElement()) collectParagraphs(child, paragraphs);
    }
    return;
  }

  let allowsImplicit: boolean | undefined;
  let start = 0;
  let significant = false;
  // The final iteration closes any run that reaches the end of the child list.
  for (let index = 0; index <= children.length; index++) {
    const child = children[index];
    if (child !== undefined && child.hasCategory(ContentCategory.Phrasing)) {
      if (!significant) {
        significant = child.isText() ? !child.isInterElementWhitespace() : !child.hasCategory(ContentCategory.Embedded);
      }
      continue;
    }

    if (significant && (allowsImplicit ??= modelAllowsImplicitParagraphs(resolveContentModelTransparency(element)))) {
      paragraphs.push({ kind: 'implicit', first: children[start]!, last: children[index - 1]! });
    }
    // Retain outer-before-inner ordering, including overlapping embedded fallback paragraphs.
    for (let position = start; position < index; position++) {
      const descendant = children[position]!;
      if (descendant.isElement()) collectParagraphs(descendant, paragraphs);
    }
    if (child?.isElement()) collectParagraphs(child, paragraphs);
    start = index + 1;
    significant = false;
  }
}

/** Whether the paragraph view replaces this element with its contents; other transparent elements remain. */
function isFlattenedForParagraphs(element: ElementImpl): boolean {
  return element.tag === ElementTag.HTMLA || element.tag === ElementTag.HTMLIns ||
    element.tag === ElementTag.HTMLDel || element.tag === ElementTag.HTMLMap;
}

/** Append children in the paragraph view, flattening a/ins/del/map and omitting non-element, non-text nodes. */
function collectParagraphChildren(parent: DocumentImpl | ElementImpl, children: (ElementImpl | TextImpl)[]): void {
  for (let node = parent.firstChild; node !== null; node = node.nextSibling) {
    if (node.isElement()) {
      if (isFlattenedForParagraphs(node)) collectParagraphChildren(node, children);
      else children.push(node);
    } else if (node.isText()) {
      children.push(node);
    }
  }
}
