import { Browlet } from '../../../../src/browlet/browlet';
import { browletDefinitions, createBrowletEnvironmentInit } from '../../../../src/browlet/bindings';
import { SandboxEnvironment, type BrowletEnvironment } from '../../../../src/browlet/environment';
import { ElementImpl } from '../../../../src/browlet/dom/nodes/index';
import { HTMLElementImpl } from '../../../../src/browlet/dom/nodes/html/html-element';
import { htmlQuoteElementImplementations } from '../../../../src/browlet/dom/nodes/html/grouping/quote';
import type { TokenListAttribute } from '../../../../src/browlet/dom/token-list';
import type { Element } from '../../../../src/browlet/platform';
import { EnumeratedAttribute } from '../../../../src/browlet/html/microsyntaxes/index';
import { htmlExtendedAttributeHooks } from '../../../../src/browlet/integration/web-idl/index';
import { HTML_NAMESPACE } from '../../../../src/infra/index';
import {
  BindingWorld, attr, roAttr, defineInterface, defineTypedef, type Definition, frozenArray, idlType, impl,
  nullable, reference, reflect, reflectSetter, reflectURL, reflectNonNegative,
  reflectPositive, reflectPositiveWithFallback, reflectEnumerated, reflectTokens, xattr,
} from '../../../../src/web-idl/index';
import { getRelevantRealm } from '../../../support/browlet-binding';
import { validateReflectedAttribute } from '../../../support/html-reflection';

// Test-only reflected members exercise the real Binding and DOM layers without introducing
// unfinished HTML element APIs just to obtain a numeric or element-valued reflection consumer.
class ReflectionElementImpl extends ElementImpl {
  get custom(): string { return `custom:${this.getAttributeNS(null, 'custom') ?? ''}`; }
}

const enumeration = new EnumeratedAttribute([
  { state: 1, keywords: ['enabled'], nonConformingKeywords: ['yes'] },
  { state: 2, keywords: [] },
], { missingValueDefault: 2 });

export const tokensAttribute: TokenListAttribute = { name: 'tokens', supportedTokens: new Set(['render']) };
const plainTokensAttribute: TokenListAttribute = { name: 'plaintokens', supportedTokens: null };
const emptyTokensAttribute: TokenListAttribute = { name: 'emptytokens', supportedTokens: new Set() };

const definition = defineInterface({
  name: 'ReflectionElement', inherits: 'Element', exposed: 'Window',
  implementation: impl(ReflectionElementImpl),
  members: [
    attr('camelCase', idlType.DOMString, xattr(reflect())),
    attr('renamed', idlType.DOMString, xattr(reflect({ name: 'data-name' }))),
    attr('keyword', idlType.DOMString, xattr(reflectEnumerated(enumeration))),
    attr('optionalKeyword', nullable(idlType.DOMString), xattr(reflectEnumerated(enumeration))),
    attr('scalar', idlType.USVString, xattr(reflect())),
    attr('url', idlType.USVString, xattr(reflectURL())),
    attr('present', idlType.boolean, xattr(reflect())),
    attr('signed', idlType.long, xattr(reflect())),
    attr('nonnegative', idlType.long, xattr(reflectNonNegative())),
    attr('unsigned', idlType.unsignedLong, xattr(reflect())),
    attr('positive', idlType.unsignedLong, xattr(reflectPositive())),
    attr('fallback', idlType.unsignedLong, xattr(reflectPositiveWithFallback({ default: 20 }))),
    attr('ranged', idlType.unsignedLong, xattr(reflect({ default: 4, range: [2, 10] }))),
    attr('floating', idlType.double, xattr(reflect())),
    attr('positiveFloat', idlType.double, xattr(reflectPositive({ default: 1.5 }))),
    attr('custom', idlType.USVString, xattr(reflectSetter())),
    roAttr('tokens', reference('DOMTokenList'),
      xattr('SameObject', ['PutForwards', 'value'], reflectTokens(tokensAttribute)),
    ),
    roAttr('plainTokens', reference('DOMTokenList'),
      xattr('SameObject', ['PutForwards', 'value'], reflectTokens(plainTokensAttribute)),
    ),
    roAttr('emptyTokens', reference('DOMTokenList'),
      xattr('SameObject', ['PutForwards', 'value'], reflectTokens(emptyTokensAttribute)),
    ),
    attr('target', nullable(reference('Element')), xattr(reflect())),
    attr('targets', nullable(frozenArray(reference('Element'))), xattr(reflect())),
    attr('typedTarget', nullable(reference('ReflectionElement')), xattr(reflect())),
    attr('typedTargets', nullable(frozenArray(reference('ReflectionElementAlias'))), xattr(reflect())),
    attr('aliasTarget', nullable(reference('ReflectionElementAlias')), xattr(reflect())),
    attr('htmlTarget', nullable(reference(HTMLElementImpl)), xattr(reflect())),
    attr('htmlTargets', nullable(frozenArray(reference(HTMLElementImpl))), xattr(reflect())),
    attr('quoteTarget', nullable(reference(htmlQuoteElementImplementations)), xattr(reflect())),
    attr('quoteTargets', nullable(frozenArray(reference(htmlQuoteElementImplementations))), xattr(reflect())),
  ],
});

type ReflectionElement = Element & {
  camelCase: string; renamed: string; keyword: string; optionalKeyword: string | null;
  scalar: string; url: string; present: boolean; signed: number; nonnegative: number;
  unsigned: number; positive: number; fallback: number; ranged: number;
  floating: number; positiveFloat: number; custom: string; tokens: DOMTokenList;
  plainTokens: DOMTokenList; emptyTokens: DOMTokenList;
  target: Element | null; targets: readonly Element[] | null; typedTarget: ReflectionElement | null;
  typedTargets: readonly ReflectionElement[] | null; aliasTarget: ReflectionElement | null;
  htmlTarget: Element | null; htmlTargets: readonly Element[] | null;
  quoteTarget: Element | null; quoteTargets: readonly Element[] | null;
};

/** Isolate test-only declarations in one world, retaining real Browlet realms and environments. */
export function createReflectionWorld(additionalDefinitions: Definition[] = []) {
  const world = new BindingWorld<BrowletEnvironment>([
    ...browletDefinitions, definition,
    defineTypedef({ name: 'ReflectionElementAlias', type: reference(ReflectionElementImpl) }),
    ...additionalDefinitions,
  ], {
    extendedAttributes: {
      ...htmlExtendedAttributeHooks,
      prepareReflectedAttribute(member, owners) {
        validateReflectedAttribute(member, owners);
        return htmlExtendedAttributeHooks.prepareReflectedAttribute!(member, owners);
      },
    },
  });
  return () => {
    const browser = new Browlet({ route: () => '' });
    const realm = getRelevantRealm(browser.window);
    // The private world owns allocations; the real Window realm supplies DOM notification state.
    const context = world.register(realm, (binding) =>
      new SandboxEnvironment(realm, createBrowletEnvironmentInit(binding), realm.env.userAgent),
    );
    const env = context.getEnvironment();
    const document = env.createDocument();
    const element = context.construct(ReflectionElementImpl, [{ document, localName: 'div', namespaceURI: HTML_NAMESPACE }, env]);
    const platform = context.project(ReflectionElementImpl, element) as unknown as ReflectionElement;
    function child(reflected = false) {
      const constructor = reflected ? ReflectionElementImpl : ElementImpl;
      const element = context.construct(constructor, [{ document, localName: 'span', namespaceURI: HTML_NAMESPACE }, env]);
      const platform = context.project(constructor, element) as unknown as Element;
      return { element, platform };
    }
    return { browser, realm, env, context, document, element, platform, child };
  };
}

export const createReflectionFixture = () => createReflectionWorld()();
