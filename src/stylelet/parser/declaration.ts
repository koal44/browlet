import { consumeIdent, consumeTrivia, type Cursor } from '../parser/lex';
import {
  BlockItemKind, PropertyId, propertyIdFor,
  type DeclarationAst, type InvalidBlockItemAst,
} from './types';
import { parseLengthPercentageAuto } from '../values/length-percentage';
import { parseColorValue } from '../values/color';
import { tryParseCssWideValue } from '../values/css-wide';
import { consumeComponentValue } from './component';

export function parseDeclarationOrInvalid(c: Cursor): DeclarationAst | InvalidBlockItemAst {
  const start = c.pos();

  try {
    return parseDeclaration(c);
  } catch (err) {
    c.restore(start);

    return {
      kind: BlockItemKind.Invalid,
      source: consumeInvalidDeclaration(c),
      reason: err instanceof Error ? err.message : undefined,
    };
  }
}

function parseDeclaration(c: Cursor): DeclarationAst {
  consumeTrivia(c);

  const name = consumeIdent(c);
  const prop = propertyIdFor(name);

  consumeTrivia(c);

  if (c.peek() !== ':') {
    c.error(`Expected : after declaration name, got ${c.peek() || '<eof>'}`);
  }

  c.advance();
  consumeTrivia(c);

  const payload = parseDeclarationValue(c, prop, name);
  const important = finishDeclaration(c);

  return {
    kind: BlockItemKind.Declaration,
    ...payload,
    important,
  };
}

function parseDeclarationValue(c: Cursor, prop: PropertyId, name: string) {
  switch (prop) {
    case PropertyId.Color:
    case PropertyId.BackgroundColor:
      return {
        prop, value: tryParseCssWideValue(c) ?? parseColorValue(c),
      };

    case PropertyId.MarginTop:
    case PropertyId.MarginRight:
    case PropertyId.MarginBottom:
    case PropertyId.MarginLeft:
      return {
        prop, value: tryParseCssWideValue(c) ?? parseLengthPercentageAuto(c),
      };

    case PropertyId.Custom:
      return {
        prop, name, value: consumeRawDeclarationValue(c),
      };

    case PropertyId.Unknown:
      return c.error(`Unknown CSS property ${name}`);

    default:
      return c.error(`Unsupported CSS property ${name}`);
  }
}

function finishDeclaration(c: Cursor): boolean {
  const important = consumeImportant(c);

  consumeTrivia(c);

  const ch = c.peek();

  if (ch === ';') {
    c.advance();
    return important;
  }

  if (!ch || ch === '}') {
    return important;
  }

  c.error(`Expected declaration end, got ${ch}`);
}

export function consumeInvalidDeclaration(c: Cursor): string {
  const start = c.pos();

  while (true) {
    const ch = c.peek();

    if (!ch || ch === '}') {
      return c.slice(start);
    }

    if (ch === ';') {
      c.advance();
      return c.slice(start);
    }

    consumeComponentValue(c);
  }
}

function consumeRawDeclarationValue(c: Cursor): string {
  const start = c.pos();

  while (true) {
    const ch = c.peek();

    if (!ch || ch === ';' || ch === '}') {
      break;
    }

    if (isFinalImportant(c)) {
      break;
    }

    consumeComponentValue(c);
  }

  return c.slice(start, c.pos()).trim();
}

function isFinalImportant(c: Cursor): boolean {
  const start = c.pos();

  if (!consumeImportant(c)) {
    c.restore(start);
    return false;
  }

  consumeTrivia(c);

  const ch = c.peek();
  const final = !ch || ch === ';' || ch === '}';

  c.restore(start);
  return final;
}

function consumeImportant(c: Cursor): boolean {
  const start = c.pos();

  consumeTrivia(c);

  if (c.peek() !== '!') {
    c.restore(start);
    return false;
  }

  c.advance();
  consumeTrivia(c);

  let ident = '';

  try {
    ident = consumeIdent(c);
  } catch {
    c.restore(start);
    return false;
  }

  if (ident.toLowerCase() !== 'important') {
    c.restore(start);
    return false;
  }

  return true;
}
