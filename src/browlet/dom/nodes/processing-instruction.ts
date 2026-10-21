import {
  arg, atArg, ctor, defineIncludes, defineInterface, idlType, impl, nullable, op, roAttr, sequence,
  DOMExceptionImpl, DOMExceptionNames,
} from '../../../web-idl/core/index';
import type { CSSStyleSheetImpl } from '../../../stylelet/index';

import { isValidAttributeLocalName, isXMLName, parsePseudoAttributes } from '../infra/index';
import { ProcessingInstructionLinkStyleMixin } from '../../style/index';
import type { DOMEnvironment } from '../environment';

import { NodeType } from './node';
import { CharacterDataImpl } from './character-data';
import type { DocumentImpl } from './document';

/** Processing-instruction target and character data retained in a document. */
// https://dom.spec.whatwg.org/#interface-processinginstruction
export class ProcessingInstructionImpl extends CharacterDataImpl {
  /** Application to which this processing instruction is directed. */
  target: string;
  /** Whether the current data satisfies XML's pseudo-attribute grammar, including after DOM setters. */
  pseudoAttributesAreWellFormed = true;
  /** Parsed pseudo-attributes; malformed data produces an empty map. */
  #attributeMap = new Map<string, string>();
  /** CSS association controlled by this instruction's data and prolog membership. */
  #linkStyleMixin = new ProcessingInstructionLinkStyleMixin(this);

  constructor(target: string, data: string, ownerDoc: DocumentImpl) {
    super(NodeType.ProcessingInstruction, data, ownerDoc);
    if (!isXMLName(target) || data.includes('?>')) {
      throw new DOMExceptionImpl('', DOMExceptionNames.invalidCharacter);
    }
    this.target = target;
    this.updateAttributesFromData();
  }

  /** CSS sheet associated with this instruction, if its resource has been accepted. */
  get sheet(): CSSStyleSheetImpl | null { return this.#linkStyleMixin.sheet; }

  /** Notify the stylesheet owner after the pseudo-attribute map has been updated. */
  updateStyleSheet(): void { this.#linkStyleMixin.update(); }

  /** Supply document-maintained prolog membership without restarting unchanged instructions. */
  setInProlog(inProlog: boolean): void { this.#linkStyleMixin.setInProlog(inProlog); }

  /** Synchronize pseudo-attributes after character-data replacement. */
  // https://dom.spec.whatwg.org/#update-attributes-from-data
  updateAttributesFromData(): void {
    const attributes = parsePseudoAttributes(this.data);
    this.pseudoAttributesAreWellFormed = attributes !== null;
    this.#attributeMap = attributes ?? new Map<string, string>();
  }

  /** Serialize pseudo-attributes and replace character data without parsing them again. */
  // https://dom.spec.whatwg.org/#update-data-from-attributes
  updateDataFromAttributes(): void {
    const attributes: string[] = [];
    this.pseudoAttributesAreWellFormed = true;
    for (const [name, value] of this.#attributeMap) {
      // DOM setters accept attribute local names that are not XML Names.
      if (!isXMLName(name)) this.pseudoAttributesAreWellFormed = false;
      const escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      attributes.push(`${name}="${escaped}"`);
    }
    this.replaceData(0, this.length, attributes.join(' '), true);
  }

  /** Whether the parsed instruction contains pseudo-attributes. */
  hasAttributes(): boolean { return this.#attributeMap.size !== 0; }

  /** Attribute names in their parsed or insertion order. */
  getAttributeNames(): string[] { return [...this.#attributeMap.keys()]; }

  /** Read a pseudo-attribute without parsing the data again. */
  getAttribute(name: string): string | null { return this.#attributeMap.get(name) ?? null; }

  /** Set a pseudo-attribute and update the character data through the mutation path. */
  // https://dom.spec.whatwg.org/#dom-processinginstruction-setattribute
  setAttribute(name: string, value: string): void {
    if (!isValidAttributeLocalName(name)) throw new DOMExceptionImpl('', DOMExceptionNames.invalidCharacter);
    this.#attributeMap.set(name, value);
    this.updateDataFromAttributes();
  }

  /** Remove a pseudo-attribute and serialize even when the name was absent. */
  // https://dom.spec.whatwg.org/#dom-processinginstruction-removeattribute
  removeAttribute(name: string): void {
    this.#attributeMap.delete(name);
    this.updateDataFromAttributes();
  }

  /** Toggle a pseudo-attribute, preserving the data when force requests no change. */
  // https://dom.spec.whatwg.org/#dom-processinginstruction-toggleattribute
  toggleAttribute(name: string, force?: boolean): boolean {
    if (!isValidAttributeLocalName(name)) throw new DOMExceptionImpl('', DOMExceptionNames.invalidCharacter);
    if (!this.#attributeMap.has(name)) {
      if (force === false) return false;
      this.#attributeMap.set(name, '');
      this.updateDataFromAttributes();
      return true;
    }
    if (force === true) return true;
    this.#attributeMap.delete(name);
    this.updateDataFromAttributes();
    return false;
  }

  /** Whether the parsed map contains name, including an empty value. */
  hasAttribute(name: string): boolean { return this.#attributeMap.has(name); }

  /** Refresh stylesheet participation and order after a state-preserving move. */
  protected override movingSteps(): void {
    this.#linkStyleMixin.move();
  }

  /** Removal cancels resource work even before a later adoption changes the node document. */
  protected override removingSteps(): void {
    this.setInProlog(false);
  }
}

/*
 * [Exposed=Window]
 * interface ProcessingInstruction : CharacterData {
 *   constructor(DOMString target, optional DOMString data = "");
 *   readonly attribute DOMString target;
 *   boolean hasAttributes();
 *   sequence<DOMString> getAttributeNames();
 *   DOMString? getAttribute(DOMString name);
 *   undefined setAttribute(DOMString name, DOMString value);
 *   undefined removeAttribute(DOMString name);
 *   boolean toggleAttribute(DOMString name, optional boolean force);
 *   boolean hasAttribute(DOMString name);
 * };
 */
export const processingInstructionIDL = defineInterface<DOMEnvironment>({
  name: 'ProcessingInstruction', inherits: 'CharacterData', exposed: 'Window',
  implementation: impl(ProcessingInstructionImpl),
  members: [
    ctor(
      [arg('target', idlType.DOMString), arg('data', idlType.DOMString, { default: '', optional: true })],
      {
        constructWith: [
          atArg(2, (env) => env.realm.getAssociatedDocument()),
        ],
      },
    ),
    roAttr('target', idlType.DOMString),
    op('hasAttributes', idlType.boolean),
    op('getAttributeNames', sequence(idlType.DOMString)),
    op('getAttribute', nullable(idlType.DOMString), [arg('name', idlType.DOMString)]),
    op('setAttribute', idlType.undefined, [arg('name', idlType.DOMString), arg('value', idlType.DOMString)]),
    op('removeAttribute', idlType.undefined, [arg('name', idlType.DOMString)]),
    op('toggleAttribute', idlType.boolean,
      [arg('name', idlType.DOMString), arg('force', idlType.boolean, { optional: true })],
    ),
    op('hasAttribute', idlType.boolean, [arg('name', idlType.DOMString)]),
  ],
});

// https://drafts.csswg.org/cssom/#requirements-on-user-agents-implementing-the-xml-stylesheet-processing-instruction
/*
 * ProcessingInstruction includes LinkStyle;
 */
export const processingInstructionIncludesLinkStyleIDL = defineIncludes({
  interface: 'ProcessingInstruction', mixin: 'LinkStyle',
});
