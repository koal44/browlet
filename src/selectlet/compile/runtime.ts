import {
  type DOMOperations, type DOMNode as Element, type DOMNode as Node, type DOMNode as ParentNode,
  XML_NAMESPACE,
} from '../../infra/index';
import {
  asciiDashMatch, asciiEndsWith, asciiEquals, hasAsciiWhitespaceToken, asciiIncludes, asciiStartsWith,
} from '../../infra/selector-matching';
import { asciiLower, hasWhitespaceToken } from '../../infra/ascii';
import {
  isFormStateElement, isHtmlSvgOrMathNamespace,
} from '../../infra/selector-dom';
import type { SelectletContext } from '../context';
import type { RuntimeCache } from './runtimeCache';

export function nextDescendant(root: Element, node: Element, dom: DOMOperations): Element | null {
  const child = dom.firstElementChild(node);
  if (child) return child;

  while (node !== root) {
    const sibling = dom.nextElementSibling(node);
    if (sibling) return sibling;

    const parent = dom.parentElement(node);
    if (!parent) return null;

    node = parent;
  }

  return null;
}

export function checkId(e: Element, id: string, ctx: SelectletContext): boolean {
  return ctx.dom.getId(e) === id;
}

export function checkClass(e: Element, cls: string, ctx: SelectletContext): boolean {
  return ctx.getClassRegex(cls).test(ctx.dom.getClass(e));
}

export function checkTag(e: Element, lowerTag: string, tag: string, ctx: SelectletContext): boolean {
  // perf if lowerTag==tag, but only caller already checks, so no null lowerTag case here
  const localName = ctx.dom.getLocalName(e);
  return ctx.isHtml && ctx.dom.isHTMLElement(e) ? localName === lowerTag : localName === tag;
}

export function hasAttr(
  e: Element,
  anyNs: boolean,
  name: string,
  htmlName: string | null, // null implies same as name
  hasColonName: boolean,
  ctx: SelectletContext
): boolean {
  // Fast path for non-namespaced attributes without colons, which are common in HTML and SVG
  if (!anyNs && !hasColonName) {
    return ctx.dom.hasAttribute(e, name);
  }

  const attrs = ctx.dom.attributes(e);
  const expected = htmlName !== null && ctx.isHtml && ctx.dom.isHTMLElement(e) ? htmlName : name;

  if (anyNs) {
    for (const attr of attrs) {
      if (ctx.dom.attributeLocalName(attr) === expected) return true;
    }
    return false;
  }

  for (const attr of attrs) {
    if (ctx.dom.attributeLocalName(attr) === expected && ctx.dom.attributeNamespaceURI(attr) === null) return true;
  }

  return false;
}

export function matchAttribute(
  e: Element,
  anyNs: boolean,
  name: string,
  htmlName: string | null, // null implies same as name
  hasColonName: boolean,
  pattern: string,
  expected: string,
  htmlExpected: string,
  sensitivity: number,
  ctx: SelectletContext
): boolean {
  if (!anyNs && !hasColonName) {
    const attrValue = ctx.dom.getAttribute(e, name);

    const insensitive = sensitivity === 1 || (sensitivity === 2 && ctx.isHtml && ctx.dom.isHTMLElement(e));
    return attrValue !== null &&
      matchAttrValueOp(attrValue, pattern, expected, htmlExpected, insensitive, ctx);
  }

  let expectedName = name;
  let insensitive = sensitivity === 1;

  const needsHtmlInfo = htmlName !== null || sensitivity === 2;
  if (needsHtmlInfo && ctx.isHtml) {
    const isHtml = ctx.dom.isHTMLElement(e);

    if (isHtml) {
      if (htmlName !== null) expectedName = htmlName;
      if (sensitivity === 2) insensitive = true;
    }
  }

  const attrs = ctx.dom.attributes(e);

  if (anyNs) {
    for (const attr of attrs) {
      if (
        ctx.dom.attributeLocalName(attr) === expectedName &&
        matchAttrValueOp(ctx.dom.attributeValue(attr), pattern, expected, htmlExpected, insensitive, ctx)
      ) {
        return true;
      }
    }

    return false;
  }

  for (const attr of attrs) {
    if (
      ctx.dom.attributeLocalName(attr) === expectedName &&
      ctx.dom.attributeNamespaceURI(attr) === null &&
      matchAttrValueOp(ctx.dom.attributeValue(attr), pattern, expected, htmlExpected, insensitive, ctx)
    ) {
      return true;
    }
  }

  return false;
}

function matchAttrValueOp(
  attrValue: string,
  pattern: string,
  expected: string,
  htmlExpected: string,
  insensitive: boolean,
  ctx: SelectletContext
): boolean {
  // For ASCII-insensitive matching, avoid asciiLower(attrValue) in the hot path.
  if (insensitive) {
    switch (pattern) {
      case '=': return asciiEquals(attrValue, htmlExpected);
      case '^': return asciiStartsWith(attrValue, htmlExpected);
      case '$': return asciiEndsWith(attrValue, htmlExpected);
      case '|': return asciiDashMatch(attrValue, htmlExpected);
      case '*': return asciiIncludes(attrValue, htmlExpected);
      case '~': return hasAsciiWhitespaceToken(attrValue, htmlExpected);
      case '~R': return ctx.getCssTokenRegex(expected, true).test(attrValue);
      default: return ctx.getCachedRegex(pattern, true /* ignoreCase */).test(attrValue);
    }
  }

  switch (pattern) {
    case '=': return attrValue === expected;
    case '^': return attrValue.startsWith(expected);
    case '$': return attrValue.endsWith(expected);
    case '*': return attrValue.includes(expected);
    case '~': return hasWhitespaceToken(attrValue, expected);
    case '~R': return ctx.getCssTokenRegex(expected, false).test(attrValue);
    case '|':
      return attrValue === expected ||
        (
          attrValue.length > expected.length &&
          attrValue.at(expected.length) === '-' &&
          attrValue.startsWith(expected)
        );

    default: return ctx.getCachedRegex(pattern, false /* ignoreCase */).test(attrValue);
  }
}

// :scope
export function isScope(e: Element, ctx: SelectletContext): boolean {
  return e === ctx.scopeEl;
}

// :root
export function isRoot(e: Element, ctx: SelectletContext): boolean {
  return e === ctx.root;
}

// :empty
export function isEmpty(e: Element, ctx: SelectletContext): boolean {
  let n = ctx.dom.firstChild(e);

  while (n && !ctx.dom.isElement(n) && !ctx.dom.isText(n)) {
    n = ctx.dom.nextSibling(n);
  }

  return !n;
}

// :first-child
export function isFirstChild(e: Element, ctx: SelectletContext): boolean {
  return !ctx.dom.previousElementSibling(e);
}

// :last-child
export function isLastChild(e: Element, ctx: SelectletContext): boolean {
  return !ctx.dom.nextElementSibling(e);
}

// :only-child
export function isOnlyChild(e: Element, ctx: SelectletContext): boolean {
  return !ctx.dom.previousElementSibling(e) && !ctx.dom.nextElementSibling(e);
}

// :first-of-type
export function isFirstOfType(e: Element, ctx: SelectletContext): boolean {
  const localName = ctx.dom.getLocalName(e);
  const namespaceURI = ctx.dom.getNamespaceURI(e);

  let n: Element | null = e;

  while ((n = ctx.dom.previousElementSibling(n)) && (ctx.dom.getLocalName(n) !== localName || ctx.dom.getNamespaceURI(n) !== namespaceURI)) {
    // walk
  }

  return !n;
}

// :last-of-type
export function isLastOfType(e: Element, ctx: SelectletContext): boolean {
  const localName = ctx.dom.getLocalName(e);
  const namespaceURI = ctx.dom.getNamespaceURI(e);

  let n: Element | null = e;

  while ((n = ctx.dom.nextElementSibling(n)) && (ctx.dom.getLocalName(n) !== localName || ctx.dom.getNamespaceURI(n) !== namespaceURI)) {
    // walk
  }

  return !n;
}

// :only-of-type
export function isOnlyOfType(e: Element, ctx: SelectletContext): boolean {
  const localName = ctx.dom.getLocalName(e);
  const namespaceURI = ctx.dom.getNamespaceURI(e);

  let n: Element | null = e;

  while ((n = ctx.dom.nextElementSibling(n)) && (ctx.dom.getLocalName(n) !== localName || ctx.dom.getNamespaceURI(n) !== namespaceURI)) {
    // walk
  }

  if (n) return false;

  n = e;

  while ((n = ctx.dom.previousElementSibling(n)) && (ctx.dom.getLocalName(n) !== localName || ctx.dom.getNamespaceURI(n) !== namespaceURI)) {
    // walk
  }

  return !n;
}

export function matchesNthIndex(n: number, step: number, absStep: number, offset: number, _ctx: SelectletContext): boolean {
  if (step === 0) {
    throw new Error(`Invalid nth-child step value: ${step}; should have been handled earlier`);
  }

  const congruent = (n - offset) % absStep === 0;
  return step > 0
    ? n >= offset && congruent
    : n <= offset && congruent;
}

export type NthElementIndexMap = WeakMap<Element, number>;

// fast resolver for :nth-child() and :nth-last-child()
// use cache if available to get the 1-based index of element among its siblings
export function nthElement(element: Element, fromLast: boolean, rc: RuntimeCache | null, ctx: SelectletContext): number {
  if (!rc) return nthElementLocal(element, fromLast, ctx.dom);

  const parent = ctx.dom.parentNode(element);
  if (!parent) return 1; // detached/rootless/root

  const cache = rc.nthElement ??= new WeakMap<ParentNode, NthElementIndexMap>();

  let indexMap = cache.get(parent);
  if (!indexMap) {
    indexMap = new WeakMap<Element, number>();

    let index = 0;
    for (let node = ctx.dom.firstElementChild(parent); node; node = ctx.dom.nextElementSibling(node)) {
      indexMap.set(node, index++);
    }
    cache.set(parent, indexMap);
  }

  const index = indexMap.get(element);
  if (index === undefined) {
    throw new Error('nthElement cache did not contain the target element');
  }

  return fromLast ? ctx.dom.childElementCount(parent) - index : index + 1;
}

function nthElementLocal(element: Element, fromLast: boolean, dom: DOMOperations): number {
  let n = 1;
  let e: Element | null = element;

  while ((e = fromLast ? dom.nextElementSibling(e) : dom.previousElementSibling(e))) {
    n++;
  }

  return n;
}

export type NthOfTypeParentMap = Map<string, NthOfTypeIndexEntry>;
type NthOfTypeIndexEntry = {
  length: number;
  indexMap: WeakMap<Element, number>;
};

// fast resolver for :nth-of-type() and :nth-last-of-type()
// use cache if available to get the 1-based index of element among same-type siblings
export function nthOfType(element: Element, fromLast: boolean, rc: RuntimeCache | null, ctx: SelectletContext): number {
  if (!rc) return nthOfTypeLocal(element, fromLast, ctx);

  const parent = ctx.dom.parentNode(element);
  if (!parent) return 1;

  const namespaceURI = ctx.dom.getNamespaceURI(element);
  const localName = ctx.dom.getLocalName(element);
  const typeKey = `${namespaceURI ?? ''}\x00${localName}`;

  const cache = rc.nthOfType ??= new WeakMap<ParentNode, NthOfTypeParentMap>();

  let typeMap = cache.get(parent);
  if (!typeMap) {
    typeMap = new Map<string, NthOfTypeIndexEntry>();
    cache.set(parent, typeMap);
  }

  let entry = typeMap.get(typeKey);
  if (!entry) {
    const indexMap = new WeakMap<Element, number>();

    let index = 0;
    for (let n = ctx.dom.firstElementChild(parent); n; n = ctx.dom.nextElementSibling(n)) {
      if (ctx.dom.getLocalName(n) === localName && ctx.dom.getNamespaceURI(n) === namespaceURI) {
        indexMap.set(n, index++);
      }
    }

    entry = { length: index, indexMap };
    typeMap.set(typeKey, entry);
  }

  const index = entry.indexMap.get(element);
  if (index === undefined) {
    throw new Error('nthOfType cache did not contain the target element');
  }

  return fromLast ? entry.length - index : index + 1;
}

function nthOfTypeLocal(element: Element, fromLast: boolean, ctx: SelectletContext): number {
  const namespaceURI = ctx.dom.getNamespaceURI(element);
  const localName = ctx.dom.getLocalName(element);
  let n = 1;
  let e: Element | null = element;

  while ((e = fromLast ? ctx.dom.nextElementSibling(e) : ctx.dom.previousElementSibling(e))) {
    if (ctx.dom.getLocalName(e) === localName && ctx.dom.getNamespaceURI(e) === namespaceURI) {
      n++;
    }
  }

  return n;
}

export function isNthElement(element: Element, index: number, fromLast: boolean, rc: RuntimeCache | null, ctx: SelectletContext): boolean {
  if (!rc) return isNthElementLocal(element, index, fromLast, ctx.dom);
  return nthElement(element, fromLast, rc, ctx) === index;
}

export function isNthOfType(element: Element, index: number, fromLast: boolean, rc: RuntimeCache | null, ctx: SelectletContext): boolean {
  if (!rc) return isNthOfTypeLocal(element, index, fromLast, ctx);
  return nthOfType(element, fromLast, rc, ctx) === index;
}

function isNthElementLocal(element: Element, target: number, fromLast: boolean, dom: DOMOperations): boolean {
  if (target < 1) {
    throw new Error(`Invalid nth-child index: ${target}`);
  }

  const parent = dom.parentNode(element);
  if (!parent) return target === 1;

  const length = dom.childElementCount(parent);
  if (target > length) return false;

  const forwardTarget = fromLast ? length - target + 1 : target;

  let node: Element | null;

  if (forwardTarget <= length - forwardTarget + 1) {
    node = dom.firstElementChild(parent);
    for (let i = 1; node && i < forwardTarget; ++i) {
      node = dom.nextElementSibling(node);
    }
  } else {
    node = dom.lastElementChild(parent);
    for (let i = length; node && i > forwardTarget; --i) {
      node = dom.previousElementSibling(node);
    }
  }

  return node === element;
}

function isNthOfTypeLocal(element: Element, target: number, fromLast: boolean, ctx: SelectletContext): boolean {
  if (target < 1) {
    throw new Error(`Invalid nth-of-type index: ${target}`);
  }

  const parent = ctx.dom.parentNode(element);
  if (!parent) return target === 1;

  const namespaceURI = ctx.dom.getNamespaceURI(element);
  const localName = ctx.dom.getLocalName(element);

  let index = 0;

  if (!fromLast) {
    for (let n = ctx.dom.firstElementChild(parent); n; n = ctx.dom.nextElementSibling(n)) {
      if (ctx.dom.getLocalName(n) === localName && ctx.dom.getNamespaceURI(n) === namespaceURI) {
        ++index;
        if (n === element) return index === target;
        if (index >= target) return false;
      }
    }
  } else {
    for (let n = ctx.dom.lastElementChild(parent); n; n = ctx.dom.previousElementSibling(n)) {
      if (ctx.dom.getLocalName(n) === localName && ctx.dom.getNamespaceURI(n) === namespaceURI) {
        ++index;
        if (n === element) return index === target;
        if (index >= target) return false;
      }
    }
  }

  return false;
}

export function isFocused(el: Element, ctx: SelectletContext): boolean {
  const doc = ctx.dom.ownerDocument(el)!;
  if (ctx.dom.getLocalName(el) === 'iframe') return false;

  if (el === ctx.dom.body(doc) || el === ctx.dom.documentElement(doc)) {
    return el === ctx.focusTarget && ctx.dom.hasFocus(doc);
  }

  return el === ctx.dom.activeElement(doc) && ctx.dom.hasFocus(doc);
}

export function matchLang(wanted: string, element: Element, ctx: SelectletContext): boolean {
  wanted = asciiLower(wanted);

  for (let node: Element | null = element; node; node = langParent(node, ctx.dom)) {
    const actual = elementLanguage(node, ctx);

    if (actual !== null) {
      if (actual === '') return false;

      return extendedLangMatch(wanted, asciiLower(actual));
    }
  }

  return false;
}

export function extendedLangMatch(range: string, lang: string): boolean {
  const rangeParts = range.split('-');
  const langParts = lang.split('-');

  if (rangeParts.length === 0 || langParts.length === 0) return false;

  if (rangeParts[0] !== '*' && rangeParts[0] !== langParts[0]) {
    return false;
  }

  let ri = 1;
  let li = 1;

  while (ri < rangeParts.length) {
    const r = rangeParts[ri]!;

    if (r === '*') {
      ri++;
      continue;
    }

    if (li >= langParts.length) {
      return false;
    }

    const l = langParts[li]!;

    if (r === l) {
      ri++;
      li++;
      continue;
    }

    if (l.length === 1) {
      return false;
    }

    li++;
  }

  return true;
}

function langParent(element: Element, dom: DOMOperations): Element | null {
  const parent = dom.parentElement(element);
  if (parent) return parent;

  const root = dom.root(element);

  if (dom.isShadowRoot(root)) {
    return dom.shadowHost(root);
  }

  return null;
}

function elementLanguage(element: Element, ctx: SelectletContext): string | null {
  const lang = ctx.dom.getAttribute(element, 'lang');
  if (lang !== null) return lang;

  return ctx.dom.getAttributeNS(element, XML_NAMESPACE, 'lang');
}

export function matchDir(wanted: string, element: Element, ctx: SelectletContext): boolean {
  return elementDir(element, ctx) === wanted;
}

function elementDir(element: Element, ctx: SelectletContext): 'ltr' | 'rtl' {
  const local = ctx.dom.getLocalName(element);

  if (ctx.dom.isHTMLElement(element)) {
    if (local === 'input') return inputDir(element, ctx);
    if (local === 'textarea') return textareaDir(element, ctx);
    if (local === 'bdi') return bdiDir(element, ctx);
  }

  return attrDir(element, ctx);
}

function attrDir(element: Element, ctx: SelectletContext): 'ltr' | 'rtl' {
  const attr = ctx.dom.getAttribute(element, 'dir');

  if (attr) {
    const dir = attr.toLowerCase();

    if (dir === 'ltr' || dir === 'rtl') return dir;
    if (dir === 'auto') return autoDirFromElement(element, ctx) ?? 'ltr';
  }

  const parent = ctx.dom.parentElement(element);
  return parent ? elementDir(parent, ctx) : 'ltr';
}

function bdiDir(element: Element, ctx: SelectletContext): 'ltr' | 'rtl' {
  const attr = ctx.dom.getAttribute(element, 'dir');

  if (attr) {
    const dir = attr.toLowerCase();

    if (dir === 'ltr' || dir === 'rtl') return dir;
    if (dir === 'auto') return autoDirFromElement(element, ctx) ?? 'ltr';
  }

  // <bdi> defaults to auto directionality.
  return autoDirFromElement(element, ctx) ?? 'ltr';
}

function textareaDir(textarea: Element, ctx: SelectletContext): 'ltr' | 'rtl' {
  const attr = ctx.dom.getAttribute(textarea, 'dir');

  if (attr) {
    const dir = attr.toLowerCase();

    if (dir === 'ltr' || dir === 'rtl') return dir;
    if (dir === 'auto') return autoDir(ctx.dom.controlValue(textarea) || '') ?? 'ltr';
  }

  const parent = ctx.dom.parentElement(textarea);
  return parent ? elementDir(parent, ctx) : 'ltr';
}

const inputValueDirTypes = new Set([
  'hidden', 'text', 'search', 'tel', 'url', 'email', 'password', 'submit', 'reset', 'button',
]);

function inputDir(input: Element, ctx: SelectletContext): 'ltr' | 'rtl' {
  const attr = ctx.dom.getAttribute(input, 'dir');
  const type = ctx.dom.controlType(input);

  if (attr) {
    const dir = attr.toLowerCase();

    if (dir === 'ltr' || dir === 'rtl') return dir;

    if (dir === 'auto') {
      return inputValueDirTypes.has(type) ?
        autoDir(ctx.dom.controlValue(input) || '') ?? 'ltr' :
        'ltr';
    }
  }

  if (type === 'tel') return 'ltr';

  const parent = ctx.dom.parentElement(input);
  return parent ? elementDir(parent, ctx) : 'ltr';
}

function autoDirFromElement(element: Element, ctx: SelectletContext): 'ltr' | 'rtl' | null {
  return autoDirFromChildren(element, ctx);
}

function autoDirFromChildren(node: Node, ctx: SelectletContext): 'ltr' | 'rtl' | null {
  for (let child = ctx.dom.firstChild(node); child; child = ctx.dom.nextSibling(child)) {
    if (ctx.dom.isText(child)) {
      const dir = autoDir(ctx.dom.textData(child));
      if (dir) return dir;
      continue;
    }

    if (!ctx.dom.isElement(child)) continue;

    const el = child;

    if (isDirBoundary(el, ctx)) {
      continue;
    }

    const dir = autoDirFromChildren(el, ctx);
    if (dir) return dir;
  }

  return null;
}

function isDirBoundary(element: Element, ctx: SelectletContext): boolean {
  const attr = ctx.dom.getAttribute(element, 'dir');

  if (attr) {
    const dir = attr.toLowerCase();
    if (dir === 'ltr' || dir === 'rtl' || dir === 'auto') return true;
  }

  // <bdi> has default auto directionality, so it should also isolate its text
  // from ancestor dir=auto scans even without an explicit dir attribute.
  return ctx.dom.isHTMLElement(element) && ctx.dom.getLocalName(element) === 'bdi';
}

// TODO: cover more Unicode bidi edge cases.
// Minimal first-strong direction check for :dir(auto) / <bdi>.
function autoDir(text: string): 'ltr' | 'rtl' | null {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);

    if (
      (code >= 0x0590 && code <= 0x08ff) || // Hebrew, Arabic, Syriac, Thaana, etc.
      (code >= 0xfb1d && code <= 0xfdff) || // Hebrew/Arabic presentation forms
      (code >= 0xfe70 && code <= 0xfeff)    // Arabic presentation forms-B
    ) {
      return 'rtl';
    }

    if (
      (code >= 0x0041 && code <= 0x005a) || // Latin uppercase
      (code >= 0x0061 && code <= 0x007a) || // Latin lowercase
      (code >= 0x00c0 && code <= 0x02af) || // Latin extended / IPA
      (code >= 0x0370 && code <= 0x052f)    // Greek and Cyrillic
    ) {
      return 'ltr';
    }
  }

  return null;
}

// :any-link / :link
export function isAnyLink(e: Element, ctx: SelectletContext): boolean {
  const localName = ctx.dom.getLocalName(e);

  if (localName !== 'a' && localName !== 'area') {
    const lower = localName.toLowerCase();
    if (lower !== 'a' && lower !== 'area') return false;
  }

  return ctx.dom.hasAttribute(e, 'href');
}

// :target
export function isTarget(e: Element, ctx: SelectletContext): boolean {
  const url = ctx.dom.URL(ctx.doc);
  const hashIndex = url.indexOf('#');
  const hash = hashIndex < 0 ? '' : url.slice(hashIndex);
  return hash.length > 1 && ctx.dom.getId(e) === hash.slice(1) && !!(ctx.dom.compareDocumentPosition(ctx.doc, e) & 16);
}

// :hover
export function isHovered(e: Element, ctx: SelectletContext): boolean {
  for (let n = ctx.hoverTarget; n; n = ctx.dom.parentElement(n)) {
    if (n === e) return true;
  }

  return false;
}

// :active
export function isActive(e: Element, ctx: SelectletContext): boolean {
  for (let n = ctx.activeTarget; n; n = ctx.dom.parentElement(n)) {
    if (n === e) return true;
  }

  return false;
}

// :focus-within
export function isFocusWithin(e: Element, ctx: SelectletContext): boolean {
  const active = ctx.dom.activeElement(ctx.doc);
  return !!active && (e === active || ctx.dom.contains(e, active));
}

const CUSTOM_ELEMENT_NAME_BLACKLIST = new Set([
  'annotation-xml', 'color-profile', 'font-face', 'font-face-src', 'font-face-uri',
  'font-face-format', 'font-face-name', 'missing-glyph',
]);
const PCEN = String.raw`[-.0-9_a-z\u00B7\u0300-\u036F\u203F-\u2040]`;
// eslint-disable-next-line no-misleading-character-class
const CUSTOM_ELEMENT_NAME = new RegExp(String.raw`^[a-z]${PCEN}*-${PCEN}*$`);

function isPotentialCustomElementName(name: string): boolean {
  return CUSTOM_ELEMENT_NAME.test(name) &&
    !CUSTOM_ELEMENT_NAME_BLACKLIST.has(name);
}

export function isDefined(element: Element, ctx: SelectletContext): boolean {
  if (!ctx.dom.isHTMLElement(element)) return true;

  const name = ctx.dom.getLocalName(element);
  if (!isPotentialCustomElementName(name)) return true;

  return !!ctx.dom.isDefined(ctx.doc, name);
}

export function isDisabled(e: Element, ctx: SelectletContext): boolean {
  return isFormStateElement(ctx.dom.getLocalName(e)) && isDisabledFormStateElement(e, ctx);
}

export function isEnabled(e: Element, ctx: SelectletContext): boolean {
  return isFormStateElement(ctx.dom.getLocalName(e)) && !isDisabledFormStateElement(e, ctx);
}

function isDisabledFormStateElement(e: Element, ctx: SelectletContext): boolean {
  if (ctx.dom.hasAttribute(e, 'disabled')) return true;

  if (ctx.dom.getLocalName(e) === 'option') {
    const parent = ctx.dom.parentElement(e);
    return !!parent && (ctx.dom.getLocalName(parent) === 'optgroup') && ctx.dom.hasAttribute(parent, 'disabled');
  }

  if (ctx.dom.getLocalName(e) === 'optgroup') return false;

  // Ancestor disabled fieldsets may disable form controls, unless the control is
  // inside that fieldset's first legend child.
  for (let n = ctx.dom.parentElement(e); n; n = ctx.dom.parentElement(n)) {
    if (!(ctx.dom.getLocalName(n) === 'fieldset') || !ctx.dom.hasAttribute(n, 'disabled')) continue;

    let exempt = false;

    for (let child = ctx.dom.firstElementChild(n); child; child = ctx.dom.nextElementSibling(child)) {
      if (!(ctx.dom.getLocalName(child) === 'legend')) continue;
      exempt = ctx.dom.contains(child, e);
      break;
    }

    if (exempt) continue;
    return true;
  }

  return false;
}

// https://html.spec.whatwg.org/multipage/semantics-other.html#selector-read-only
const READONLY_APPLIES_INPUT_TYPES = new Set(['date', 'datetime-local', 'email', 'month', 'number', 'password', 'search', 'tel', 'text', 'time', 'url', 'week']);
export function isReadWrite(e: Element, ctx: SelectletContext): boolean {
  if (ctx.dom.getLocalName(e) === 'input') {
    return READONLY_APPLIES_INPUT_TYPES.has(ctx.dom.controlType(e)) && !ctx.dom.hasAttribute(e, 'readonly') && !isDisabled(e, ctx);
  }
  if (ctx.dom.getLocalName(e) === 'textarea') return !ctx.dom.hasAttribute(e, 'readonly') && !isDisabled(e, ctx);
  return isEditingHostOrEditable(e, ctx);
}

function isEditingHostOrEditable(e: Element, ctx: SelectletContext): boolean {
  if (!isHtmlSvgOrMathNamespace(ctx.dom.getNamespaceURI(e))) return false;

  // Editing host: HTML element with contenteditable in the true or plaintext-only state.
  const attr = ctx.dom.getAttribute(e, 'contenteditable')?.toLowerCase();
  if (ctx.dom.isHTMLElement(e) && (attr === '' || attr === 'true' || attr === 'plaintext-only')) {
    return true;
  }

  // Editable: the node itself must not have contenteditable=false.
  if (attr === 'false') {
    return false;
  }

  // Editing host: child HTML element of a Document whose designMode is enabled.
  // DesignMode: eligible descendants of a designMode document are editable unless blocked.
  const designMode = ctx.dom.designMode(ctx.dom.ownerDocument(e)!);
  if (designMode?.toLowerCase() === 'on') {
    for (let n: Element | null = e; n; n = ctx.dom.parentElement(n)) {
      if (ctx.dom.getAttribute(n, 'contenteditable')?.toLowerCase() === 'false') {
        return false;
      }
    }

    return true;
  }

  // Editable: not an editing host, does not have contenteditable=false,
  // parent is an editing host or editable, and the element is HTML/SVG/Math.
  for (let n: Element | null = ctx.dom.parentElement(e); n; n = ctx.dom.parentElement(n)) {
    const parentAttr = ctx.dom.getAttribute(n, 'contenteditable')?.toLowerCase();

    if (parentAttr === 'false') {
      return false;
    }

    if (ctx.dom.isHTMLElement(n) && (parentAttr === '' || parentAttr === 'true' || parentAttr === 'plaintext-only')) {
      return true;
    }
  }

  return false;
}

const PLACEHOLDER_INPUT_TYPES = new Set(['email', 'number', 'password', 'search', 'tel', 'text', 'url']);

export function isPlaceholderShown(e: Element, ctx: SelectletContext): boolean {
  if (!ctx.dom.hasAttribute(e, 'placeholder')) return false;

  if (ctx.dom.getLocalName(e) === 'textarea') {
    return ctx.dom.controlValue(e) === '';
  }

  if (ctx.dom.getLocalName(e) === 'input') {
    return PLACEHOLDER_INPUT_TYPES.has(ctx.dom.controlType(e)) && ctx.dom.controlValue(e) === '';
  }

  return false;
}

const DOCUMENT_POSITION_FOLLOWING = 4;

export function isDefault(e: Element, ctx: SelectletContext): boolean {
  if (ctx.dom.getLocalName(e) === 'option') return ctx.dom.hasAttribute(e, 'selected');

  const isInput = ctx.dom.getLocalName(e) === 'input';
  if (isInput && (ctx.dom.controlType(e) === 'checkbox' || ctx.dom.controlType(e) === 'radio')) {
    return ctx.dom.hasAttribute(e, 'checked');
  }

  const isButton = ctx.dom.getLocalName(e) === 'button';
  if (!isInput && !isButton) return false;

  const isSubmit =
    (isInput && (ctx.dom.controlType(e) === 'submit' || ctx.dom.controlType(e) === 'image')) ||
    (isButton && ctx.dom.controlType(e) === 'submit');

  if (!isSubmit) return false;

  // find the first submit button, which may be in or outside the form
  const form = ctx.dom.formOwner(e);
  if (!form) return false;

  let firstInput: Element | null = null;
  const inputs = ctx.dom.getElementsByTagName(ctx.dom.ownerDocument(e)!, 'input');
  for (const input of inputs) {
    if (ctx.dom.formOwner(input) === form && (ctx.dom.controlType(input) === 'submit' || ctx.dom.controlType(input) === 'image')) {
      firstInput = input;
      break;
    }
  }

  let firstButton: Element | null = null;
  const buttons = ctx.dom.getElementsByTagName(ctx.dom.ownerDocument(e)!, 'button');
  for (const button of buttons) {
    if (ctx.dom.formOwner(button) === form && ctx.dom.controlType(button) === 'submit') {
      firstButton = button;
      break;
    }
  }

  const firstSubmit =
    !firstInput ? firstButton :
    !firstButton ? firstInput :
    (ctx.dom.compareDocumentPosition(firstInput, firstButton) & DOCUMENT_POSITION_FOLLOWING)
      ? firstInput
      : firstButton;

  return firstSubmit === e;
}

export function isChecked(e: Element, ctx: SelectletContext): boolean {
  if (ctx.dom.getLocalName(e) === 'input') return (ctx.dom.controlType(e) === 'checkbox' || ctx.dom.controlType(e) === 'radio') && ctx.dom.checked(e);
  if (ctx.dom.getLocalName(e) === 'option') return ctx.dom.selected(e);
  return false;
}

export function isIndeterminate(e: Element, ctx: SelectletContext): boolean {
  // progress elements with no value content attribute
  if (ctx.dom.getLocalName(e) === 'progress') return !ctx.dom.hasAttribute(e, 'value');

  if (!(ctx.dom.getLocalName(e) === 'input')) return false;

  // input elements whose type attribute is in the Checkbox state
  // and whose indeterminate IDL attribute is set to true
  if (ctx.dom.controlType(e) === 'checkbox') return ctx.dom.indeterminate(e);

  // input elements whose type attribute is in the Radio Button state
  // and whose radio button group contains no checked input
  if (ctx.dom.controlType(e) !== 'radio') return false;
  if (ctx.dom.checked(e)) return false;


  // Radio groups require a non-empty name attribute; an unnamed unchecked radio is alone,
  // so its group contains no checked input.
  const name = ctx.dom.getAttribute(e, 'name');
  if (!name) return true;

  const root = ctx.dom.root(e);
  const inputs = ctx.dom.getElementsByTagName(ctx.dom.ownerDocument(e)!, 'input');

  for (const input of inputs) {
    // Same radio group: radio state, same form owner, same tree,
    // non-empty equal name attribute, and checkedness state is true.
    if (
      input !== e &&
      ctx.dom.controlType(input) === 'radio' &&
      ctx.dom.formOwner(input) === ctx.dom.formOwner(e) &&
      ctx.dom.root(input) === root &&
      ctx.dom.getAttribute(input, 'name') === name &&
      ctx.dom.checked(input)
    ) {
      return false;
    }
  }

  return true;
}

const REQUIRED_INPUT_TYPES = new Set([
  'checkbox', 'date', 'datetime-local', 'email', 'file', 'month', 'number',
  'password', 'radio', 'search', 'tel', 'text', 'time', 'url', 'week',
  // 'color' for webkit?
]);

export function isRequired(e: Element, ctx: SelectletContext): boolean {
  if ((ctx.dom.getLocalName(e) === 'select') || (ctx.dom.getLocalName(e) === 'textarea')) {
    return ctx.dom.hasAttribute(e, 'required');
  }

  if (ctx.dom.getLocalName(e) === 'input') {
    return REQUIRED_INPUT_TYPES.has(ctx.dom.controlType(e)) && ctx.dom.hasAttribute(e, 'required');
  }

  return false;
}

export function isOptional(e: Element, ctx: SelectletContext): boolean {
  return ((ctx.dom.getLocalName(e) === 'input') || (ctx.dom.getLocalName(e) === 'select') || (ctx.dom.getLocalName(e) === 'textarea')) && !isRequired(e, ctx);
}

export function isInvalid(e: Element, ctx: SelectletContext): boolean {
  if (ctx.dom.getLocalName(e) === 'form') return !ctx.dom.checkValidity(e);

  if (ctx.dom.getLocalName(e) === 'fieldset') {
    return hasInvalidDescendant(e, ctx);
  }

  if (ctx.dom.supportsValidity(e)) {
    return ctx.dom.willValidate(e) && !ctx.dom.checkValidity(e);
  }

  return false;
}

export function isValid(e: Element, ctx: SelectletContext): boolean {
  if (ctx.dom.getLocalName(e) === 'form') return ctx.dom.checkValidity(e);

  if (ctx.dom.getLocalName(e) === 'fieldset') {
    return !hasInvalidDescendant(e, ctx);
  }

  if (ctx.dom.supportsValidity(e)) {
    return ctx.dom.willValidate(e) && ctx.dom.checkValidity(e);
  }

  return false;
}

function hasInvalidDescendant(root: Element, ctx: SelectletContext): boolean {
  for (let node = ctx.dom.firstElementChild(root); node; node = nextDescendant(root, node, ctx.dom)) {
    if (isInvalid(node, ctx)) return true;
  }
  return false;
}

function isRangeInput(e: Element, ctx: SelectletContext): boolean {
  if (!(ctx.dom.getLocalName(e) === 'input')) return false;

  switch (ctx.dom.controlType(e)) {
    case 'range':
      return true;

    case 'date': case 'datetime-local': case 'month': case 'number': case 'time': case 'week':
      return ctx.dom.hasAttribute(e, 'min') || ctx.dom.hasAttribute(e, 'max');

    default:
      return false;
  }
}

export function isInRange(e: Element, ctx: SelectletContext): boolean {
  if (!isRangeInput(e, ctx) || !ctx.dom.willValidate(e)) return false;

  return !ctx.dom.rangeUnderflow(e) && !ctx.dom.rangeOverflow(e);
}

export function isOutOfRange(e: Element, ctx: SelectletContext): boolean {
  if (!isRangeInput(e, ctx) || !ctx.dom.willValidate(e)) return false;

  return ctx.dom.rangeUnderflow(e) || ctx.dom.rangeOverflow(e);
}

function getMediaElement(e: Element, dom: DOMOperations): Element | null {
  if (dom.isMediaElement(e)) return e;
  const parent = dom.parentElement(e);
  return parent && dom.isMediaElement(parent) ? parent : null;
}

export function isPlaying(e: Element, ctx: SelectletContext): boolean {
  const media = getMediaElement(e, ctx.dom);
  return !!media && ctx.dom.currentTime(media) > 0 && !ctx.dom.paused(media) && !ctx.dom.ended(media) && ctx.dom.readyState(media) > 2;
}

export function isPaused(e: Element, ctx: SelectletContext): boolean {
  const media = getMediaElement(e, ctx.dom);
  return !!media && ctx.dom.paused(media);
}

export function isSeeking(e: Element, ctx: SelectletContext): boolean {
  const media = getMediaElement(e, ctx.dom);
  return !!media && ctx.dom.seeking(media);
}

export function isMuted(e: Element, ctx: SelectletContext): boolean {
  const media = getMediaElement(e, ctx.dom);
  return !!media && ctx.dom.muted(media);
}
