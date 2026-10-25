import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { serializeURL, type URLRecord } from '../../../../src/url/core/index';
import { OptionalDeclarationValue } from '../../../../src/stylelet/values/declaration-value';
import { RuleListContext } from '../../../../src/stylelet/cssom/rules/context';
import { parseStylesheetContents } from '../../../../src/stylelet/syntax/parser';
import type { CSSStyleRuleImpl } from '../../../../src/stylelet/cssom/rules/style';
import type { CSSNestedDeclarationsImpl } from '../../../../src/stylelet/cssom/rules/nested-declarations';
import { CSSStyleSheetImpl } from '../../../../src/stylelet/cssom/css-stylesheet';
import {
  CascadeEngine, type CascadeEngineOptions,
} from '../../../../src/stylelet/engine/cascade-engine';
import { TreeScope } from '../../../../src/stylelet/engine/tree-scope';
import { StyleletContext } from '../../../../src/stylelet/context';
import { createBrowletDocument } from '../../browlet-document';
import { styleletEnv } from '../../environment-fixture';
import { parseURL } from '../../url-fixture';

describe('cascade engine', () => {
  it('retains property records in computed values, including inherited custom properties', () => {
    const document = createBrowletDocument('<main><span></span></main>');
    const { engine, scope } = createCascade({ context: new StyleletContext(document, document.env) });
    const sheet = addStyleSheet(scope, 'main { --base: 10px; --gap: var(--base); color: red } span { --base: 20px }');
    const rule = sheet.cssRules.item(0) as CSSStyleRuleImpl;
    const gap = rule.style.getDeclaration('--gap')!;
    const color = rule.style.getDeclaration('color')!;
    const parent = engine.getComputedStyle(document.querySelector('main')!, scope);
    const child = engine.getComputedStyle(document.querySelector('span')!, scope);

    expect(parent.computedStyle!.get('color')!.property).toBe(color.property);
    expect(parent.computedStyle!.get('--gap')!.property).toBe(gap.property);
    expect(child.computedStyle!.get('--gap')!.property).toBe(gap.property);
    expect(parent.declarations).toEqual([]);
    expect(parent.getDeclaration('color')).toBeUndefined();
    expect(child.getPropertyValue('--gap')).toBe('10px');
    expect(gap.serializeValue()).toBe('var(--base)');
  });

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

    const color = engine.getCascadedProperty('color', scope)!;
    expect(color.styleSheet).toBe(styleSheet);
    expect(color.scope).toBe(scope);
    expect(color.declaration).toMatchObject({
      custom: false,
      name: 'color',
    });
    expect(color.declaration).toHaveProperty('value.inner.repr', expect.any(OptionalDeclarationValue));
    const accent = engine.getCascadedProperty('--accent', scope)!;
    expect(accent.styleSheet).toBe(styleSheet);
    expect(accent.scope).toBe(scope);
    expect(accent.declaration).toMatchObject({
      custom: true,
      name: '--accent',
    });
  });

  it('derives URL context from stylesheet provenance and the environment', () => {
    const environmentBaseUrl = parseURL('https://example.com/document/')!;
    const location = parseURL('https://example.com/styles/site.css')!;
    const explicitBaseUrl = parseURL('https://cdn.example.com/assets/')!;
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
    const document = createBrowletDocument();
    const location = parseURL('https://example.com/constructed/')!;
    Object.defineProperty(document, 'baseURI', { value: serializeURL(location) });
    const { engine, scope } = createCascade({
      environmentBaseUrl: parseURL('https://example.com/environment/')!,
      context: new StyleletContext(document, document.env),
    });
    const styleSheet = engine.createStyleSheet();
    styleSheet.replaceSync('* { color: red }');
    scope.adoptedStyleSheets.push(styleSheet);

    const property = engine.getCascadedProperty('color', scope)!;

    expect(serializeURL(engine.getPropertyContext(property).baseUrl!)).toBe(serializeURL(location));
  });

  it('captures an embedded stylesheet base when its source is parsed', () => {
    const document = createBrowletDocument();
    const baseUrl = parseURL('https://example.com/embedded/')!;
    Object.defineProperty(document, 'baseURI', { value: serializeURL(baseUrl) });
    const { engine, scope } = createCascade({
      environmentBaseUrl: parseURL('https://example.com/environment/')!,
      context: new StyleletContext(document, document.env),
    });
    const ownerNode = document.createElement('style');
    scope.createStyleElementStyleSheet(ownerNode, '* { color: red }');

    const property = engine.getCascadedProperty('color', scope)!;

    expect(serializeURL(engine.getPropertyContext(property).baseUrl!)).toBe(serializeURL(baseUrl));
  });

  it('distinguishes separate tree-scope uses of an adopted stylesheet', () => {
    const document = new JSDOM('<main></main>', {
      url: 'https://example.com/',
    }).window.document;
    const shadowRoot = document.querySelector('main')!
      .attachShadow({ mode: 'open' });
    const { engine } = createCascade({ context: new StyleletContext(document, styleletEnv) });
    const documentScope = new TreeScope(document, engine);
    const shadowScope = new TreeScope(shadowRoot, engine);
    const styleSheet = engine.createStyleSheet();
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
    const styleSheet = engine.createStyleSheet();
    scope.adoptedStyleSheets.push(styleSheet);

    styleSheet.replaceSync('* { color: red }');
    expect(engine.getCascadedProperty('color', scope)?.declaration)
      .toMatchObject({ name: 'color' });

    const rule = styleSheet.cssRules.item(0) as CSSStyleRuleImpl;
    rule.style.setProperty('color', 'blue');
    expect(engine.getCascadedProperty('color', scope)!.declaration.serializeValue()).toBe('blue');

    styleSheet.insertRule('* { opacity: 0.5 }');
    expect(engine.getCascadedProperty('opacity', scope)?.declaration)
      .toMatchObject({ name: 'opacity' });

    styleSheet.deleteRule(0);
    expect(engine.getCascadedProperty('opacity', scope)).toBeNull();
  });

  it('matches a target and sorts author declarations by cascade precedence', () => {
    const document = createBrowletDocument(
      '<main id="target" class="target"></main>',
    );
    const target = document.getElementById('target')!;
    const { engine, scope } = createCascade({
      context: new StyleletContext(document, document.env),
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
    expect(result!.declaration.serializeValue())
      .toBe('blue');
  });

  it('reads non-origin-clean rules without using the restricted CSSOM getter', () => {
    const { engine, scope } = createCascade();
    const sheet = addStyleSheet(scope, '* { color: red }', { originClean: false });

    expect(() => sheet.cssRules).toThrow('The stylesheet is not origin-clean.');
    expect(engine.getCascadedProperty('color', scope)!.declaration.serializeValue()).toBe('red');
  });

  it('reads declarations after nested rules in order without copying parent edits over them', () => {
    const { engine, scope } = createCascade();
    const sheet = addStyleSheet(scope, `
      * {
        color: red;
        .child { opacity: 0.5 }
        color: blue;
      }
    `);
    const parent = sheet.cssRules.item(0) as CSSStyleRuleImpl;
    const following = parent.cssRules.item(1) as CSSNestedDeclarationsImpl;
    const color = () => engine.getCascadedProperty('color', scope)!.declaration;

    expect(color()).toBe(following.style.getDeclaration('color'));
    parent.style.setProperty('color', 'green');
    expect(color()).toBe(following.style.getDeclaration('color'));
    parent.style.setProperty('color', 'green', 'important');
    expect(color()).toBe(parent.style.getDeclaration('color'));
    following.style.setProperty('color', 'blue', 'important');
    expect(color()).toBe(following.style.getDeclaration('color'));
    following.style.removeProperty('color');
    expect(color()).toBe(parent.style.getDeclaration('color'));
  });
});

function createCascade(options: Partial<CascadeEngineOptions> = {}) {
  let context = options.context;
  if (context === undefined) {
    const document = createBrowletDocument();
    context = new StyleletContext(document, document.env);
  }
  const engine = new CascadeEngine({ ...options, context });

  return {
    engine,
    scope: new TreeScope(context.document, engine),
  };
}

function addStyleSheet(
  scope: TreeScope,
  source: string,
  options: StyleSheetOptions = {},
): CSSStyleSheetImpl {
  const styleSheet = CSSStyleSheetImpl.create(
    scope.cascade.context,
    {
      location: options.location ?? null,
      baseURL: options.baseUrl,
      parentStyleSheet: null,
      ownerNode: null,
      ownerRule: null,
      media: '',
      title: '',
      alternate: false,
      originClean: options.originClean ?? true,
    },
  );
  styleSheet.replaceRules(parseStylesheetContents(source, new RuleListContext(styleSheet.ruleList, null, false, scope.cascade.context.env)));

  scope.addTreeStyleSheet(styleSheet);
  return styleSheet;
}

type StyleSheetOptions = {
  location?: URLRecord;
  baseUrl?: URLRecord;
  originClean?: boolean;
};
