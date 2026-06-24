import { requireDefined } from '../../utils/util';
import { BlockKind, type ComponentValue } from '../parser/syntax';
import { TokenKind } from '../parser/tokens';
import type { DeclarationAst } from '../parser/types';
import { PropertyId, getPropertyName } from '../parser/types';
import { isCssWideValue, serializeCssWideValue, type CssWideValue } from '../values/css-wide';
import { serializeLengthPercentageAuto } from '../values/length-percentage';

export type SerializedDeclaration = {
  name: string;
  value: string;
  important: boolean;
};

export function serializeAstDeclaration(declaration: DeclarationAst): SerializedDeclaration | null {
  switch (declaration.prop) {
    case PropertyId.MarginLeft:
    case PropertyId.MarginRight:
    case PropertyId.MarginTop:
    case PropertyId.MarginBottom:
      return {
        name: getName(declaration.prop),
        value: serialize(declaration.value, serializeLengthPercentageAuto),
        important: declaration.important,
      };

    case PropertyId.Custom:
      return {
        name: declaration.name,
        value: serializeComponentValues(declaration.value),
        important: declaration.important,
      };

    default:
      return null;
  }
}

function serialize<T>(value: T | CssWideValue, serialize: (value: T) => string): string {
  return isCssWideValue(value)
    ? serializeCssWideValue(value)
    : serialize(value);
}

function getName(prop: PropertyId): string {
  return requireDefined(
    getPropertyName(prop),
    () => `No serialized property name for PropertyId ${prop}`,
  );
}

export function serializeComponentValues(values: readonly ComponentValue[]): string {
  return values.map(serializeComponentValue).join('').trim();
}

export function serializeComponentValue(value: ComponentValue): string {
  if (!('kind' in value)) {
    switch (value.block) {
      case BlockKind.Brace:
        return `{${serializeComponentValues(value.value)}}`;

      case BlockKind.Bracket:
        return `[${serializeComponentValues(value.value)}]`;

      case BlockKind.Parens:
        return `(${serializeComponentValues(value.value)})`;

      case BlockKind.Function:
        return `${value.name}(${serializeComponentValues(value.value)})`;
    }
  }

  switch (value.kind) {
    case TokenKind.Ident:
      return value.value;

    case TokenKind.AtKeyword:
      return `@${value.value}`;

    case TokenKind.Hash:
      return `#${value.value}`;

    case TokenKind.String:
      return serializeCssString(value.value);

    case TokenKind.BadString:
      return '';

    case TokenKind.Url:
      return `url(${serializeCssString(value.value)})`;

    case TokenKind.BadUrl:
      return '';

    case TokenKind.Delim:
      return value.value;

    case TokenKind.Number:
      return value.repr;

    case TokenKind.Percentage:
      return `${value.repr}%`;

    case TokenKind.Dimension:
      return `${value.repr}${value.unit}`;

    case TokenKind.Whitespace:
      return ' ';

    case TokenKind.CDO:
      return '<!--';

    case TokenKind.CDC:
      return '-->';

    case TokenKind.Colon:
      return ':';

    case TokenKind.Semicolon:
      return ';';

    case TokenKind.Comma:
      return ',';

    case TokenKind.RightBracket:
      return ']';

    case TokenKind.RightParen:
      return ')';

    case TokenKind.RightBrace:
      return '}';
  }
}

function serializeCssString(value: string): string {
  return JSON.stringify(value);
}
