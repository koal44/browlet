import { InternalError } from '../../../../infra/internal-error';

import type { ElementImpl } from '../element';
import type { NodeImpl } from '../node';
import type { TextImpl } from '../text';

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

/**
 * Replace transparent portions with the parent rules that admit this element at its current position.
 * Keep its own and inherited descendant prohibitions without changing the declared model.
 * Return the declaration unchanged when it has no transparent portions; this does not validate its contents.
 */
// https://html.spec.whatwg.org/multipage/dom.html#transparent-content-models
export function resolveContentModelTransparency(element: ElementImpl): ContentModel {
  const model = element.getContentModel();
  if (!model.childRules.some(containsTransparentContent)) return model;

  const surrounding = getInheritedContentModel(element);
  const childRules: ChildRule[] = [];
  for (const rule of model.childRules) {
    if (rule.kind === 'transparent') {
      for (const inherited of surrounding.childRules) childRules.push(inherited);
    } else {
      childRules.push(replaceTransparentRules(rule, surrounding.childRules));
    }
  }
  const forbiddenDescendants = [
    ...(surrounding.forbiddenDescendants ?? []), ...(model.forbiddenDescendants ?? []),
  ];
  return forbiddenDescendants.length === 0 ? { childRules } : { childRules, forbiddenDescendants };
}

/** Whether a supported model permits implicit paragraphs: general phrasing content alongside non-phrasing content. */
export function modelAllowsImplicitParagraphs(model: ContentModel): boolean {
  if (model.childRules.length === 0) return true;
  if (model.childRules.length !== 1) {
    // TODO: Evaluate intersections of independent child requirements.
    throw new InternalError('Paragraph eligibility for intersecting content rules is not implemented');
  }
  return ruleAllowsImplicitParagraphs(model.childRules[0]!);
}

/** Shared requirements for children and descendants, independent of when a consumer checks them. */
// https://html.spec.whatwg.org/multipage/dom.html#content-models
// Consumers exclude nodes identified by NodeImpl.isIgnoredHTMLContent().
export type ContentModel = {
  /** All rules must hold for the same children; [] imposes no constraints, unlike an empty-content rule. */
  childRules: ChildRule[];
  /** A descendant must not match any of these rules, at any depth. */
  forbiddenDescendants?: DescendantRule[];
};

/** Child sequence grammar; category and element rules each describe one matching node. */
export type ChildRule =
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
  rules: ChildRule[];
};

/** Repetition bounds; an absent maximum is unbounded. */
export type RepeatedContentRule = {
  kind: 'repeat';
  rule: ChildRule;
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
export const transparentContent: TransparentContentRule = { kind: 'transparent' };

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

/** Whether a rule contains a transparent placeholder, including within sequences and repetitions. */
function containsTransparentContent(rule: ChildRule): boolean {
  if (rule.kind === 'transparent') return true;
  if (rule.kind === 'sequence') return rule.rules.some(containsTransparentContent);
  if (rule.kind === 'repeat') return containsTransparentContent(rule.rule);
  return false;
}

/**
 * Select the portions of the parent's model that admit this element, retaining descendant prohibitions.
 * Resolve the parent's transparency first; an element with no parent inherits flow content.
 */
function getInheritedContentModel(element: ElementImpl): ContentModel {
  const parent = element.parentNode;
  if (parent === null) return { childRules: [flowContent] };
  if (!parent.isElement()) {
    // TODO: Document and DocumentFragment parent content-model contracts.
    throw new InternalError('Transparent content under a non-element parent is not implemented');
  }
  const model = resolveContentModelTransparency(parent);
  const childRules: ChildRule[] = [];
  for (const rule of model.childRules) childRules.push(getRuleAtChildPosition(rule, element));
  return { ...model, childRules };
}

/**
 * Substitute the supplied parent rules for transparent placeholders without changing the enclosing grammar.
 * A nested placeholder currently accepts only one inherited rule; top-level intersections are handled separately.
 */
function replaceTransparentRules(rule: ChildRule, surrounding: ChildRule[]): ChildRule {
  if (rule.kind === 'transparent') {
    if (surrounding.length !== 1) {
      // TODO: Intersections inside a sequence/repetition need a richer grammar node.
      throw new InternalError('Nested transparent intersections are not implemented');
    }
    return surrounding[0]!;
  }
  if (rule.kind === 'sequence') {
    const rules: ChildRule[] = [];
    for (const part of rule.rules) rules.push(replaceTransparentRules(part, surrounding));
    return { ...rule, rules };
  }
  if (rule.kind === 'repeat') return { ...rule, rule: replaceTransparentRules(rule.rule, surrounding) };
  return rule;
}

/**
 * Select the part of a parent's child rule that admits this child's current position.
 * Support homogeneous repetitions and fixed single-node prefixes followed by a homogeneous tail.
 */
function getRuleAtChildPosition(rule: ChildRule, child: ElementImpl): ChildRule {
  if (rule.kind === 'repeat' && rule.max === undefined && rule.min === 0 &&
    (rule.rule.kind === 'category' || rule.rule.kind === 'element')) {
    if (matchesContentNode(rule.rule, child)) return rule;
    throw new InternalError(`No content-model portion accepts ${child.localName}`);
  }
  if (rule.kind === 'sequence') {
    // Fixed single-node prefixes followed by a homogeneous tail, as in details.
    // More general sequences need the future content-model matcher to identify a position.
    let node = nextContentModelNode(child.parentNode!.firstChild);
    for (let index = 0; index < rule.rules.length; index++) {
      const part = rule.rules[index]!;
      if (index === rule.rules.length - 1) {
        if (part.kind === 'repeat') return getRuleAtChildPosition(part, child);
        break;
      }
      if (part.kind !== 'category' && part.kind !== 'element') break;
      if (node === null || !matchesContentNode(part, node)) {
        throw new InternalError('The child does not occupy a supported content-model position');
      }
      if (node === child) return part;
      node = nextContentModelNode(node.nextSibling);
    }
  }
  // TODO: General sequence, repetition, and conditional-model position matching.
  throw new InternalError(`Content-model position matching for ${rule.kind} is not implemented`);
}

/** Test one element or text node against a category or implementation requirement. */
function matchesContentNode(rule: CategoryContentRule | ElementContentRule, node: ElementImpl | TextImpl): boolean {
  if (rule.kind === 'element') return node instanceof rule.implementation;
  return node.hasCategory(rule.category);
}

/** Find the next element or text other than inter-element whitespace, including the starting sibling. */
function nextContentModelNode(node: NodeImpl | null): ElementImpl | TextImpl | null {
  for (; node !== null; node = node.nextSibling) {
    if (node.isElement() || (node.isText() && !node.isInterElementWhitespace())) return node;
  }
  return null;
}

/** Whether a supported child rule permits general phrasing and non-phrasing content, allowing implicit paragraphs. */
function ruleAllowsImplicitParagraphs(rule: ChildRule): boolean {
  switch (rule.kind) {
    case 'empty':
    case 'text':
    case 'element':
      return false;
    case 'category':
      if (rule.category === ContentCategory.Flow) return true;
      if (rule.category === ContentCategory.Phrasing) return false;
      break;
    case 'repeat':
      return rule.max !== 0 && ruleAllowsImplicitParagraphs(rule.rule);
    case 'sequence':
      return rule.rules.some(ruleAllowsImplicitParagraphs);
  }
  // TODO: Classify other category mixtures as their content models acquire consumers.
  throw new InternalError(`Paragraph eligibility for ${rule.kind} content is not implemented`);
}
