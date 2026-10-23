import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import type { PropertyContext } from '../../../../src/stylelet/props/base-property';
import type { CustomPropertyRegistration } from '../../../../src/stylelet/props/registry';
import type { CustomPropertyName } from '../../../../src/stylelet/syntax/names';
import type { StyleletURL } from '../../../../src/stylelet/environment';
import { RuleListContext } from '../../../../src/stylelet/cssom/rules/context';
import { parseStylesheetContents } from '../../../../src/stylelet/syntax/parser';
import type { CSSRuleImpl } from '../../../../src/stylelet/cssom/rules/rule';
import { CSSPropertyRuleImpl } from '../../../../src/stylelet/cssom/rules/property';
import { CSSStyleSheetImpl } from '../../../../src/stylelet/cssom/css-stylesheet';
import {
  CascadeEngine, type CascadeEngineOptions, type CascadedProperty,
} from '../../../../src/stylelet/engine/cascade-engine';
import { TreeScope } from '../../../../src/stylelet/engine/tree-scope';
import { StyleletContext } from '../../../../src/stylelet/context';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';
import { WholeValue, RawWholeValue } from '../../../../src/stylelet/values/whole-value';
import { SyntaxValue } from '../../../../src/stylelet/values/syntax-value';
import { createBrowletDocument } from '../../browlet-document';

describe('custom property registration', () => {
  it('prefers the registered property set over stylesheet rules', () => {
    const declared = registration('--accent', 'red');
    const registered = registration('--accent', 'blue');
    const { engine, scope } = createCascade({
      registeredPropertySet: new Map([[registered.name, registered]]),
    });
    addStyleSheet(scope, propertyRules(scope, declared));

    expect(engine.collectCustomPropertyRegistry(scope).get('--accent'))
      .toBe(registered);
  });

  it('returns the last stylesheet registration in document order', () => {
    const first = registration('--accent', 'red');
    const second = registration('--accent', 'green');
    const last = registration('--accent', 'blue');
    const { engine, scope } = createCascade();
    addStyleSheet(scope, propertyRules(scope, first, second));
    addStyleSheet(scope, propertyRules(scope, last));

    expect(engine.collectCustomPropertyRegistry(scope).get('--accent')).toBe(last);
  });

  it('refreshes the registry after stylesheet and explicit registrations change', () => {
    const first = registration('--accent', 'red');
    const last = registration('--accent', 'blue');
    const other = registration('--other', 'green');
    const registeredPropertySet = new Map<CustomPropertyName, CustomPropertyRegistration>();
    const { engine, scope } = createCascade({ registeredPropertySet });
    addStyleSheet(scope, propertyRules(scope, first, other));
    const sheet = addStyleSheet(scope, propertyRules(scope, last));
    const before = engine.collectCustomPropertyRegistry(scope);
    expect(before.get('--accent')).toBe(last);
    expect(before.get('--other')).toBe(other);

    sheet.disabled = true;
    expect(engine.collectCustomPropertyRegistry(scope).get('--accent')).toBe(first);
    registeredPropertySet.set(last.name, last);
    expect(engine.collectCustomPropertyRegistry(scope).get('--accent')).toBe(last);
    registeredPropertySet.delete(last.name);
    expect(engine.collectCustomPropertyRegistry(scope).get('--accent')).toBe(first);
    expect(before.get('--accent')).toBe(last);
  });

  it('omits unregistered custom properties from the registry', () => {
    const { engine, scope } = createCascade();

    expect(engine.collectCustomPropertyRegistry(scope).has('--accent')).toBe(false);
  });

  // CSS Properties and Values API 1, 2.2. Parse-Time Behavior
  it('retains a declaration that violates a later registration', () => {
    const registered = registration('--accent', 'red');
    const { engine, scope } = createCascade({
      registeredPropertySet: new Map([[registered.name, registered]]),
    });
    const cssStyleSheet = addStyleSheet(scope, '* { --accent: 10px }');

    expect(engine.collectCustomPropertyRegistry(scope).get('--accent'))
      .toBe(registered);
    const accent = engine.getCascadedProperty('--accent', scope)!;
    expect(accent.styleSheet).toBe(cssStyleSheet);
    expect(accent.scope).toBe(scope);
    expect(accent.declaration).toMatchObject({
      custom: true,
      name: '--accent',
    });
    expect(accent.declaration.serializeValue()).toBe('10px');
  });

  // CSS Properties and Values API 1, 2.3. Specified Value-Time Behavior
  it.skip.each([
    ['inherit', false, 'blue'],
    ['initial', false, 'red'],
    ['unset', false, 'red'],
    ['unset', true, 'blue'],
  ] as const)(
    'resolves %s using a registration whose inherit flag is %s',
    (keyword, inherits, expected) => {
      const registered = registration('--accent', 'red', inherits);
      const { engine, scope } = createCascade({
        registeredPropertySet: new Map([[registered.name, registered]]),
      });
      addStyleSheet(
        scope,
        `* { --accent: ${keyword} }`,
      );

      expect(resolveSpecifiedCustomProperty(
        engine,
        scope,
        '--accent',
        'blue',
      ))
        .toBe(expected);
    },
  );

  // CSS Properties and Values API 1, 2.4. Computed Value-Time Behavior
  it('resolves a registered URL against its originating stylesheet', () => {
    const registered = registration(
      '--image',
      'url("fallback.png")',
      false,
      '<url>',
    );
    const location = new URL('https://example.com/styles/site.css');
    const { engine, scope } = createCascade({
      environmentBaseUrl: new URL('https://example.com/document/'),
      registeredPropertySet: new Map([[registered.name, registered]]),
    });
    addStyleSheet(scope,
      '* { --image: url("image.png") }',
      location,
    );

    expect(resolveCustomProperty(
      engine,
      scope,
      '--image',
      'url("inherited.png")',
      ValueStage.Computed,
    )).toBe('url("https://example.com/styles/image.png")');
  });

  it('captures a registered local URL from each root use', () => {
    const registered = registration('--image', 'url("#fallback")', false, '<url>');
    const document = new JSDOM('<main></main>', {
      url: 'https://example.com/',
    }).window.document;
    const shadowRoot = document.querySelector('main')!
      .attachShadow({ mode: 'open' });
    const { engine } = createCascade({
      registeredPropertySet: new Map([[registered.name, registered]]),
      context: new StyleletContext(document),
    });
    const documentScope = new TreeScope(document, engine);
    const shadowScope = new TreeScope(shadowRoot, engine);
    const sheet = engine.createStyleSheet();
    sheet.replaceSync('* { --image: url("#paint") }');
    documentScope.adoptedStyleSheets.push(sheet);
    shadowScope.adoptedStyleSheets.push(sheet);
    const documentProperty = engine.getCascadedProperty(
      '--image',
      documentScope,
    )!;
    const shadowProperty = engine.getCascadedProperty(
      '--image',
      shadowScope,
    )!;

    expect(resolveRegisteredCustomProperty(
      registered,
      documentProperty,
      engine,
    )).toMatchObject({
      inner: {
        repr: { local: true, treeScope: documentScope },
      },
    });
    expect(resolveRegisteredCustomProperty(
      registered,
      shadowProperty,
      engine,
    )).toMatchObject({
      inner: {
        repr: { local: true, treeScope: shadowScope },
      },
    });
  });

  it.skip.each([
    [false, 'red'],
    [true, 'blue'],
  ] as const)(
    'defaults a syntax-invalid computed value when inherit is %s',
    (inherits, expected) => {
      const registered = registration('--accent', 'red', inherits);
      const { engine, scope } = createCascade({
        registeredPropertySet: new Map([[registered.name, registered]]),
      });
      addStyleSheet(scope, '* { --accent: 10px }');

      expect(resolveCustomProperty(
        engine,
        scope,
        '--accent',
        'blue',
        ValueStage.Computed,
      )).toBe(expected);
    },
  );

  it.skip('substitutes variables in a property with universal syntax', () => {
    const registered = registration('--accent', 'red', false, '*');
    const { engine, scope } = createCascade({
      registeredPropertySet: new Map([[registered.name, registered]]),
    });
    addStyleSheet(scope, `
      * {
        --base: red;
        --accent: var(--base);
      }
    `);

    expect(resolveCustomProperty(
      engine,
      scope,
      '--accent',
      'blue',
      ValueStage.Computed,
    )).toBe('red');
  });
});

function registration(
  name: CustomPropertyName,
  initial: string,
  inherits = false,
  syntaxText = '<color>',
): CustomPropertyRegistration {
  const syntax = SyntaxValue.parse(syntaxText, {})!;
  const parseOrdinary = syntax.createParser();

  return {
    name,
    syntax,
    parse: (input, context) => WholeValue.parse(input, context, parseOrdinary, true),
    inherits,
    initialValue: WholeValue.parse(initial, {}, parseOrdinary, true)!,
  };
}

function resolveSpecifiedCustomProperty(
  engine: CascadeEngine,
  scope: TreeScope,
  name: CustomPropertyName,
  inherited: string,
): string | null {
  return resolveCustomProperty(
    engine,
    scope,
    name,
    inherited,
    ValueStage.Specified,
  );
}

function resolveRegisteredCustomProperty(
  registration: CustomPropertyRegistration,
  cascaded: CascadedProperty,
  engine: CascadeEngine,
) {
  if (!cascaded.declaration.custom) return null;

  const { parse: parseValue } = registration;
  const declaration = cascaded.declaration.value.inner;
  if (!(declaration instanceof RawWholeValue)) return null;
  const raw = parseValue(declaration.repr.repr, {});
  return raw === null ? null : raw.resolve(ValueStage.Computed, engine.getPropertyContext(cascaded));
}

function resolveCustomProperty(
  engine: CascadeEngine,
  scope: TreeScope,
  name: CustomPropertyName,
  inherited: string,
  stage: ValueStage,
): string | null {
  const registration = engine.collectCustomPropertyRegistry(scope).get(name);
  const cascaded = engine.getCascadedProperty(name, scope);

  if (
    registration === undefined ||
    cascaded === null ||
    !cascaded.declaration.custom
  ) {
    return null;
  }

  const declaration = cascaded.declaration;
  const { parse: parseValue } = registration;
  const inheritedRaw = parseValue(inherited, {});
  const inheritedValue = inheritedRaw === null ? null : inheritedRaw.resolve(ValueStage.Computed, { URL: engine.context.env.userAgent.URL });
  const context: PropertyContext & {
    customProperty: {
      engine: CascadeEngine;
      registration: CustomPropertyRegistration;
      inheritedValue: typeof inheritedValue;
    };
  } = {
    ...engine.getPropertyContext(cascaded),
    customProperty: { engine, registration, inheritedValue },
  };

  const declarationValue = declaration.value.inner;
  if (!(declarationValue instanceof RawWholeValue)) return null;
  const raw = parseValue(declarationValue.repr.repr, {});
  const value = raw === null ? null : raw.resolve(stage, context);
  return value === null ? null : value.serialize();
}

function propertyRules(
  scope: TreeScope,
  ...registrations: CustomPropertyRegistration[]
): CSSPropertyRuleImpl[] {
  return registrations.map((registration) =>
    new CSSPropertyRuleImpl(registration, scope.cascade.context.env)
  );
}

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
  source: string | CSSRuleImpl[],
  location?: StyleletURL,
): CSSStyleSheetImpl {
  const styleSheet = CSSStyleSheetImpl.create(
    scope.cascade.context,
    {
      location: location ?? null,
      parentStyleSheet: null,
      ownerNode: null,
      ownerRule: null,
      media: '',
      title: '',
      alternate: false,
      originClean: true,
    },
  );
  const context = new RuleListContext(styleSheet.ruleList, null, false, scope.cascade.context.env);
  styleSheet.replaceRules(typeof source === 'string' ? parseStylesheetContents(source, context) : source);

  scope.addTreeStyleSheet(styleSheet);
  return styleSheet;
}
