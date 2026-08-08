import { describe, expect, it } from 'vitest';

import { parseStylesheet } from '../../../../src/stylelet/css/stylesheet';
import { createTreeScope } from '../../../../src/stylelet/css/tree-scope';
import { StyleEngine } from '../../../../src/stylelet/engine/engine';

describe('style engine', () => {
  it('adds active stylesheets in document order', () => {
    const first = parseStylesheet('* { color: red }');
    const second = parseStylesheet('* { color: blue }');
    const engine = new StyleEngine();

    const firstAssociation = engine.addStyleSheet(first);
    const secondAssociation = engine.addStyleSheet(second);

    expect(engine.activeStyleSheets).toEqual([
      firstAssociation,
      secondAssociation,
    ]);
    expect(firstAssociation).toEqual({
      styleSheet: first,
      treeScope: engine.treeScope,
    });
    expect(secondAssociation).toEqual({
      styleSheet: second,
      treeScope: engine.treeScope,
    });
  });

  it('finds an unambiguous property through the cascade boundary', () => {
    const engine = new StyleEngine();
    const sheet = parseStylesheet(`
      * {
        --accent: red;
        color: var(--accent);
      }
    `);
    engine.addStyleSheet(sheet);

    expect(engine.getCascadedProperty('color')).toMatchObject({
      declaration: {
        type: 'property-declaration',
        custom: false,
        name: 'color',
        value: { type: 'substitution-value' },
      },
      association: {
        styleSheet: sheet,
        treeScope: engine.treeScope,
      },
    });
    expect(engine.getCascadedProperty('--accent')).toMatchObject({
      declaration: {
        type: 'property-declaration',
        custom: true,
        name: '--accent',
      },
      association: {
        styleSheet: sheet,
        treeScope: engine.treeScope,
      },
    });
  });

  it('derives URL context from stylesheet provenance and the environment', () => {
    const environmentBaseUrl = new URL('https://example.com/document/');
    const location = new URL('https://example.com/styles/site.css');
    const explicitBaseUrl = new URL('https://cdn.example.com/assets/');
    const context = (
      options: Parameters<typeof parseStylesheet>[1] = {},
    ) => {
      const engine = new StyleEngine({ environmentBaseUrl });
      engine.addStyleSheet(parseStylesheet('* { color: red }', options));

      return engine.getPropertyContext(
        engine.getCascadedProperty('color')!,
      );
    };

    expect([
      context().baseUrl,
      context({ location }).baseUrl,
      context({ location, baseUrl: explicitBaseUrl }).baseUrl,
    ]).toEqual([
      environmentBaseUrl,
      location,
      explicitBaseUrl,
    ]);
  });

  it('distinguishes separate tree-scope uses of a shared stylesheet', () => {
    const documentScope = createTreeScope();
    const shadowScope = createTreeScope();
    const engine = new StyleEngine({ treeScope: documentScope });
    const sheet = parseStylesheet('* { color: red }');
    const documentAssociation = engine.addStyleSheet(sheet);
    const shadowAssociation = engine.addStyleSheet(sheet, shadowScope);
    const documentProperty = engine.getCascadedProperty('color')!;
    const shadowProperty = engine.getCascadedProperty('color', shadowScope)!;

    expect(documentProperty.association).toBe(documentAssociation);
    expect(shadowProperty.association).toBe(shadowAssociation);
    expect(engine.getPropertyContext(documentProperty).treeScope)
      .toBe(documentScope);
    expect(engine.getPropertyContext(shadowProperty).treeScope)
      .toBe(shadowScope);
  });
});
