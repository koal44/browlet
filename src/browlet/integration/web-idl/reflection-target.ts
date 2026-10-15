import type { ElementImpl } from '../../dom/nodes/index';
import type { ElementInternalsImpl } from '../../dom/nodes/html/custom-elements/index';

/** The actual object whose IDL attribute reflects content attributes. */
export type ReflectedTarget = ElementImpl | ElementInternalsImpl;

/** Binding adapters selected once from the declaration's owning implementation. */
export type ReflectionTargetSteps<T extends ReflectedTarget> = {
  /** Obtain the element whose document supplies URL resolution. */
  // https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#get-the-element
  getElement: (target: T) => ElementImpl;
  /** Read the owner's content attribute, preserving absence as null. */
  // https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#get-the-content-attribute
  getContentAttribute: (target: T, name: string) => string | null;
  /** Set the owner's content attribute through its applicable mutation steps. */
  // https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#set-the-content-attribute
  setContentAttribute: (target: T, name: string, value: string) => void;
  /** Remove the owner's content attribute. */
  // https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#delete-the-content-attribute
  deleteContentAttribute: (target: T, name: string) => void;
};

/** Ordinary reflection reads and mutates null-namespace DOM attributes. */
export const elementReflection: ReflectionTargetSteps<ElementImpl> = {
  getElement: (target) => target,
  getContentAttribute: (target, name) => target.getAttributeNS(null, name),
  setContentAttribute: (target, name, value) => { target.setAttributeValue(name, value); },
  deleteContentAttribute: (target, name) => { target.removeAttributeNS(null, name); },
};

/** Internals reflect their target element's separate content-attribute map. */
export const internalsReflection: ReflectionTargetSteps<ElementInternalsImpl> = {
  getElement: (target) => target.targetElement,
  getContentAttribute: (target, name) => target.getContentAttribute(name),
  setContentAttribute: (target, name, value) => { target.setContentAttribute(name, value); },
  deleteContentAttribute: (target, name) => { target.deleteContentAttribute(name); },
};
