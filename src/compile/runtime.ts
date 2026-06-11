import {
  asciiDashMatch, asciiEndsWith, asciiEquals, asciiHasCssToken, asciiIncludes, asciiLower, asciiStartsWith, hasCssToken,
} from '../utils/css';
import {
  isFormStateElement, isHtmlButton, isValidityElement,
  isHtmlFieldSet, isHtmlForm, isHtmlInput, isHtmlLegend, isHtmlMediaElement, isHtmlOptGroup,
  isHtmlOption, isHtmlProgress, isHtmlSelect, isHtmlSvgOrMathElement, isHtmlTextArea, isIFrame,
  type FormStateElement,
} from '../utils/dom';
import type { RuntimeCache } from './runtimeCache';

export type CombinatorTest = (e: Element, rc: RuntimeCache | null) => boolean;

export function matchParent(e: Element, test: CombinatorTest, rc: RuntimeCache | null): boolean {
  const parent = e.parentElement;
  return !!parent && test(parent, rc);
}

export function matchAncestor(e: Element, test: CombinatorTest, rc: RuntimeCache | null): boolean {
  let node: Element | null = e;
  while ((node = node.parentElement)) {
    if (test(node, rc)) return true;
  }
  return false;
}

export function matchPrev(e: Element, test: CombinatorTest, rc: RuntimeCache | null): boolean {
  const prev = e.previousElementSibling;
  return !!prev && test(prev, rc);
}

export function matchPrevAny(e: Element, test: CombinatorTest, rc: RuntimeCache | null): boolean {
  let node: Element | null = e;
  while ((node = node.previousElementSibling)) {
    if (test(node, rc)) return true;
  }
  return false;
}

export function checkId(e: Element, id: string, snap: Snapshot): boolean {
  return snap.getId(e) === id;
}

export function checkClass(e: Element, cls: string, snap: Snapshot): boolean {
  return snap.getClassRegex(cls).test(snap.getClass(e));
}

export function checkTag(e: Element, lowerTag: string, tag: string, snap: Snapshot): boolean {
  // perf if lowerTag==tag, but only caller already checks, so no null lowerTag case here
  const localName = snap.getLocalName(e);
  return snap.isHtml && snap.isHtmlElement(e) ? localName === lowerTag : localName === tag;
}

export function hasAttr(
  e: Element,
  anyNs: boolean,
  name: string,
  htmlName: string | null, // null implies same as name
  hasColonName: boolean,
  snap: Snapshot
): boolean {
  // Fast path for non-namespaced attributes without colons, which are common in HTML and SVG
  if (!anyNs && !hasColonName) {
    return snap.hasAttribute(e, name);
  }

  const attrs = e.attributes;
  const expected = htmlName !== null && snap.isHtml && snap.isHtmlElement(e) ? htmlName : name;

  if (anyNs) {
    for (const attr of attrs) {
      if (attr.localName === expected) return true;
    }
    return false;
  }

  for (const attr of attrs) {
    if (attr.localName === expected && attr.namespaceURI === null) return true;
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
  snap: Snapshot
): boolean {
  if (!anyNs && !hasColonName) {
    const attrValue = snap.getAttribute(e, name);

    const insensitive = sensitivity === 1 || (sensitivity === 2 && snap.isHtml && snap.isHtmlElement(e));
    return attrValue !== null &&
      matchAttrValueOp(attrValue, pattern, expected, htmlExpected, insensitive, snap);
  }

  let expectedName = name;
  let insensitive = sensitivity === 1;

  const needsHtmlInfo = htmlName !== null || sensitivity === 2;
  if (needsHtmlInfo && snap.isHtml) {
    const isHtml = snap.isHtmlElement(e);

    if (isHtml) {
      if (htmlName !== null) expectedName = htmlName;
      if (sensitivity === 2) insensitive = true;
    }
  }

  const attrs = e.attributes;

  if (anyNs) {
    for (const attr of attrs) {
      if (
        attr.localName === expectedName &&
        matchAttrValueOp(attr.value, pattern, expected, htmlExpected, insensitive, snap)
      ) {
        return true;
      }
    }

    return false;
  }

  for (const attr of attrs) {
    if (
      attr.localName === expectedName &&
      attr.namespaceURI === null &&
      matchAttrValueOp(attr.value, pattern, expected, htmlExpected, insensitive, snap)
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
  snap: Snapshot
): boolean {
  // For ASCII-insensitive matching, avoid asciiLower(attrValue) in the hot path.
  if (insensitive) {
    switch (pattern) {
      case '=': return asciiEquals(attrValue, htmlExpected);
      case '^': return asciiStartsWith(attrValue, htmlExpected);
      case '$': return asciiEndsWith(attrValue, htmlExpected);
      case '|': return asciiDashMatch(attrValue, htmlExpected);
      case '*': return asciiIncludes(attrValue, htmlExpected);
      case '~': return asciiHasCssToken(attrValue, htmlExpected);
      case '~R': return snap.getCssTokenRegex(expected, true).test(attrValue);
      default: return snap.getCachedRegex(pattern, true /* ignoreCase */).test(attrValue);
    }
  }

  switch (pattern) {
    case '=': return attrValue === expected;
    case '^': return attrValue.startsWith(expected);
    case '$': return attrValue.endsWith(expected);
    case '*': return attrValue.includes(expected);
    case '~': return hasCssToken(attrValue, expected);
    case '~R': return snap.getCssTokenRegex(expected, false).test(attrValue);
    case '|':
      return attrValue === expected ||
        (
          attrValue.length > expected.length &&
          attrValue.at(expected.length) === '-' &&
          attrValue.startsWith(expected)
        );

    default: return snap.getCachedRegex(pattern, false /* ignoreCase */).test(attrValue);
  }
}

// :scope
export function isScope(e: Element, snap: Snapshot): boolean {
  return e === snap.scopeEl;
}

// :root
export function isRoot(e: Element, snap: Snapshot): boolean {
  return e === snap.root;
}

// :empty
export function isEmpty(e: Element): boolean {
  let n = e.firstChild;

  while (n && n.nodeType !== 1 && n.nodeType !== 3) {
    n = n.nextSibling;
  }

  return !n;
}

// :first-child
export function isFirstChild(e: Element): boolean {
  return !e.previousElementSibling;
}

// :last-child
export function isLastChild(e: Element): boolean {
  return !e.nextElementSibling;
}

// :only-child
export function isOnlyChild(e: Element): boolean {
  return !e.previousElementSibling && !e.nextElementSibling;
}

// :first-of-type
export function isFirstOfType(e: Element, snap: Snapshot): boolean {
  const localName = snap.getLocalName(e);
  const namespaceURI = snap.getNamespaceURI(e);

  let n: Element | null = e;

  while ((n = n.previousElementSibling) && (snap.getLocalName(n) !== localName || snap.getNamespaceURI(n) !== namespaceURI)) {
    // walk
  }

  return !n;
}

// :last-of-type
export function isLastOfType(e: Element, snap: Snapshot): boolean {
  const localName = snap.getLocalName(e);
  const namespaceURI = snap.getNamespaceURI(e);

  let n: Element | null = e;

  while ((n = n.nextElementSibling) && (snap.getLocalName(n) !== localName || snap.getNamespaceURI(n) !== namespaceURI)) {
    // walk
  }

  return !n;
}

// :only-of-type
export function isOnlyOfType(e: Element, snap: Snapshot): boolean {
  const localName = snap.getLocalName(e);
  const namespaceURI = snap.getNamespaceURI(e);

  let n: Element | null = e;

  while ((n = n.nextElementSibling) && (snap.getLocalName(n) !== localName || snap.getNamespaceURI(n) !== namespaceURI)) {
    // walk
  }

  if (n) return false;

  n = e;

  while ((n = n.previousElementSibling) && (snap.getLocalName(n) !== localName || snap.getNamespaceURI(n) !== namespaceURI)) {
    // walk
  }

  return !n;
}

export function matchesNthIndex(n: number, step: number, absStep: number, offset: number): boolean {
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
export function nthElement(element: Element, fromLast: boolean, rc: RuntimeCache | null): number {
  if (!rc) return nthElementLocal(element, fromLast);

  const parent = element.parentNode;
  if (!parent) return 1; // detached/rootless/root

  const cache = rc.nthElement ??= new WeakMap<ParentNode, NthElementIndexMap>();

  let indexMap = cache.get(parent);
  if (!indexMap) {
    indexMap = new WeakMap<Element, number>();

    let index = 0;
    for (let node = parent.firstElementChild; node; node = node.nextElementSibling) {
      indexMap.set(node, index++);
    }
    cache.set(parent, indexMap);
  }

  const index = indexMap.get(element);
  if (index === undefined) {
    throw new Error('nthElement cache did not contain the target element');
  }

  return fromLast ? parent.childElementCount - index : index + 1;
}

function nthElementLocal(element: Element, fromLast: boolean): number {
  let n = 1;
  let e: Element | null = element;

  while ((e = fromLast ? e.nextElementSibling : e.previousElementSibling)) {
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
export function nthOfType(element: Element, fromLast: boolean, rc: RuntimeCache | null, snap: Snapshot): number {
  if (!rc) return nthOfTypeLocal(element, fromLast, snap);

  const parent = element.parentNode;
  if (!parent) return 1;

  const namespaceURI = snap.getNamespaceURI(element);
  const localName = snap.getLocalName(element);
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
    for (let n = parent.firstElementChild; n; n = n.nextElementSibling) {
      if (snap.getLocalName(n) === localName && snap.getNamespaceURI(n) === namespaceURI) {
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

function nthOfTypeLocal(element: Element, fromLast: boolean, snap: Snapshot): number {
  const namespaceURI = snap.getNamespaceURI(element);
  const localName = snap.getLocalName(element);
  let n = 1;
  let e: Element | null = element;

  while ((e = fromLast ? e.nextElementSibling : e.previousElementSibling)) {
    if (snap.getLocalName(e) === localName && snap.getNamespaceURI(e) === namespaceURI) {
      n++;
    }
  }

  return n;
}

export function isNthElement(element: Element, index: number, fromLast: boolean, rc: RuntimeCache | null): boolean {
  if (!rc) return isNthElementLocal(element, index, fromLast);
  return nthElement(element, fromLast, rc) === index;
}

export function isNthOfType(element: Element, index: number, fromLast: boolean, rc: RuntimeCache | null, snap: Snapshot): boolean {
  if (!rc) return isNthOfTypeLocal(element, index, fromLast, snap);
  return nthOfType(element, fromLast, rc, snap) === index;
}

function isNthElementLocal(element: Element, target: number, fromLast: boolean): boolean {
  if (target < 1) {
    throw new Error(`Invalid nth-child index: ${target}`);
  }

  const parent = element.parentNode;
  if (!parent) return target === 1;

  const length = parent.childElementCount;
  if (target > length) return false;

  const forwardTarget = fromLast ? length - target + 1 : target;

  let node: Element | null;

  if (forwardTarget <= length - forwardTarget + 1) {
    node = parent.firstElementChild;
    for (let i = 1; node && i < forwardTarget; ++i) {
      node = node.nextElementSibling;
    }
  } else {
    node = parent.lastElementChild;
    for (let i = length; node && i > forwardTarget; --i) {
      node = node.previousElementSibling;
    }
  }

  return node === element;
}

function isNthOfTypeLocal(element: Element, target: number, fromLast: boolean, snap: Snapshot): boolean {
  if (target < 1) {
    throw new Error(`Invalid nth-of-type index: ${target}`);
  }

  const parent = element.parentNode;
  if (!parent) return target === 1;

  const namespaceURI = snap.getNamespaceURI(element);
  const localName = snap.getLocalName(element);

  let index = 0;

  if (!fromLast) {
    for (let n = parent.firstElementChild; n; n = n.nextElementSibling) {
      if (snap.getLocalName(n) === localName && snap.getNamespaceURI(n) === namespaceURI) {
        ++index;
        if (n === element) return index === target;
        if (index >= target) return false;
      }
    }
  } else {
    for (let n = parent.lastElementChild; n; n = n.previousElementSibling) {
      if (snap.getLocalName(n) === localName && snap.getNamespaceURI(n) === namespaceURI) {
        ++index;
        if (n === element) return index === target;
        if (index >= target) return false;
      }
    }
  }

  return false;
}

export function isFocused(el: Element, snap: Snapshot): boolean {
  const doc = el.ownerDocument;
  if (isIFrame(el)) return false;

  if (el === doc.body || el === doc.documentElement) {
    return el === snap.focusTarget && doc.hasFocus();
  }

  return el === doc.activeElement && doc.hasFocus();
}

export type SelectorCombinator = ' ' | '>' | '+' | '~';
export type HasStep = [SelectorCombinator, (e: Element, rc: RuntimeCache) => boolean];
export function matchHasFrom(
  steps: HasStep[],
  index: number,
  base: Element,
  snap: Snapshot,
  rc: RuntimeCache,
): boolean {
  if (index >= steps.length) return true;

  const [combinator, test] = steps[index];
  const next = index + 1;

  switch (combinator) {
    case ' ':
      for (let node = base.firstElementChild; node; node = nextDescendant(base, node)) {
        if (test(node, rc) && matchHasFrom(steps, next, node, snap, rc)) return true;
      }
      return false;

    case '>':
      for (let node = base.firstElementChild; node; node = node.nextElementSibling) {
        if (test(node, rc) && matchHasFrom(steps, next, node, snap, rc)) return true;
      }
      return false;

    case '+': {
      const node = base.nextElementSibling;
      return !!node && test(node, rc) && matchHasFrom(steps, next, node, snap, rc);
    }

    case '~':
      for (let node = base.nextElementSibling; node; node = node.nextElementSibling) {
        if (test(node, rc) && matchHasFrom(steps, next, node, snap, rc)) return true;
      }
      return false;
  }
}

function nextDescendant(root: Element, node: Element): Element | null {
  if (node.firstElementChild) return node.firstElementChild;

  while (node !== root) {
    if (node.nextElementSibling) return node.nextElementSibling;

    const parent = node.parentElement;
    if (!parent) return null;

    node = parent;
  }

  return null;
}

export function matchLang(wanted: string, element: Element, snap: Snapshot): boolean {
  wanted = asciiLower(wanted);

  for (let node: Element | null = element; node; node = langParent(node)) {
    const actual = elementLanguage(node, snap);

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
    const r = rangeParts[ri];

    if (r === '*') {
      ri++;
      continue;
    }

    if (li >= langParts.length) {
      return false;
    }

    const l = langParts[li];

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

function langParent(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;

  const root = element.getRootNode();

  if (root.nodeType === 11 && 'host' in root) {
    return (root as ShadowRoot).host;
  }

  return null;
}

const XML_NS = 'http://www.w3.org/XML/1998/namespace';

function elementLanguage(element: Element, snap: Snapshot): string | null {
  const lang = snap.getAttribute(element, 'lang');
  if (lang !== null) return lang;

  return snap.getAttributeNS(element, XML_NS, 'lang');
}

export function matchDir(wanted: string, element: Element, snap: Snapshot): boolean {
  return elementDir(element, snap) === wanted;
}

function elementDir(element: Element, snap: Snapshot): 'ltr' | 'rtl' {
  const local = snap.getLocalName(element);

  if (snap.isHtmlElement(element)) {
    if (local === 'input') return inputDir(element as HTMLInputElement, snap);
    if (local === 'textarea') return textareaDir(element as HTMLTextAreaElement, snap);
    if (local === 'bdi') return bdiDir(element, snap);
  }

  return attrDir(element, snap);
}

function attrDir(element: Element, snap: Snapshot): 'ltr' | 'rtl' {
  const attr = snap.getAttribute(element, 'dir');

  if (attr) {
    const dir = attr.toLowerCase();

    if (dir === 'ltr' || dir === 'rtl') return dir;
    if (dir === 'auto') return autoDirFromElement(element, snap) ?? 'ltr';
  }

  const parent = element.parentElement;
  return parent ? elementDir(parent, snap) : 'ltr';
}

function bdiDir(element: Element, snap: Snapshot): 'ltr' | 'rtl' {
  const attr = snap.getAttribute(element, 'dir');

  if (attr) {
    const dir = attr.toLowerCase();

    if (dir === 'ltr' || dir === 'rtl') return dir;
    if (dir === 'auto') return autoDirFromElement(element, snap) ?? 'ltr';
  }

  // <bdi> defaults to auto directionality.
  return autoDirFromElement(element, snap) ?? 'ltr';
}

function textareaDir(textarea: HTMLTextAreaElement, snap: Snapshot): 'ltr' | 'rtl' {
  const attr = snap.getAttribute(textarea, 'dir');

  if (attr) {
    const dir = attr.toLowerCase();

    if (dir === 'ltr' || dir === 'rtl') return dir;
    if (dir === 'auto') return autoDir(textarea.value || '') ?? 'ltr';
  }

  const parent = textarea.parentElement;
  return parent ? elementDir(parent, snap) : 'ltr';
}

const inputValueDirTypes = new Set([
  'hidden', 'text', 'search', 'tel', 'url', 'email', 'password', 'submit', 'reset', 'button',
]);

function inputDir(input: HTMLInputElement, snap: Snapshot): 'ltr' | 'rtl' {
  const attr = snap.getAttribute(input, 'dir');
  const type = input.type;

  if (attr) {
    const dir = attr.toLowerCase();

    if (dir === 'ltr' || dir === 'rtl') return dir;

    if (dir === 'auto') {
      return inputValueDirTypes.has(type) ?
        autoDir(input.value || '') ?? 'ltr' :
        'ltr';
    }
  }

  if (type === 'tel') return 'ltr';

  const parent = input.parentElement;
  return parent ? elementDir(parent, snap) : 'ltr';
}

function autoDirFromElement(element: Element, snap: Snapshot): 'ltr' | 'rtl' | null {
  return autoDirFromChildren(element, snap);
}

function autoDirFromChildren(node: Node, snap: Snapshot): 'ltr' | 'rtl' | null {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 3) {
      const dir = autoDir(child.textContent || '');
      if (dir) return dir;
      continue;
    }

    if (child.nodeType !== 1) continue;

    const el = child as Element;

    if (isDirBoundary(el, snap)) {
      continue;
    }

    const dir = autoDirFromChildren(el, snap);
    if (dir) return dir;
  }

  return null;
}

function isDirBoundary(element: Element, snap: Snapshot): boolean {
  const attr = snap.getAttribute(element, 'dir');

  if (attr) {
    const dir = attr.toLowerCase();
    if (dir === 'ltr' || dir === 'rtl' || dir === 'auto') return true;
  }

  // <bdi> has default auto directionality, so it should also isolate its text
  // from ancestor dir=auto scans even without an explicit dir attribute.
  return snap.isHtmlElement(element) && snap.getLocalName(element) === 'bdi';
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
export function isAnyLink(e: Element, snap: Snapshot): boolean {
  const localName = snap.getLocalName(e);

  if (localName !== 'a' && localName !== 'area') {
    const lower = localName.toLowerCase();
    if (lower !== 'a' && lower !== 'area') return false;
  }

  return snap.hasAttribute(e, 'href');
}

// :target
export function isTarget(e: Element, snap: Snapshot): boolean {
  const hash = snap.doc.location.hash;
  return hash.length > 1 && snap.getId(e) === hash.slice(1) && !!(snap.doc.compareDocumentPosition(e) & 16);
}

// :hover
export function isHovered(e: Element, snap: Snapshot): boolean {
  for (let n = snap.hoverTarget; n; n = n.parentElement) {
    if (n === e) return true;
  }

  return false;
}

// :active
export function isActive(e: Element, snap: Snapshot): boolean {
  for (let n = snap.activeTarget; n; n = n.parentElement) {
    if (n === e) return true;
  }

  return false;
}

// :focus-within
export function isFocusWithin(e: Element, snap: Snapshot): boolean {
  const active = snap.doc.activeElement;
  return !!active && (e === active || e.contains(active));
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

export function isDefined(element: Element, snap: Snapshot): boolean {
  if (!snap.isHtmlElement(element)) return true;

  const name = snap.getLocalName(element);
  if (!isPotentialCustomElementName(name)) return true;

  return !!snap.doc.defaultView?.customElements.get(name);
}

export function isDisabled(e: Element, snap: Snapshot): boolean {
  return isFormStateElement(e) && isDisabledFormStateElement(e, snap);
}

export function isEnabled(e: Element, snap: Snapshot): boolean {
  return isFormStateElement(e) && !isDisabledFormStateElement(e, snap);
}

function isDisabledFormStateElement(e: FormStateElement, snap: Snapshot): boolean {
  if (snap.hasAttribute(e, 'disabled')) return true;

  if (isHtmlOption(e)) {
    const parent = e.parentElement;
    return !!parent && isHtmlOptGroup(parent) && snap.hasAttribute(parent, 'disabled');
  }

  if (isHtmlOptGroup(e)) return false;

  // Ancestor disabled fieldsets may disable form controls, unless the control is
  // inside that fieldset's first legend child.
  for (let n = e.parentElement; n; n = n.parentElement) {
    if (!isHtmlFieldSet(n) || !snap.hasAttribute(n, 'disabled')) continue;

    let exempt = false;

    for (let child = n.firstElementChild; child; child = child.nextElementSibling) {
      if (!isHtmlLegend(child)) continue;
      exempt = child.contains(e);
      break;
    }

    if (exempt) continue;
    return true;
  }

  return false;
}

// https://html.spec.whatwg.org/multipage/semantics-other.html#selector-read-only
const READONLY_APPLIES_INPUT_TYPES = new Set(['date', 'datetime-local', 'email', 'month', 'number', 'password', 'search', 'tel', 'text', 'time', 'url', 'week']);
export function isReadWrite(e: Element, snap: Snapshot): boolean {
  if (isHtmlInput(e)) {
    return READONLY_APPLIES_INPUT_TYPES.has(e.type) && !snap.hasAttribute(e, 'readonly') && !isDisabled(e, snap);
  }
  if (isHtmlTextArea(e)) return !snap.hasAttribute(e, 'readonly') && !isDisabled(e, snap);
  return isEditingHostOrEditable(e, snap);
}

function isEditingHostOrEditable(e: Element, snap: Snapshot): boolean {
  if (!isHtmlSvgOrMathElement(e)) return false;

  // Editing host: HTML element with contenteditable in the true or plaintext-only state.
  const attr = snap.getAttribute(e, 'contenteditable')?.toLowerCase();
  if (snap.isHtmlElement(e) && (attr === '' || attr === 'true' || attr === 'plaintext-only')) {
    return true;
  }

  // Editable: the node itself must not have contenteditable=false.
  if (attr === 'false') {
    return false;
  }

  // Editing host: child HTML element of a Document whose designMode is enabled.
  // DesignMode: eligible descendants of a designMode document are editable unless blocked.
  const designMode = snap.docDesignMode(e.ownerDocument);
  if (designMode?.toLowerCase() === 'on') {
    for (let n: Element | null = e; n; n = n.parentElement) {
      if (snap.getAttribute(n, 'contenteditable')?.toLowerCase() === 'false') {
        return false;
      }
    }

    return true;
  }

  // Editable: not an editing host, does not have contenteditable=false,
  // parent is an editing host or editable, and the element is HTML/SVG/Math.
  for (let n: Element | null = e.parentElement; n; n = n.parentElement) {
    const parentAttr = snap.getAttribute(n, 'contenteditable')?.toLowerCase();

    if (parentAttr === 'false') {
      return false;
    }

    if (snap.isHtmlElement(n) && (parentAttr === '' || parentAttr === 'true' || parentAttr === 'plaintext-only')) {
      return true;
    }
  }

  return false;
}

const PLACEHOLDER_INPUT_TYPES = new Set(['email', 'number', 'password', 'search', 'tel', 'text', 'url']);

export function isPlaceholderShown(e: Element, snap: Snapshot): boolean {
  if (!snap.hasAttribute(e, 'placeholder')) return false;

  if (isHtmlTextArea(e)) {
    return e.value === '';
  }

  if (isHtmlInput(e)) {
    return PLACEHOLDER_INPUT_TYPES.has(e.type) && e.value === '';
  }

  return false;
}

const DOCUMENT_POSITION_FOLLOWING = 4;

export function isDefault(e: Element, snap: Snapshot): boolean {
  if (isHtmlOption(e)) return snap.hasAttribute(e, 'selected');

  const isInput = isHtmlInput(e);
  if (isInput && (e.type === 'checkbox' || e.type === 'radio')) {
    return snap.hasAttribute(e, 'checked');
  }

  const isButton = isHtmlButton(e);
  if (!isInput && !isButton) return false;

  const isSubmit =
    (isInput && (e.type === 'submit' || e.type === 'image')) ||
    (isButton && e.type === 'submit');

  if (!isSubmit) return false;

  // find the first submit button, which may be in or outside the form
  const form = e.form;
  if (!form) return false;

  let firstInput: Element | null = null;
  const inputs = form.ownerDocument.getElementsByTagName('input');
  for (const input of inputs) {
    if (input.form === form && (input.type === 'submit' || input.type === 'image')) {
      firstInput = input;
      break;
    }
  }

  let firstButton: Element | null = null;
  const buttons = form.ownerDocument.getElementsByTagName('button');
  for (const button of buttons) {
    if (button.form === form && button.type === 'submit') {
      firstButton = button;
      break;
    }
  }

  const firstSubmit =
    !firstInput ? firstButton :
    !firstButton ? firstInput :
    (firstInput.compareDocumentPosition(firstButton) & DOCUMENT_POSITION_FOLLOWING)
      ? firstInput
      : firstButton;

  return firstSubmit === e;
}

export function isChecked(e: Element): boolean {
  if (isHtmlInput(e)) return (e.type === 'checkbox' || e.type === 'radio') && e.checked;
  if (isHtmlOption(e)) return e.selected;
  return false;
}

export function isIndeterminate(e: Element, snap: Snapshot): boolean {
  // progress elements with no value content attribute
  if (isHtmlProgress(e)) return !snap.hasAttribute(e, 'value');

  if (!isHtmlInput(e)) return false;

  // input elements whose type attribute is in the Checkbox state
  // and whose indeterminate IDL attribute is set to true
  if (e.type === 'checkbox') return e.indeterminate;

  // input elements whose type attribute is in the Radio Button state
  // and whose radio button group contains no checked input
  if (e.type !== 'radio') return false;
  if (e.checked) return false;


  // Radio groups require a non-empty name attribute; an unnamed unchecked radio is alone,
  // so its group contains no checked input.
  const name = snap.getAttribute(e, 'name');
  if (!name) return true;

  const root = e.getRootNode();
  const inputs = e.ownerDocument.getElementsByTagName('input');

  for (const input of inputs) {
    // Same radio group: radio state, same form owner, same tree,
    // non-empty equal name attribute, and checkedness state is true.
    if (
      input !== e &&
      input.type === 'radio' &&
      input.form === e.form &&
      input.getRootNode() === root &&
      snap.getAttribute(input, 'name') === name &&
      input.checked
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

export function isRequired(e: Element, snap: Snapshot): boolean {
  if (isHtmlSelect(e) || isHtmlTextArea(e)) {
    return snap.hasAttribute(e, 'required');
  }

  if (isHtmlInput(e)) {
    return REQUIRED_INPUT_TYPES.has(e.type) && snap.hasAttribute(e, 'required');
  }

  return false;
}

export function isOptional(e: Element, snap: Snapshot): boolean {
  return (isHtmlInput(e) || isHtmlSelect(e) || isHtmlTextArea(e)) && !isRequired(e, snap);
}

export function isInvalid(e: Element): boolean {
  if (isHtmlForm(e)) return !e.checkValidity();

  if (isHtmlFieldSet(e)) {
    return hasInvalidDescendant(e);
  }

  if (isValidityElement(e)) {
    return e.willValidate && !e.checkValidity();
  }

  return false;
}

export function isValid(e: Element): boolean {
  if (isHtmlForm(e)) return e.checkValidity();

  if (isHtmlFieldSet(e)) {
    return !hasInvalidDescendant(e);
  }

  if (isValidityElement(e)) {
    return e.willValidate && e.checkValidity();
  }

  return false;
}

function hasInvalidDescendant(root: Element): boolean {
  for (let node = root.firstElementChild; node; node = nextDescendant(root, node)) {
    if (isInvalid(node)) return true;
  }
  return false;
}

function isRangeInput(e: Element, snap: Snapshot): e is HTMLInputElement {
  if (!isHtmlInput(e)) return false;

  switch (e.type) {
    case 'range':
      return true;

    case 'date': case 'datetime-local': case 'month': case 'number': case 'time': case 'week':
      return snap.hasAttribute(e, 'min') || snap.hasAttribute(e, 'max');

    default:
      return false;
  }
}

export function isInRange(e: Element, snap: Snapshot): boolean {
  if (!isRangeInput(e, snap) || !e.willValidate) return false;

  const validity = e.validity;
  return !validity.rangeUnderflow && !validity.rangeOverflow;
}

export function isOutOfRange(e: Element, snap: Snapshot): boolean {
  if (!isRangeInput(e, snap) || !e.willValidate) return false;

  const validity = e.validity;
  return validity.rangeUnderflow || validity.rangeOverflow;
}

function getMediaElement(e: Element): HTMLMediaElement | null {
  if (isHtmlMediaElement(e)) return e;
  const parent = e.parentElement;
  return parent && isHtmlMediaElement(parent) ? parent : null;
}

export function isPlaying(e: Element): boolean {
  const media = getMediaElement(e);
  return !!media && media.currentTime > 0 && !media.paused && !media.ended && media.readyState > 2;
}

export function isPaused(e: Element): boolean {
  const media = getMediaElement(e);
  return !!media && media.paused;
}

export function isSeeking(e: Element): boolean {
  const media = getMediaElement(e);
  return !!media && media.seeking;
}

export function isMuted(e: Element): boolean {
  const media = getMediaElement(e);
  return !!media && media.muted;
}

export function isHost(_e: Element, _snap: Snapshot): boolean {
  return false;
  // not yet implemented
}

type FrontierPredicate = (e: Element, rc: RuntimeCache | null) => boolean;

export function frontierNext(xs: Element[], pred: FrontierPredicate, rc: RuntimeCache | null): Element[] {
  const out: Element[] = [];
  let j = -1;

  for (let i = 0; i < xs.length; i++) {
    const e = xs[i].nextElementSibling;
    if (e && pred(e, rc)) out[++j] = e;
  }

  return out;
}

export function frontierFollowing(xs: Element[], pred: FrontierPredicate, rc: RuntimeCache | null): Element[] {
  const out: Element[] = [];
  const seen = new Set<Element>();

  for (let i = 0; i < xs.length; i++) {
    for (let e = xs[i].nextElementSibling; e; e = e.nextElementSibling) {
      if (pred(e, rc) && !seen.has(e)) {
        seen.add(e);
        out[out.length] = e;
      }
    }
  }

  return out;
}

export function frontierChildren(xs: Element[], pred: FrontierPredicate, rc: RuntimeCache | null): Element[] {
  const out: Element[] = [];
  let j = -1;

  for (let i = 0; i < xs.length; i++) {
    for (let e = xs[i].firstElementChild; e; e = e.nextElementSibling) {
      if (pred(e, rc)) out[++j] = e;
    }
  }

  return out;
}

export function applyFilter(
  candidates: Element[],
  pred: (e: Element, w: Element[] | null, rc: RuntimeCache | null) => boolean,
  witnesses: Element[] | null,
  rc: RuntimeCache | null,
): Element[] {
  const out: Element[] = [];
  let j = 0;

  for (let i = 0; i < candidates.length; i++) {
    const e = candidates[i];
    if (pred(e, witnesses, rc)) out[j++] = e;
  }

  return out;
}

function inElementSet(xs: Element[] | null, e: Element): boolean {
  if (!xs) return false;

  for (let i = 0; i < xs.length; i++) {
    if (xs[i] === e) return true;
  }

  return false;
}

export function matchAncestorInSet(e: Element, xs: Element[] | null): boolean {
  for (let p = e.parentElement; p; p = p.parentElement) {
    if (inElementSet(xs, p)) return true;
  }

  return false;
}

export function matchParentInSet(e: Element, xs: Element[] | null): boolean {
  const p = e.parentElement;
  return p !== null && inElementSet(xs, p);
}

export function matchPrevInSet(e: Element, xs: Element[] | null): boolean {
  const p = e.previousElementSibling;
  return p !== null && inElementSet(xs, p);
}

export function matchPrevAnyInSet(e: Element, xs: Element[] | null): boolean {
  for (let p = e.previousElementSibling; p; p = p.previousElementSibling) {
    if (inElementSet(xs, p)) return true;
  }

  return false;
}

export function matchAncestorW(
  e: Element,
  pred: (e: Element, w: Element[] | null, rc: RuntimeCache | null) => boolean,
  w: Element[] | null,
  rc: RuntimeCache | null,
): boolean {
  for (let p = e.parentElement; p; p = p.parentElement) {
    if (pred(p, w, rc)) return true;
  }

  return false;
}

export function matchParentW(
  e: Element,
  pred: (e: Element, w: Element[] | null, rc: RuntimeCache | null) => boolean,
  w: Element[] | null,
  rc: RuntimeCache | null,
): boolean {
  const p = e.parentElement;
  return p !== null && pred(p, w, rc);
}

export function matchPrevW(
  e: Element,
  pred: (e: Element, w: Element[] | null, rc: RuntimeCache | null) => boolean,
  w: Element[] | null,
  rc: RuntimeCache | null,
): boolean {
  const p = e.previousElementSibling;
  return p !== null && pred(p, w, rc);
}

export function matchPrevAnyW(
  e: Element,
  pred: (e: Element, w: Element[] | null, rc: RuntimeCache | null) => boolean,
  w: Element[] | null,
  rc: RuntimeCache | null,
): boolean {
  for (let p = e.previousElementSibling; p; p = p.previousElementSibling) {
    if (pred(p, w, rc)) return true;
  }

  return false;
}
