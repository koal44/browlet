import {
  propertyRegistry,
  resolveBuiltInPropertyDeclaration,
  type PropertyContext, type PropertyDeclaration, type PropertyName,
} from '../css/property';
import type { CascadeEngine } from './cascade-engine';
import type { DocumentOrShadowRootStyleState } from './document-or-shadow-root';
import { ValueStage } from '../value-processing/stage';
import {
  CSSStyleDeclarationImpl, parseDeclarationBlock,
} from '../cssom/declaration';

export function computeStyle(
  engine: CascadeEngine,
  element: Element,
  state: DocumentOrShadowRootStyleState,
): CSSStyleDeclaration {
  const declarations = 'style' in element &&
    element.style instanceof CSSStyleDeclarationImpl
    ? element.style.__declarations
    : parseDeclarationBlock(element.getAttribute('style') ?? '');
  const computed: PropertyDeclaration[] = [];

  for (const name of Object.keys(propertyRegistry) as PropertyName[]) {
    const inline = declarations.find(
      (declaration) => declaration.name === name,
    );
    const cascaded = engine.getCascadedPropertyForElement(name, element, state);

    let selected: PropertyDeclaration | undefined;
    let context: PropertyContext = {
      treeScope: state,
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
  });
}
