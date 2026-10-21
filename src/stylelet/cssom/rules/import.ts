import { asciiLower } from '../../../infra/ascii';
import { InternalError } from '../../../infra/internal-error';
import { defineInterface, idlType, impl, nullable, reference, roAttr, xattr } from '../../../web-idl/core/index';

import type { StyleletEnvironment } from '../../environment';
import {
  consumeStringToken, consumeUrlToken, isFunctionBlock, isWhitespaceToken,
  parseAsComponentGrammar, serializeCssString, TokenCursor, TokenKind, type BlockContents, type ComponentValue, type TokenList,
} from '../../syntax/index';
import { MediaListImpl } from '../media/index';
import type { RuleListContext } from './context';
import type { CSSStyleSheetImpl } from '../css-stylesheet';

import { CSSRuleImpl } from './rule';

/** An import's authored URL and conditions; fetching requires its containing sheet. */
// https://drafts.csswg.org/cssom/#the-cssimportrule-interface
export class CSSImportRuleImpl extends CSSRuleImpl {
  /** Decoded URL spelling, independent of the imported sheet's resolved location. */
  href: string;
  /** Conditions shared with the associated sheet when import loading is connected. */
  media: MediaListImpl;
  /** Imported sheet, or null before association or when a supports condition is false. */
  styleSheet: CSSStyleSheetImpl | null = null;
  /** Layer name, empty for an anonymous layer, or null without a layer clause. */
  layerName: string | null = null;
  /** Supports condition, or null without a supports clause. */
  supportsText: string | null = null;

  /** Retain the validated import prelude without starting a fetch during parsing. */
  constructor(href: string, media: MediaListImpl, env: StyleletEnvironment) {
    super(env);
    this.href = href;
    this.media = media;
  }

  /** Interpret the URL/media grammar and placement; modern conditions remain an explicit dependency. */
  // https://drafts.csswg.org/css-cascade-5/#at-import
  static interpret(
    prelude: TokenList<ComponentValue>,
    preceding: BlockContents | null,
    context: RuleListContext,
  ): CSSImportRuleImpl | null {
    // https://drafts.csswg.org/cssom/#dom-cssstylesheet-insertrule
    // Replacement excludes imports too; one rejected rule fails insertion.
    if (context.isConstructed) return null;
    if (preceding !== null && (context.parentSelectors !== null || preceding.some((item) =>
      !(item instanceof CSSImportRuleImpl)
    ))) return null;

    const c = new TokenCursor(prelude, context);
    c.consumeWhile(isWhitespaceToken);
    let href = (consumeStringToken(c) ?? consumeUrlToken(c))?.value;
    if (href === undefined) {
      const component = c.peek();
      if (!isFunctionBlock(component) || asciiLower(component.name) !== 'url') return null;
      c.next();
      const token = parseAsComponentGrammar(component.value, (inner) => {
        inner.consumeWhile(isWhitespaceToken);
        return consumeStringToken(inner);
      }, context);
      if (token === null) return null;
      href = token.value;
    }
    c.consumeWhile(isWhitespaceToken);
    const next = c.peek();
    if ((next.type === TokenKind.Ident && asciiLower(next.value) === 'layer') ||
      (isFunctionBlock(next) && ['layer', 'supports'].includes(asciiLower(next.name)))) {
      throw new InternalError('Import layer/supports grammar and applicability are not implemented');
    }
    const media = new MediaListImpl(c.sourceText(c.pos(), prelude.tokens.length));
    return new CSSImportRuleImpl(href, media, context.env);
  }

  /** Canonical import text; assignment has no effect. */
  // https://drafts.csswg.org/cssom/#serialize-a-css-rule
  get cssText(): string {
    // TODO: CSS Cascade's layer/supports clauses need their own parsed representation and serializer.
    if (this.layerName !== null || this.supportsText !== null) {
      throw new InternalError('Import layer/supports serialization is not implemented');
    }
    const media = this.media.mediaText;
    return `@import url(${serializeCssString(this.href)})${media === '' ? '' : ` ${media}`};`;
  }

  set cssText(_value: string) {}

  /** Historical IMPORT_RULE code. */
  get type(): number { return 3; }

  /** Associate an import with its sheet only when the resource lifecycle can be started. */
  override setParentStyleSheet(sheet: CSSStyleSheetImpl | null): void {
    if (sheet !== null) this.#loadStyleSheet(sheet);
    super.setParentStyleSheet(sheet);
  }

  /** Resolve against the containing sheet and load with its fetch/encoding/policy provenance. */
  // https://drafts.csswg.org/cssom/#fetch-a-css-style-sheet
  // https://drafts.csswg.org/css-cascade-5/#at-import
  #loadStyleSheet(_parent: CSSStyleSheetImpl): never {
    // TODO: Supply the resource owner, fetch, supports matching, recursive completion,
    // cancellation, and shared media/ownerRule association. The environment currently
    // has no import-loader contract; do not accept an import as a silently inert rule.
    throw new InternalError('Imported stylesheet loading and completion are not implemented');
  }
}

/*
 * [Exposed=Window]
 * interface CSSImportRule : CSSRule {
 *   readonly attribute USVString href;
 *   [SameObject, PutForwards=mediaText] readonly attribute MediaList media;
 *   [SameObject] readonly attribute CSSStyleSheet? styleSheet;
 *   readonly attribute CSSOMString? layerName;
 *   readonly attribute CSSOMString? supportsText;
 * };
 */
export const cssImportRuleIDL = defineInterface({
  name: 'CSSImportRule', inherits: 'CSSRule', exposed: 'Window',
  implementation: impl(CSSImportRuleImpl),
  members: [
    roAttr('href', idlType.USVString),
    roAttr('media', reference(MediaListImpl), xattr('SameObject', ['PutForwards', 'mediaText'])),
    roAttr('styleSheet', nullable(reference('CSSStyleSheet')), xattr('SameObject')),
    roAttr('layerName', nullable(reference('CSSOMString'))),
    roAttr('supportsText', nullable(reference('CSSOMString'))),
  ],
});

