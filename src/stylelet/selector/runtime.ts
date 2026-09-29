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
import type { StyleletContext } from '../context';
import type {
  NthElementIndexMap, NthOfTypeParentMap, RuntimeCache,
} from './runtimeCache';
import { InternalError } from '../../infra/internal-error';

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

export function checkId(e: Element, id: string, context: StyleletContext): boolean {
  return context.dom.getId(e) === id;
}

export function checkClass(e: Element, cls: string, context: StyleletContext): boolean {
  return context.getClassRegex(cls).test(context.dom.getClass(e));
}

export function checkTag(e: Element, lowerTag: string, tag: string, context: StyleletContext): boolean {
  // perf if lowerTag==tag, but only caller already checks, so no null lowerTag case here
  const localName = context.dom.getLocalName(e);
  return context.isHtml && context.dom.isHTMLElement(e) ? localName === lowerTag : localName === tag;
}

export function hasAttr(
  e: Element,
  namespaceURI: string | null | undefined, // undefined means any; null means none
  name: string,
  htmlName: string | null, // null implies same as name
  hasColonName: boolean,
  context: StyleletContext
): boolean {
  // Fast path for non-namespaced attributes without colons, which are common in HTML and SVG
  if (namespaceURI === null && !hasColonName) {
    return context.dom.hasAttribute(e, name);
  }

  const attrs = context.dom.attributes(e);
  const expected = htmlName !== null && context.isHtml && context.dom.isHTMLElement(e) ? htmlName : name;

  if (namespaceURI === undefined) {
    for (const attr of attrs) {
      if (context.dom.attributeLocalName(attr) === expected) return true;
    }
    return false;
  }

  for (const attr of attrs) {
    if (
      context.dom.attributeLocalName(attr) === expected &&
      context.dom.attributeNamespaceURI(attr) === namespaceURI
    ) {
      return true;
    }
  }

  return false;
}

export function matchAttribute(
  e: Element,
  namespaceURI: string | null | undefined, // undefined means any; null means none
  name: string,
  htmlName: string | null, // null implies same as name
  hasColonName: boolean,
  pattern: string,
  expected: string,
  htmlExpected: string,
  sensitivity: number,
  context: StyleletContext
): boolean {
  if (namespaceURI === null && !hasColonName) {
    const attrValue = context.dom.getAttribute(e, name);

    const insensitive = sensitivity === 1 || (sensitivity === 2 && context.isHtml && context.dom.isHTMLElement(e));
    return attrValue !== null &&
      matchAttrValueOp(attrValue, pattern, expected, htmlExpected, insensitive, context);
  }

  let expectedName = name;
  let insensitive = sensitivity === 1;

  const needsHtmlInfo = htmlName !== null || sensitivity === 2;
  if (needsHtmlInfo && context.isHtml) {
    const isHtml = context.dom.isHTMLElement(e);

    if (isHtml) {
      if (htmlName !== null) expectedName = htmlName;
      if (sensitivity === 2) insensitive = true;
    }
  }

  const attrs = context.dom.attributes(e);

  if (namespaceURI === undefined) {
    for (const attr of attrs) {
      if (
        context.dom.attributeLocalName(attr) === expectedName &&
        matchAttrValueOp(context.dom.attributeValue(attr), pattern, expected, htmlExpected, insensitive, context)
      ) {
        return true;
      }
    }

    return false;
  }

  for (const attr of attrs) {
    if (
      context.dom.attributeLocalName(attr) === expectedName &&
      context.dom.attributeNamespaceURI(attr) === namespaceURI &&
      matchAttrValueOp(context.dom.attributeValue(attr), pattern, expected, htmlExpected, insensitive, context)
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
  context: StyleletContext
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
      case '~R': return context.getCssTokenRegex(expected, true).test(attrValue);
      default: return context.getCachedRegex(pattern, true /* ignoreCase */).test(attrValue);
    }
  }

  switch (pattern) {
    case '=': return attrValue === expected;
    case '^': return attrValue.startsWith(expected);
    case '$': return attrValue.endsWith(expected);
    case '*': return attrValue.includes(expected);
    case '~': return hasWhitespaceToken(attrValue, expected);
    case '~R': return context.getCssTokenRegex(expected, false).test(attrValue);
    case '|':
      return attrValue === expected ||
        (
          attrValue.length > expected.length &&
          attrValue.at(expected.length) === '-' &&
          attrValue.startsWith(expected)
        );

    default: return context.getCachedRegex(pattern, false /* ignoreCase */).test(attrValue);
  }
}

// :scope
export function isScope(e: Element, context: StyleletContext): boolean {
  // This is the default for matching without an explicit scoping root. A
  // future match context must override it for @scope and shadow-tree matching.
  return e === context.root;
}

// :root
export function isRoot(e: Element, context: StyleletContext): boolean {
  return e === context.root;
}

// :empty
export function isEmpty(e: Element, context: StyleletContext): boolean {
  let n = context.dom.firstChild(e);

  while (n && !context.dom.isElement(n) && !context.dom.isText(n)) {
    n = context.dom.nextSibling(n);
  }

  return !n;
}

// :first-child
export function isFirstChild(e: Element, context: StyleletContext): boolean {
  return !context.dom.previousElementSibling(e);
}

// :last-child
export function isLastChild(e: Element, context: StyleletContext): boolean {
  return !context.dom.nextElementSibling(e);
}

// :only-child
export function isOnlyChild(e: Element, context: StyleletContext): boolean {
  return !context.dom.previousElementSibling(e) && !context.dom.nextElementSibling(e);
}

// :first-of-type
export function isFirstOfType(e: Element, context: StyleletContext): boolean {
  const localName = context.dom.getLocalName(e);
  const namespaceURI = context.dom.getNamespaceURI(e);

  let n: Element | null = e;

  while ((n = context.dom.previousElementSibling(n)) && (context.dom.getLocalName(n) !== localName || context.dom.getNamespaceURI(n) !== namespaceURI)) {
    // walk
  }

  return !n;
}

// :last-of-type
export function isLastOfType(e: Element, context: StyleletContext): boolean {
  const localName = context.dom.getLocalName(e);
  const namespaceURI = context.dom.getNamespaceURI(e);

  let n: Element | null = e;

  while ((n = context.dom.nextElementSibling(n)) && (context.dom.getLocalName(n) !== localName || context.dom.getNamespaceURI(n) !== namespaceURI)) {
    // walk
  }

  return !n;
}

// :only-of-type
export function isOnlyOfType(e: Element, context: StyleletContext): boolean {
  const localName = context.dom.getLocalName(e);
  const namespaceURI = context.dom.getNamespaceURI(e);

  let n: Element | null = e;

  while ((n = context.dom.nextElementSibling(n)) && (context.dom.getLocalName(n) !== localName || context.dom.getNamespaceURI(n) !== namespaceURI)) {
    // walk
  }

  if (n) return false;

  n = e;

  while ((n = context.dom.previousElementSibling(n)) && (context.dom.getLocalName(n) !== localName || context.dom.getNamespaceURI(n) !== namespaceURI)) {
    // walk
  }

  return !n;
}

export function matchesNthIndex(n: number, step: number, absStep: number, offset: number, _context: StyleletContext): boolean {
  if (step === 0) {
    throw new InternalError(`Invalid nth-child step value: ${step}; should have been handled earlier`);
  }

  const congruent = (n - offset) % absStep === 0;
  return step > 0
    ? n >= offset && congruent
    : n <= offset && congruent;
}

// fast resolver for :nth-child() and :nth-last-child()
// use cache if available to get the 1-based index of element among its siblings
export function nthElement(element: Element, fromLast: boolean, rc: RuntimeCache | null, context: StyleletContext): number {
  if (!rc) return nthElementLocal(element, fromLast, context.dom);

  const parent = context.dom.parentNode(element);
  if (!parent) return 1; // detached/rootless/root

  const cache = rc.nthElement ??= new WeakMap<ParentNode, NthElementIndexMap>();

  let indexMap = cache.get(parent);
  if (!indexMap) {
    indexMap = new WeakMap<Element, number>();

    let index = 0;
    for (let node = context.dom.firstElementChild(parent); node; node = context.dom.nextElementSibling(node)) {
      indexMap.set(node, index++);
    }
    cache.set(parent, indexMap);
  }

  const index = indexMap.get(element);
  if (index === undefined) {
    throw new InternalError('nthElement cache did not contain the target element');
  }

  return fromLast ? context.dom.childElementCount(parent) - index : index + 1;
}

function nthElementLocal(element: Element, fromLast: boolean, dom: DOMOperations): number {
  let n = 1;
  let e: Element | null = element;

  while ((e = fromLast ? dom.nextElementSibling(e) : dom.previousElementSibling(e))) {
    n++;
  }

  return n;
}

// fast resolver for :nth-of-type() and :nth-last-of-type()
// use cache if available to get the 1-based index of element among same-type siblings
export function nthOfType(element: Element, fromLast: boolean, rc: RuntimeCache | null, context: StyleletContext): number {
  if (!rc) return nthOfTypeLocal(element, fromLast, context);

  const parent = context.dom.parentNode(element);
  if (!parent) return 1;

  const namespaceURI = context.dom.getNamespaceURI(element);
  const localName = context.dom.getLocalName(element);
  const typeKey = `${namespaceURI ?? ''}\x00${localName}`;

  const cache = rc.nthOfType ??= new WeakMap<ParentNode, NthOfTypeParentMap>();

  let typeMap = cache.get(parent);
  if (!typeMap) {
    typeMap = new Map();
    cache.set(parent, typeMap);
  }

  let entry = typeMap.get(typeKey);
  if (!entry) {
    const indexMap = new WeakMap<Element, number>();

    let index = 0;
    for (let n = context.dom.firstElementChild(parent); n; n = context.dom.nextElementSibling(n)) {
      if (context.dom.getLocalName(n) === localName && context.dom.getNamespaceURI(n) === namespaceURI) {
        indexMap.set(n, index++);
      }
    }

    entry = { length: index, indexMap };
    typeMap.set(typeKey, entry);
  }

  const index = entry.indexMap.get(element);
  if (index === undefined) {
    throw new InternalError('nthOfType cache did not contain the target element');
  }

  return fromLast ? entry.length - index : index + 1;
}

function nthOfTypeLocal(element: Element, fromLast: boolean, context: StyleletContext): number {
  const namespaceURI = context.dom.getNamespaceURI(element);
  const localName = context.dom.getLocalName(element);
  let n = 1;
  let e: Element | null = element;

  while ((e = fromLast ? context.dom.nextElementSibling(e) : context.dom.previousElementSibling(e))) {
    if (context.dom.getLocalName(e) === localName && context.dom.getNamespaceURI(e) === namespaceURI) {
      n++;
    }
  }

  return n;
}

export function isNthElement(element: Element, index: number, fromLast: boolean, rc: RuntimeCache | null, context: StyleletContext): boolean {
  if (!rc) return isNthElementLocal(element, index, fromLast, context.dom);
  return nthElement(element, fromLast, rc, context) === index;
}

export function isNthOfType(element: Element, index: number, fromLast: boolean, rc: RuntimeCache | null, context: StyleletContext): boolean {
  if (!rc) return isNthOfTypeLocal(element, index, fromLast, context);
  return nthOfType(element, fromLast, rc, context) === index;
}

function isNthElementLocal(element: Element, target: number, fromLast: boolean, dom: DOMOperations): boolean {
  if (target < 1) {
    throw new InternalError(`Invalid nth-child index: ${target}`);
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

function isNthOfTypeLocal(element: Element, target: number, fromLast: boolean, context: StyleletContext): boolean {
  if (target < 1) {
    throw new InternalError(`Invalid nth-of-type index: ${target}`);
  }

  const parent = context.dom.parentNode(element);
  if (!parent) return target === 1;

  const namespaceURI = context.dom.getNamespaceURI(element);
  const localName = context.dom.getLocalName(element);

  let index = 0;

  if (!fromLast) {
    for (let n = context.dom.firstElementChild(parent); n; n = context.dom.nextElementSibling(n)) {
      if (context.dom.getLocalName(n) === localName && context.dom.getNamespaceURI(n) === namespaceURI) {
        ++index;
        if (n === element) return index === target;
        if (index >= target) return false;
      }
    }
  } else {
    for (let n = context.dom.lastElementChild(parent); n; n = context.dom.previousElementSibling(n)) {
      if (context.dom.getLocalName(n) === localName && context.dom.getNamespaceURI(n) === namespaceURI) {
        ++index;
        if (n === element) return index === target;
        if (index >= target) return false;
      }
    }
  }

  return false;
}

export function isFocused(el: Element, context: StyleletContext): boolean {
  const doc = context.dom.ownerDocument(el)!;
  if (context.dom.getLocalName(el) === 'iframe') return false;

  if (el === context.dom.body(doc) || el === context.dom.documentElement(doc)) {
    return el === context.focusTarget && context.dom.hasFocus(doc);
  }

  return el === context.dom.activeElement(doc) && context.dom.hasFocus(doc);
}

export function matchLang(wanted: string, element: Element, context: StyleletContext): boolean {
  wanted = asciiLower(wanted);

  for (let node: Element | null = element; node; node = langParent(node, context.dom)) {
    const actual = elementLanguage(node, context);

    if (actual !== null) {
      if (actual === '') return false;

      return extendedLangMatch(wanted, asciiLower(actual));
    }
  }

  return false;
}

function extendedLangMatch(range: string, lang: string): boolean {
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

function elementLanguage(element: Element, context: StyleletContext): string | null {
  const lang = context.dom.getAttribute(element, 'lang');
  if (lang !== null) return lang;

  return context.dom.getAttributeNS(element, XML_NAMESPACE, 'lang');
}

export function matchDir(wanted: string, element: Element, context: StyleletContext): boolean {
  return elementDir(element, context) === wanted;
}

function elementDir(element: Element, context: StyleletContext): 'ltr' | 'rtl' {
  const local = context.dom.getLocalName(element);

  if (context.dom.isHTMLElement(element)) {
    if (context.dom.getLocalName(element) === 'input') return inputDir(element, context);
    if (context.dom.getLocalName(element) === 'textarea') return textareaDir(element, context);
    if (local === 'bdi') return bdiDir(element, context);
  }

  return attrDir(element, context);
}

function attrDir(element: Element, context: StyleletContext): 'ltr' | 'rtl' {
  const attr = context.dom.getAttribute(element, 'dir');

  if (attr) {
    const dir = attr.toLowerCase();

    if (dir === 'ltr' || dir === 'rtl') return dir;
    if (dir === 'auto') return autoDirFromElement(element, context) ?? 'ltr';
  }

  const parent = context.dom.parentElement(element);
  return parent ? elementDir(parent, context) : 'ltr';
}

function bdiDir(element: Element, context: StyleletContext): 'ltr' | 'rtl' {
  const attr = context.dom.getAttribute(element, 'dir');

  if (attr) {
    const dir = attr.toLowerCase();

    if (dir === 'ltr' || dir === 'rtl') return dir;
    if (dir === 'auto') return autoDirFromElement(element, context) ?? 'ltr';
  }

  // <bdi> defaults to auto directionality.
  return autoDirFromElement(element, context) ?? 'ltr';
}

function textareaDir(textarea: Element, context: StyleletContext): 'ltr' | 'rtl' {
  const attr = context.dom.getAttribute(textarea, 'dir');

  if (attr) {
    const dir = attr.toLowerCase();

    if (dir === 'ltr' || dir === 'rtl') return dir;
    if (dir === 'auto') return autoDir(context.dom.controlValue(textarea) || '') ?? 'ltr';
  }

  const parent = context.dom.parentElement(textarea);
  return parent ? elementDir(parent, context) : 'ltr';
}

const inputValueDirTypes = new Set([
  'hidden', 'text', 'search', 'tel', 'url', 'email', 'password', 'submit', 'reset', 'button',
]);

function inputDir(input: Element, context: StyleletContext): 'ltr' | 'rtl' {
  const attr = context.dom.getAttribute(input, 'dir');
  const type = context.dom.controlType(input);

  if (attr) {
    const dir = attr.toLowerCase();

    if (dir === 'ltr' || dir === 'rtl') return dir;

    if (dir === 'auto') {
      return inputValueDirTypes.has(type) ?
        autoDir(context.dom.controlValue(input) || '') ?? 'ltr' :
        'ltr';
    }
  }

  if (type === 'tel') return 'ltr';

  const parent = context.dom.parentElement(input);
  return parent ? elementDir(parent, context) : 'ltr';
}

function autoDirFromElement(element: Element, context: StyleletContext): 'ltr' | 'rtl' | null {
  return autoDirFromChildren(element, context);
}

function autoDirFromChildren(node: Node, context: StyleletContext): 'ltr' | 'rtl' | null {
  for (let child = context.dom.firstChild(node); child; child = context.dom.nextSibling(child)) {
    if (context.dom.isText(child)) {
      const dir = autoDir(context.dom.textData(child));
      if (dir) return dir;
      continue;
    }

    if (!context.dom.isElement(child)) continue;

    const el = child;

    if (isDirBoundary(el, context)) {
      continue;
    }

    const dir = autoDirFromChildren(el, context);
    if (dir) return dir;
  }

  return null;
}

function isDirBoundary(element: Element, context: StyleletContext): boolean {
  const attr = context.dom.getAttribute(element, 'dir');

  if (attr) {
    const dir = attr.toLowerCase();
    if (dir === 'ltr' || dir === 'rtl' || dir === 'auto') return true;
  }

  // <bdi> has default auto directionality, so it should also isolate its text
  // from ancestor dir=auto scans even without an explicit dir attribute.
  return context.dom.isHTMLElement(element) && context.dom.getLocalName(element) === 'bdi';
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
export function isAnyLink(e: Element, context: StyleletContext): boolean {
  const localName = context.dom.getLocalName(e);

  if (localName !== 'a' && localName !== 'area') {
    const lower = localName.toLowerCase();
    if (lower !== 'a' && lower !== 'area') return false;
  }

  return context.dom.hasAttribute(e, 'href');
}

// :target
export function isTarget(e: Element, context: StyleletContext): boolean {
  const url = context.dom.URL(context.document);
  const hash = url.indexOf('#');
  return hash !== -1 && hash + 1 < url.length && context.dom.getId(e) === url.slice(hash + 1) && !!(context.dom.compareDocumentPosition(context.document, e) & 16);
}

// :hover
export function isHovered(e: Element, context: StyleletContext): boolean {
  for (let n = context.hoverTarget; n; n = context.dom.parentElement(n)) {
    if (n === e) return true;
  }

  return false;
}

// :active
export function isActive(e: Element, context: StyleletContext): boolean {
  for (let n = context.activeTarget; n; n = context.dom.parentElement(n)) {
    if (n === e) return true;
  }

  return false;
}

// :focus-within
export function isFocusWithin(e: Element, context: StyleletContext): boolean {
  const active = context.dom.activeElement(context.document);
  return !!active && (e === active || context.dom.contains(e, active));
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

export function isDefined(element: Element, context: StyleletContext): boolean {
  if (!context.dom.isHTMLElement(element)) return true;

  const name = context.dom.getLocalName(element);
  if (!isPotentialCustomElementName(name)) return true;

  return context.dom.isDefined(context.document, name);
}

export function isDisabled(e: Element, context: StyleletContext): boolean {
  return isFormStateElement(context.dom.getLocalName(e)) && isDisabledFormStateElement(e, context);
}

export function isEnabled(e: Element, context: StyleletContext): boolean {
  return isFormStateElement(context.dom.getLocalName(e)) && !isDisabledFormStateElement(e, context);
}

function isDisabledFormStateElement(e: Element, context: StyleletContext): boolean {
  if (context.dom.hasAttribute(e, 'disabled')) return true;

  if (context.dom.getLocalName(e) === 'option') {
    const parent = context.dom.parentElement(e);
    return !!parent && (context.dom.getLocalName(parent) === 'optgroup') && context.dom.hasAttribute(parent, 'disabled');
  }

  if (context.dom.getLocalName(e) === 'optgroup') return false;

  // Ancestor disabled fieldsets may disable form controls, unless the control is
  // inside that fieldset's first legend child.
  for (let n = context.dom.parentElement(e); n; n = context.dom.parentElement(n)) {
    if (!(context.dom.getLocalName(n) === 'fieldset') || !context.dom.hasAttribute(n, 'disabled')) continue;

    let exempt = false;

    for (let child = context.dom.firstElementChild(n); child; child = context.dom.nextElementSibling(child)) {
      if (!(context.dom.getLocalName(child) === 'legend')) continue;
      exempt = context.dom.contains(child, e);
      break;
    }

    if (exempt) continue;
    return true;
  }

  return false;
}

// https://html.spec.whatwg.org/multipage/semantics-other.html#selector-read-only
const READONLY_APPLIES_INPUT_TYPES = new Set(['date', 'datetime-local', 'email', 'month', 'number', 'password', 'search', 'tel', 'text', 'time', 'url', 'week']);
export function isReadWrite(e: Element, context: StyleletContext): boolean {
  if (context.dom.getLocalName(e) === 'input') {
    return READONLY_APPLIES_INPUT_TYPES.has(context.dom.controlType(e)) && !context.dom.hasAttribute(e, 'readonly') && !isDisabled(e, context);
  }
  if (context.dom.getLocalName(e) === 'textarea') return !context.dom.hasAttribute(e, 'readonly') && !isDisabled(e, context);
  return isEditingHostOrEditable(e, context);
}

function isEditingHostOrEditable(e: Element, context: StyleletContext): boolean {
  if (!isHtmlSvgOrMathNamespace(context.dom.getNamespaceURI(e))) return false;

  // Editing host: HTML element with contenteditable in the true or plaintext-only state.
  const attr = context.dom.getAttribute(e, 'contenteditable')?.toLowerCase();
  if (context.dom.isHTMLElement(e) && (attr === '' || attr === 'true' || attr === 'plaintext-only')) {
    return true;
  }

  // Editable: the node itself must not have contenteditable=false.
  if (attr === 'false') {
    return false;
  }

  // Editing host: child HTML element of a Document whose designMode is enabled.
  // DesignMode: eligible descendants of a designMode document are editable unless blocked.
  const designMode = context.dom.designMode(context.dom.ownerDocument(e)!);
  if (designMode?.toLowerCase() === 'on') {
    for (let n: Element | null = e; n; n = context.dom.parentElement(n)) {
      if (context.dom.getAttribute(n, 'contenteditable')?.toLowerCase() === 'false') {
        return false;
      }
    }

    return true;
  }

  // Editable: not an editing host, does not have contenteditable=false,
  // parent is an editing host or editable, and the element is HTML/SVG/Math.
  for (let n: Element | null = context.dom.parentElement(e); n; n = context.dom.parentElement(n)) {
    const parentAttr = context.dom.getAttribute(n, 'contenteditable')?.toLowerCase();

    if (parentAttr === 'false') {
      return false;
    }

    if (context.dom.isHTMLElement(n) && (parentAttr === '' || parentAttr === 'true' || parentAttr === 'plaintext-only')) {
      return true;
    }
  }

  return false;
}

const PLACEHOLDER_INPUT_TYPES = new Set(['email', 'number', 'password', 'search', 'tel', 'text', 'url']);

export function isPlaceholderShown(e: Element, context: StyleletContext): boolean {
  if (!context.dom.hasAttribute(e, 'placeholder')) return false;

  if (context.dom.getLocalName(e) === 'textarea') {
    return context.dom.controlValue(e) === '';
  }

  if (context.dom.getLocalName(e) === 'input') {
    return PLACEHOLDER_INPUT_TYPES.has(context.dom.controlType(e)) && context.dom.controlValue(e) === '';
  }

  return false;
}

const DOCUMENT_POSITION_FOLLOWING = 4;

export function isDefault(e: Element, context: StyleletContext): boolean {
  if (context.dom.getLocalName(e) === 'option') return context.dom.hasAttribute(e, 'selected');

  const isInput = context.dom.getLocalName(e) === 'input';
  if (isInput && (context.dom.controlType(e) === 'checkbox' || context.dom.controlType(e) === 'radio')) {
    return context.dom.hasAttribute(e, 'checked');
  }

  const isButton = context.dom.getLocalName(e) === 'button';
  if (!isInput && !isButton) return false;

  const isSubmit =
    (isInput && (context.dom.controlType(e) === 'submit' || context.dom.controlType(e) === 'image')) ||
    (isButton && context.dom.controlType(e) === 'submit');

  if (!isSubmit) return false;

  // find the first submit button, which may be in or outside the form
  const form = context.dom.formOwner(e);
  if (!form) return false;

  let firstInput: Element | null = null;
  const inputs = context.dom.getElementsByTagName(context.dom.ownerDocument(e)!, 'input');
  for (const input of inputs) {
    if ((context.dom.getLocalName(input) === 'input') && context.dom.formOwner(input) === form && (context.dom.controlType(input) === 'submit' || context.dom.controlType(input) === 'image')) {
      firstInput = input;
      break;
    }
  }

  let firstButton: Element | null = null;
  const buttons = context.dom.getElementsByTagName(context.dom.ownerDocument(e)!, 'button');
  for (const button of buttons) {
    if ((context.dom.getLocalName(button) === 'button') && context.dom.formOwner(button) === form && context.dom.controlType(button) === 'submit') {
      firstButton = button;
      break;
    }
  }

  const firstSubmit =
    !firstInput ? firstButton :
    !firstButton ? firstInput :
    (context.dom.compareDocumentPosition(firstInput, firstButton) & DOCUMENT_POSITION_FOLLOWING)
      ? firstInput
      : firstButton;

  return firstSubmit === e;
}

export function isChecked(e: Element, context: StyleletContext): boolean {
  if (context.dom.getLocalName(e) === 'input') return (context.dom.controlType(e) === 'checkbox' || context.dom.controlType(e) === 'radio') && context.dom.checked(e);
  if (context.dom.getLocalName(e) === 'option') return context.dom.selected(e);
  return false;
}

export function isIndeterminate(e: Element, context: StyleletContext): boolean {
  // progress elements with no value content attribute
  if (context.dom.getLocalName(e) === 'progress') return !context.dom.hasAttribute(e, 'value');

  if (!(context.dom.getLocalName(e) === 'input')) return false;

  // input elements whose type attribute is in the Checkbox state
  // and whose indeterminate IDL attribute is set to true
  if (context.dom.controlType(e) === 'checkbox') return context.dom.indeterminate(e);

  // input elements whose type attribute is in the Radio Button state
  // and whose radio button group contains no checked input
  if (context.dom.controlType(e) !== 'radio') return false;
  if (context.dom.checked(e)) return false;


  // Radio groups require a non-empty name attribute; an unnamed unchecked radio is alone,
  // so its group contains no checked input.
  const name = context.dom.getAttribute(e, 'name');
  if (!name) return true;

  const root = context.dom.root(e);
  const inputs = context.dom.getElementsByTagName(context.dom.ownerDocument(e)!, 'input');

  for (const input of inputs) {
    // Same radio group: radio state, same form owner, same tree,
    // non-empty equal name attribute, and checkedness state is true.
    if (
      input !== e &&
      (context.dom.getLocalName(input) === 'input') &&
      context.dom.controlType(input) === 'radio' &&
      context.dom.formOwner(input) === context.dom.formOwner(e) &&
      context.dom.root(input) === root &&
      context.dom.getAttribute(input, 'name') === name &&
      context.dom.checked(input)
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

export function isRequired(e: Element, context: StyleletContext): boolean {
  if ((context.dom.getLocalName(e) === 'select') || (context.dom.getLocalName(e) === 'textarea')) {
    return context.dom.hasAttribute(e, 'required');
  }

  if (context.dom.getLocalName(e) === 'input') {
    return REQUIRED_INPUT_TYPES.has(context.dom.controlType(e)) && context.dom.hasAttribute(e, 'required');
  }

  return false;
}

export function isOptional(e: Element, context: StyleletContext): boolean {
  return ((context.dom.getLocalName(e) === 'input') || (context.dom.getLocalName(e) === 'select') || (context.dom.getLocalName(e) === 'textarea')) && !isRequired(e, context);
}

export function isInvalid(e: Element, context: StyleletContext): boolean {
  if (context.dom.getLocalName(e) === 'form') return !context.dom.checkValidity(e);

  if (context.dom.getLocalName(e) === 'fieldset') {
    return hasInvalidDescendant(e, context);
  }

  if (context.dom.supportsValidity(e)) {
    return context.dom.willValidate(e) && !context.dom.checkValidity(e);
  }

  return false;
}

export function isValid(e: Element, context: StyleletContext): boolean {
  if (context.dom.getLocalName(e) === 'form') return context.dom.checkValidity(e);

  if (context.dom.getLocalName(e) === 'fieldset') {
    return !hasInvalidDescendant(e, context);
  }

  if (context.dom.supportsValidity(e)) {
    return context.dom.willValidate(e) && context.dom.checkValidity(e);
  }

  return false;
}

function hasInvalidDescendant(root: Element, context: StyleletContext): boolean {
  for (let node = context.dom.firstElementChild(root); node; node = nextDescendant(root, node, context.dom)) {
    if (isInvalid(node, context)) return true;
  }
  return false;
}

function isRangeInput(e: Element, context: StyleletContext): boolean {
  if (!(context.dom.getLocalName(e) === 'input')) return false;

  switch (context.dom.controlType(e)) {
    case 'range':
      return true;

    case 'date': case 'datetime-local': case 'month': case 'number': case 'time': case 'week':
      return context.dom.hasAttribute(e, 'min') || context.dom.hasAttribute(e, 'max');

    default:
      return false;
  }
}

export function isInRange(e: Element, context: StyleletContext): boolean {
  if (!isRangeInput(e, context) || !context.dom.willValidate(e)) return false;

  return !context.dom.rangeUnderflow(e) && !context.dom.rangeOverflow(e);
}

export function isOutOfRange(e: Element, context: StyleletContext): boolean {
  if (!isRangeInput(e, context) || !context.dom.willValidate(e)) return false;

  return context.dom.rangeUnderflow(e) || context.dom.rangeOverflow(e);
}

function getMediaElement(e: Element, dom: DOMOperations): Element | null {
  if (dom.isMediaElement(e)) return e;
  const parent = dom.parentElement(e);
  return parent && dom.isMediaElement(parent) ? parent : null;
}

export function isPlaying(e: Element, context: StyleletContext): boolean {
  const media = getMediaElement(e, context.dom);
  return !!media && context.dom.currentTime(media) > 0 && !context.dom.paused(media) && !context.dom.ended(media) && context.dom.readyState(media) > 2;
}

export function isPaused(e: Element, context: StyleletContext): boolean {
  const media = getMediaElement(e, context.dom);
  return !!media && context.dom.paused(media);
}

export function isSeeking(e: Element, context: StyleletContext): boolean {
  const media = getMediaElement(e, context.dom);
  return !!media && context.dom.seeking(media);
}

export function isMuted(e: Element, context: StyleletContext): boolean {
  const media = getMediaElement(e, context.dom);
  return !!media && context.dom.muted(media);
}
