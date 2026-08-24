import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import {
  parseHTMLDocument,
} from '../../../../src/browlet/html/parser/parse';
import { serializePropertyDeclaration } from '../../../../src/stylelet/css/property';
import {
  parseStylesheet, type StyleSheetOptions,
} from '../../../../src/stylelet/css/stylesheet';
import { CSSStyleSheetImpl } from '../../../../src/stylelet/cssom/css-stylesheet';
import {
  CascadeEngine, type CascadeEngineOptions,
} from '../../../../src/stylelet/engine/cascade-engine';
import { TreeScope } from '../../../../src/stylelet/engine/tree-scope';
import { Snapshot } from '../../../../src/stylelet/snapshot';

describe('cascade engine', () => {
  it('reads the root-owned final stylesheets in document order', () => {
    const { engine, scope } = createCascade();
    const first = addStyleSheet(scope, '* { color: red }');
    const second = addStyleSheet(scope, '* { color: blue }');

    expect([...scope.styleSheets]).toEqual([first, second]);
    expect([...scope.finalStyleSheets()]).toEqual([first, second]);
    expect([...engine.getActiveStyleSheets(scope)]).toEqual([first, second]);
  });

  it('derives active stylesheets from the final stylesheet list', () => {
    const { engine, scope } = createCascade();
    const disabled = addStyleSheet(scope, '* { color: red }');
    const enabled = addStyleSheet(scope, '* { color: blue }');
    disabled.disabled = true;

    expect([...scope.finalStyleSheets()]).toEqual([disabled, enabled]);
    expect([...engine.getActiveStyleSheets(scope)]).toEqual([enabled]);
  });

  it('finds an unambiguous property through the cascade boundary', () => {
    const { engine, scope } = createCascade();
    const styleSheet = addStyleSheet(scope, `
      * {
        --accent: red;
        color: var(--accent);
      }
    `);

    expect(engine.getCascadedProperty('color', scope)).toMatchObject({
      declaration: {
        type: 'property-declaration',
        custom: false,
        name: 'color',
        value: { type: 'substitution-value' },
      },
      styleSheet,
      scope,
    });
    expect(engine.getCascadedProperty('--accent', scope)).toMatchObject({
      declaration: {
        type: 'property-declaration',
        custom: true,
        name: '--accent',
      },
      styleSheet,
      scope,
    });
  });

  it('derives URL context from stylesheet provenance and the environment', () => {
    const environmentBaseUrl = new URL('https://example.com/document/');
    const location = new URL('https://example.com/styles/site.css');
    const explicitBaseUrl = new URL('https://cdn.example.com/assets/');
    const context = (options: StyleSheetOptions = {}) => {
      const { engine, scope } = createCascade({ environmentBaseUrl });
      addStyleSheet(scope, '* { color: red }', options);

      return engine.getPropertyContext(
        engine.getCascadedProperty('color', scope)!,
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

  it('captures a constructed stylesheet location at creation', () => {
    const document = createDocumentImpl('');
    const location = new URL('https://example.com/constructed/');
    Object.defineProperty(document, 'baseURI', { value: location.href });
    const { engine, scope } = createCascade({
      environmentBaseUrl: new URL('https://example.com/environment/'),
      snapshot: new Snapshot(document),
    });
    const styleSheet = engine.createStyleSheet() as CSSStyleSheetImpl;
    styleSheet.replaceSync('* { color: red }');
    scope.adoptedStyleSheets.push(styleSheet);

    const property = engine.getCascadedProperty('color', scope)!;

    expect(engine.getPropertyContext(property).baseUrl).toEqual(location);
  });

  it('captures an embedded stylesheet base when its source is parsed', () => {
    const document = createDocumentImpl('');
    const baseUrl = new URL('https://example.com/embedded/');
    Object.defineProperty(document, 'baseURI', { value: baseUrl.href });
    const { engine, scope } = createCascade({
      environmentBaseUrl: new URL('https://example.com/environment/'),
      snapshot: new Snapshot(document),
    });
    const ownerNode = document.createElement('style');
    scope.createStyleElementStyleSheet(ownerNode, '* { color: red }');

    const property = engine.getCascadedProperty('color', scope)!;

    expect(engine.getPropertyContext(property).baseUrl).toEqual(baseUrl);
  });

  it('distinguishes separate tree-scope uses of an adopted stylesheet', () => {
    const document = new JSDOM('<main></main>', {
      url: 'https://example.com/',
    }).window.document;
    const shadowRoot = document.querySelector('main')!
      .attachShadow({ mode: 'open' });
    const { engine } = createCascade({ snapshot: new Snapshot(document) });
    const documentScope = new TreeScope(document, engine);
    const shadowScope = new TreeScope(shadowRoot, engine);
    const styleSheet = engine.createStyleSheet() as CSSStyleSheetImpl;
    styleSheet.replaceSync('* { color: red }');
    documentScope.adoptedStyleSheets.push(styleSheet);
    shadowScope.adoptedStyleSheets.push(styleSheet);

    const documentProperty = engine.getCascadedProperty(
      'color',
      documentScope,
    )!;
    const shadowProperty = engine.getCascadedProperty('color', shadowScope)!;

    expect(documentProperty.styleSheet).toBe(styleSheet);
    expect(shadowProperty.styleSheet).toBe(styleSheet);
    expect(engine.getPropertyContext(documentProperty).treeScope)
      .toBe(documentScope);
    expect(engine.getPropertyContext(shadowProperty).treeScope)
      .toBe(shadowScope);
    expect(documentScope.root).toBe(document);
    expect(shadowScope.root).toBe(shadowRoot);
  });

  it('observes CSSOM rule replacement, insertion, and deletion', () => {
    const { engine, scope } = createCascade();
    const styleSheet = engine.createStyleSheet() as CSSStyleSheetImpl;
    scope.adoptedStyleSheets.push(styleSheet);

    styleSheet.replaceSync('* { color: red }');
    expect(engine.getCascadedProperty('color', scope)?.declaration)
      .toMatchObject({ name: 'color' });

    const rule = styleSheet.cssRules.item(0) as CSSStyleRule;
    rule.style.setProperty('color', 'blue');
    expect(serializePropertyDeclaration(
      engine.getCascadedProperty('color', scope)!.declaration,
    ).value).toBe('blue');

    styleSheet.insertRule('* { opacity: 0.5 }');
    expect(engine.getCascadedProperty('opacity', scope)?.declaration)
      .toMatchObject({ name: 'opacity' });

    styleSheet.deleteRule(0);
    expect(engine.getCascadedProperty('opacity', scope)).toBeNull();
  });

  it('matches a target and sorts author declarations by cascade precedence', () => {
    const document = createDocumentImpl(
      '<main id="target" class="target"></main>',
    );
    const target = document.getElementById('target')!;
    const { engine, scope } = createCascade({
      snapshot: new Snapshot(document),
    });
    addStyleSheet(scope, `
      .target { color: red !important }
      #target { color: green }
      main { color: black !important }
      .target { color: blue !important }
      .other { color: white !important }
    `);

    const result = engine.getCascadedPropertyForElement(
      'color',
      target,
      scope,
    );

    expect(result).not.toBeNull();
    expect(serializePropertyDeclaration(result!.declaration).value)
      .toBe('blue');
  });
});

function createCascade(options: Partial<CascadeEngineOptions> = {}) {
  const snapshot = options.snapshot ?? new Snapshot(createDocumentImpl(''));
  const engine = new CascadeEngine({ ...options, snapshot });

  return {
    engine,
    scope: new TreeScope(snapshot.document, engine),
  };
}

function addStyleSheet(
  scope: TreeScope,
  source: string,
  options: StyleSheetOptions = {},
): CSSStyleSheetImpl {
  const styleSheet = CSSStyleSheetImpl.__create(
    scope.cascade.snapshot,
    {
      location: options.location?.href ?? null,
      parentStyleSheet: null,
      ownerNode: null,
      ownerRule: null,
      media: '',
      title: '',
      alternate: false,
      originClean: true,
    },
    parseStylesheet(source, options),
  );

  scope.addTreeStyleSheet(styleSheet);
  return styleSheet;
}

function createDocumentImpl(source: string): Document {
  return parseHTMLDocument(source);
}
