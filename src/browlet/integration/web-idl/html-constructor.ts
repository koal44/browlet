import { HTML_NAMESPACE } from '../../../infra/index';
import { hasExtendedAttribute, type AssembledInterface, type HTMLConstructorBinding } from '../../../web-idl/index';

import { ElementImpl } from '../../dom/nodes/index';
import { alreadyConstructed } from '../../dom/nodes/html/custom-elements/index';
import type { WindowEnvironment } from '../../environment';

/** Prepare [HTMLConstructor] superclass steps for custom-element construction; invocation supplies its realm. */
// BINDING_INTEGRATION: HTML owns definition selection and construction stacks; Binding owns platform identity and prototypes.
// https://html.spec.whatwg.org/multipage/dom.html#html-element-constructors
export function prepareCustomElementConstructor(
  owner: AssembledInterface,
): HTMLConstructorBinding<WindowEnvironment> | undefined {
  if (!owner.members.some(({ member }) => member.kind === 'constructor' &&
    hasExtendedAttribute(member.extendedAttributes, 'HTMLConstructor'))) return;
  const autonomous = owner.primary.name === 'HTMLElement';
  const validLocalNames = new Set(owner.primary.localNames ?? []);
  if (owner.primary.namespaceURI === HTML_NAMESPACE) {
    for (const implementation of owner.implementations) {
      const constructor = implementation.implClass as typeof ElementImpl;
      if (constructor.localName !== undefined) validLocalNames.add(constructor.localName);
    }
  }

  return (ctx, newTarget, activeFunction) => {
    const env = ctx.getEnvironment();
    if (newTarget === activeFunction) throw new env.exec.TypeError('Illegal constructor');

    const activeRegistry = newTarget === undefined ? undefined :
      env.realm.agent.activeCustomElementConstructorMap.get(newTarget);
    const registry = activeRegistry ?? env.window.getAssociatedDocument().customElementRegistry;
    const definition = registry?.getDefinitionForConstructor(newTarget);
    if (definition === undefined || newTarget === undefined) {
      throw new env.exec.TypeError('No custom element definition for this constructor');
    }

    let isValue: string | null = null;
    if (definition.localName === definition.name) {
      if (!autonomous) throw new env.exec.TypeError('Autonomous custom elements must extend HTMLElement');
    } else {
      if (!validLocalNames.has(definition.localName)) {
        throw new env.exec.TypeError('Custom element local name does not use this interface');
      }
      isValue = definition.name;
    }

    // Choose the branch before reading author-controlled newTarget.prototype.
    const stack = definition.constructionStack;
    const create = stack.length === 0;
    const prototype = ctx.getPlatformObjectPrototype(owner, newTarget);
    if (create) {
      const document = env.window.getAssociatedDocument();
      // The DOM factory establishes the current document, namespace, prefix, local name,
      // registry, and is value. It retains the document's node-allocation dependencies.
      const element = document.createElementNode(definition.localName, HTML_NAMESPACE, null, isValue, registry);
      element.customElementState = 'custom';
      element.customElementDefinition = definition;
      const platform = ctx.project(ElementImpl, element);
      Object.setPrototypeOf(platform, prototype);
      return platform;
    }

    // Upgrade owns pushing/popping; reentrant prototype access can change the last entry.
    const element = stack[stack.length - 1]!;
    if (element === alreadyConstructed) throw new env.exec.TypeError('Custom element is already constructed');
    const platform = ctx.project(ElementImpl, element);
    // SPEC_CLASH(html-constructor-nonextensible-upgrade): follow HTML and Chromium; Firefox/WebKit throw on false.
    Reflect.setPrototypeOf(platform, prototype);
    stack[stack.length - 1] = alreadyConstructed;
    return platform;
  };
}
