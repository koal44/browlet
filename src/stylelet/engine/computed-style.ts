import type { DOMNode as Element } from '../../infra/index';
import {
  propertyRegistry,
  resolveBuiltInPropertyDeclaration,
  type PropertyContext, type PropertyDeclaration, type PropertyName,
} from '../css/property';
import type { CascadeEngine } from './cascade-engine';
import type { TreeScope } from './tree-scope';
import { ValueStage } from '../value-processing/stage';
import {
  CSSStyleDeclarationImpl, parseDeclarationBlock,
} from '../cssom/declaration';

export function computeStyle(
  engine: CascadeEngine,
  element: Element,
  scope: TreeScope,
): CSSStyleDeclarationImpl {
  const dom = engine.context.dom;
  const style = dom.inlineStyle?.(element);
  const declarations = style instanceof CSSStyleDeclarationImpl
    ? style.declarations
    : parseDeclarationBlock(dom.getAttribute(element, 'style') ?? '');
  const computed: PropertyDeclaration[] = [];

  for (const name of Object.keys(propertyRegistry) as PropertyName[]) {
    const inline = declarations.find(
      (declaration) => declaration.name === name,
    );
    const cascaded = engine.getCascadedPropertyForElement(name, element, scope);

    let selected: PropertyDeclaration | undefined;
    let context: PropertyContext = {
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

    if (selected === undefined || selected.custom) continue;

    const resolved = resolveBuiltInPropertyDeclaration(
      selected,
      ValueStage.Computed,
      context,
    );
    if (resolved !== null) computed.push(resolved);
  }

  return new CSSStyleDeclarationImpl({
    computed: true,
    declarations: computed,
    readonly: true,
  }, engine.context.env);
}
