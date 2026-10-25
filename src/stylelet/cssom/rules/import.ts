import { asciiLower } from '../../../infra/ascii';
import { InternalError } from '../../../infra/internal-error';
import { defineInterface, idlType, impl, nullable, reference, roAttr, xattr } from '../../../web-idl/core/index';

import type { StyleletEnvironment } from '../../environment';
import {
  consumeStringToken, isFunctionBlock, isWhitespaceToken, TokenCursor, TokenKind,
  type BlockContents, type ComponentValue, type TokenList,
} from '../../syntax/index';
import { UrlValue } from '../../values/index';
import { MediaListImpl } from '../media/index';
import type { RuleListContext } from './context';
import type { CSSStyleSheetImpl } from '../css-stylesheet';

import { CSSRuleImpl } from './rule';

/** An import's authored URL and conditions; fetching requires its containing sheet. */
// https://drafts.csswg.org/cssom/#the-cssimportrule-interface
export class CSSImportRuleImpl extends CSSRuleImpl {
  /** Authored URL and request modifiers, independent of the imported sheet's resolved location. */
  url: UrlValue;
  /** Conditions shared with the associated sheet. */
  media: MediaListImpl;
  /** Imported sheet, or null before association or when a supports condition is false. */
  styleSheet: CSSStyleSheetImpl | null = null;
  /** Layer name, empty for an anonymous layer, or null without a layer clause. */
  layerName: string | null = null;
  /** Supports condition, or null without a supports clause. */
  supportsText: string | null = null;

  /** Retain the validated import prelude without starting a fetch during parsing. */
  constructor(url: UrlValue, media: MediaListImpl, env: StyleletEnvironment) {
    super(env);
    this.url = url;
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
    const string = consumeStringToken(c);
    const url = string === null ? UrlValue.consume(c) : UrlValue.fromString('url', string.value, {});
    if (url === null) return null;
    c.consumeWhile(isWhitespaceToken);
    const next = c.peek();
    if ((next.type === TokenKind.Ident && asciiLower(next.value) === 'layer') ||
      (isFunctionBlock(next) && ['layer', 'supports'].includes(asciiLower(next.name)))) {
      throw new InternalError('Import layer/supports grammar and applicability are not implemented');
    }
    const media = new MediaListImpl(prelude.sourceText(c.pos(), prelude.tokens.length), context.env);
    return new CSSImportRuleImpl(url, media, context.env);
  }

  /** Decoded URL spelling, without request modifiers or base-URL resolution. */
  get href(): string { return this.url.repr.href; }

  /** Canonical import text; assignment has no effect. */
  // https://drafts.csswg.org/cssom/#serialize-a-css-rule
  get cssText(): string {
    // TODO: CSS Cascade's layer/supports clauses need their own parsed representation and serializer.
    if (this.layerName !== null || this.supportsText !== null) {
      throw new InternalError('Import layer/supports serialization is not implemented');
    }
    const media = this.media.mediaText;
    return `@import ${this.url.serialize()}${media === '' ? '' : ` ${media}`};`;
  }

  set cssText(_value: string) {}

  /** Historical IMPORT_RULE code. */
  get type(): number { return 3; }
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

