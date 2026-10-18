import type { ElementImpl } from '../element';

/** HTML content categories, including the categories used by form algorithms. */
// https://html.spec.whatwg.org/multipage/dom.html#kinds-of-content
// https://html.spec.whatwg.org/multipage/forms.html#categories
export enum ContentCategory {
  Metadata,
  Flow,
  Sectioning,
  Heading,
  Phrasing,
  Embedded,
  Interactive,
  Palpable,
  ScriptSupporting,
  FormAssociated,
  Listed,
  Labelable,
  Submittable,
  Resettable,
  AutocapitalizeAndAutocorrectInheriting,
}

/** Author-conforming text/attribute characters; DOM storage does not enforce this restriction. */
// https://html.spec.whatwg.org/multipage/dom.html#text-content
export function isValidHTMLText(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if ((code >= 0xD800 && code <= 0xDFFF) || (code >= 0xFDD0 && code <= 0xFDEF) ||
      (code & 0xFFFF) >= 0xFFFE) return false;
    if ((code < 0x20 && code !== 0x09 && code !== 0x0A && code !== 0x0C && code !== 0x0D) ||
      (code >= 0x7F && code <= 0x9F)) return false;
  }
  return true;
}

/** Shared requirements for children and descendants, independent of when a consumer checks them. */
// https://html.spec.whatwg.org/multipage/dom.html#content-models
// Consumers exclude nodes identified by NodeImpl.isIgnoredHTMLContent().
export type ContentModel = {
  /** All rules must hold for the same children; [] imposes no constraints, unlike an empty-content rule. */
  children: ContentRule[];
  /** A descendant must not match any of these rules, at any depth. */
  forbiddenDescendants?: DescendantRule[];
};

/** Child sequence grammar; category and element rules each describe one matching node. */
export type ContentRule =
  | EmptyContentRule
  | TextContentRule
  | CategoryContentRule
  | ElementContentRule
  | SequenceContentRule
  | RepeatedContentRule
  | TransparentContentRule;

/** Restrictions on individual descendant elements, separate from the direct-child sequence. */
export type DescendantRule = CategoryContentRule | ElementContentRule | AttributeContentRule;

/** No content after ignoring the nodes excluded by the content-model rules. */
export type EmptyContentRule = { kind: 'empty'; };

/** Only Text nodes, after ignoring the nodes excluded by the content-model rules. */
export type TextContentRule = { kind: 'text'; };

/** A node in this category, including Text where the category permits it. */
export type CategoryContentRule = {
  kind: 'category';
  category: ContentCategory;
};

/** An element identified by its implementation, including derived implementations. */
export type ElementContentRule = {
  kind: 'element';
  implementation: typeof ElementImpl;
};

/** Child rules matched in the given order. */
export type SequenceContentRule = {
  kind: 'sequence';
  rules: ContentRule[];
};

/** Repetition bounds; an absent maximum is unbounded. */
export type RepeatedContentRule = {
  kind: 'repeat';
  rule: ContentRule;
  min: number;
  max?: number;
};

/** The content permitted at this position by the surrounding model; orphan elements use flow content. */
// https://html.spec.whatwg.org/multipage/dom.html#transparent-content-models
export type TransparentContentRule = { kind: 'transparent'; };

/** A descendant with this namespace-less content attribute, regardless of its value. */
export type AttributeContentRule = {
  kind: 'attribute';
  name: string;
};

export const emptyContent: EmptyContentRule = { kind: 'empty' };
export const textContent: TextContentRule = { kind: 'text' };

export const flowContent: RepeatedContentRule = {
  kind: 'repeat',
  rule: { kind: 'category', category: ContentCategory.Flow },
  min: 0,
};

export const phrasingContent: RepeatedContentRule = {
  kind: 'repeat',
  rule: { kind: 'category', category: ContentCategory.Phrasing },
  min: 0,
};
