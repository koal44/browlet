import type { DOMElement as Element } from '../../infra/index';

import { ValueStage } from '../value-processing/index';
import {
  propertyRegistry, resolveBuiltInPropertyDeclaration, type PropertyContext, type PropertyDeclaration, type PropertyName,
} from '../props/index';
import { CSSDeclarationBlock, parseDeclarationBlock } from '../cssom/declarations/index';
import { CSSStylePropertiesImpl } from '../cssom/index';

import type { CascadeEngine } from './cascade-engine';
import type { TreeScope } from './tree-scope';

export function computeStyle(
  engine: CascadeEngine,
  element: Element,
  scope: TreeScope,
): CSSStylePropertiesImpl {
  const dom = engine.context.dom;
  const block = dom.inlineStyleBlock?.(element);
  // An absent provider permits text fallback; a provider's empty result is authoritative.
  const declarations = block === undefined
    ? parseDeclarationBlock(
      dom.getAttributeNS(element, null, 'style') ?? '',
      {},
    )
    : block instanceof CSSDeclarationBlock ? block.declarations : [];
  const computed: PropertyDeclaration[] = [];

  for (const name of Object.keys(propertyRegistry) as PropertyName[]) {
    const inline = declarations.find(
      (declaration) => declaration.name === name,
    );
    const cascaded = engine.getCascadedPropertyForElement(name, element, scope);

    let selected: PropertyDeclaration | undefined;
    let context: PropertyContext = {
      URL: engine.context.env.userAgent.URL,
      treeScope: scope,
      ...(engine.environmentBaseUrl === undefined
        ? {}
        : { baseUrl: engine.environmentBaseUrl }),
    };

    if (
      inline !== undefined &&
      (cascaded === null || inline.important || !cascaded.declaration.important)
    ) {
      selected = inline;
    } else if (cascaded !== null) {
      selected = cascaded.declaration;
      context = engine.getPropertyContext(cascaded);
    }

    // TODO: Apply the property's initial/inherited metadata and CSS-wide defaulting.
    if (selected === undefined || selected.custom) continue;

    const resolved = resolveBuiltInPropertyDeclaration(
      selected,
      ValueStage.Computed,
      context,
    );
    computed.push(resolved);
  }

  return new CSSStylePropertiesImpl({
    computed: true,
    block: new CSSDeclarationBlock(computed),
    readonly: true,
  }, engine.context.env);
}
