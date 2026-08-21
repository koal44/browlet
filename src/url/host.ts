import { getDomain, getPublicSuffix } from 'tldts';
import { toASCII, toUnicode } from 'tr46';

import { CodePointCursor, isURLCodePoint } from './cp-cursor';
import { percentDecodeString, utf8PercentEncode } from './percent-encoding';
import type { URLValidationError } from './validation-error';

export type Host = Domain | IPv4Address | IPv6Address | OpaqueHost | EmptyHost;

export type Domain = {
  kind: 'domain';
  value: string;
};

type IPv4Address = {
  kind: 'ipv4';
  value: number;
};

type IPv6Address = {
  kind: 'ipv6';
  pieces: IPv6Pieces;
};

type IPv6Pieces = [
  number, number, number, number, number, number, number, number,
];

type OpaqueHost = {
  kind: 'opaque';
  value: string;
};

type EmptyHost = {
  kind: 'empty';
};

type HostParseResult = {
  host: Host | null;
  validationErrors: URLValidationError[];
};

export function parseDomain(
  domain: string,
  beStrict: boolean,
  validationErrors: URLValidationError[] = [],
): Domain | null {
  const strictResult = domainParserToASCII(domain, true);

  if (strictResult === null) validationErrors.push('domain-to-ASCII');
  if (beStrict) {
    return strictResult === null ? null : { kind: 'domain', value: strictResult };
  }

  const result = isASCII(domain)
    ? domain.toLowerCase()
    : domainParserToASCII(domain, false);

  if (
    result === null ||
    result === '' ||
    Array.from(result).some(isForbiddenDomainCodePoint)
  ) {
    return null;
  }

  return { kind: 'domain', value: result };
}

export function domainToUnicode(domain: Domain): string {
  const result = toUnicode(domain.value, {
    checkHyphens: false,
    checkBidi: true,
    checkJoiners: true,
    useSTD3ASCIIRules: false,
    transitionalProcessing: false,
    ignoreInvalidPunycode: false,
  });

  return result.error ? domain.value : result.domain;
}

export function parseHost(input: string, isOpaque = false): HostParseResult {
  const validationErrors: URLValidationError[] = [];
  let host: Host | null;

  if (input.startsWith('[')) {
    if (!input.endsWith(']')) {
      validationErrors.push('IPv6-unclosed');
      host = null;
    } else {
      host = parseIPv6(input.slice(1, -1), validationErrors);
    }
  } else if (isOpaque) {
    host = parseOpaqueHost(input, validationErrors);
  } else {
    if (/%[\dA-Fa-f]{2}/u.test(input)) {
      validationErrors.push('domain-percent-encoded');
    }

    const domain = textDecoder.decode(Uint8Array.from(percentDecodeString(input)));
    const asciiDomain = parseDomain(domain, false, validationErrors);

    if (asciiDomain === null) {
      host = null;
    } else if (endsInNumber(asciiDomain.value)) {
      if (!isASCII(domain)) validationErrors.push('IPv4-non-ASCII-input');
      host = parseIPv4(asciiDomain.value, validationErrors);
    } else {
      host = asciiDomain;
    }
  }

  return { host, validationErrors };
}

export function isValidDomain(input: string): boolean {
  const domain = parseDomain(input, true);
  return domain !== null && !endsInNumber(domain.value);
}

export function obtainPublicSuffix(host: Host): Domain | null {
  if (host.kind !== 'domain') return null;

  const domain = stripTrailingDot(host.value);
  const value = preserveTrailingDot(
    host.value,
    getPublicSuffix(domain, publicSuffixOptions),
  );

  return value === null ? null : { kind: 'domain', value };
}

export function obtainRegistrableDomain(host: Host): Domain | null {
  if (host.kind !== 'domain') return null;

  const publicSuffix = obtainPublicSuffix(host);
  if (publicSuffix === null || publicSuffix.value === host.value) return null;

  const domain = stripTrailingDot(host.value);
  const value = preserveTrailingDot(
    host.value,
    getDomain(domain, publicSuffixOptions),
  );

  return value === null ? null : { kind: 'domain', value };
}

export function serializeHost(host: Host): string {
  switch (host.kind) {
    case 'ipv4':
      return serializeIPv4(host);
    case 'ipv6':
      return `[${serializeIPv6(host)}]`;
    case 'empty':
      return '';
    default:
      return host.value;
  }
}

export function hostsEqual(a: Host, b: Host): boolean {
  switch (a.kind) {
    case 'domain':
    case 'opaque':
    case 'ipv4':
      return b.kind === a.kind && a.value === b.value;
    case 'ipv6':
      return b.kind === 'ipv6' &&
        a.pieces.every((piece, index) => piece === b.pieces[index]);
    case 'empty':
      return b.kind === 'empty';
  }
}

function isForbiddenHostCodePoint(codePoint: string): boolean {
  return forbiddenHostCodePoints.has(codePoint);
}

function endsInNumber(input: string): boolean {
  const parts = input.split('.');
  if (parts.at(-1) === '') parts.pop();

  const last = parts.at(-1) ?? '';
  return /^\d+$/u.test(last) || parseIPv4Number(last) !== null;
}

function parseIPv4Number(
  input: string,
): [number: number, validationError: boolean] | null {
  if (input === '') return null;

  let validationError = false;
  let radix = 10;

  if (/^0[xX]/u.test(input)) {
    validationError = true;
    input = input.slice(2);
    radix = 16;
  } else if (input.length >= 2 && input.startsWith('0')) {
    validationError = true;
    input = input.slice(1);
    radix = 8;
  }

  if (input === '') return [0, true];
  if (!radixDigits[radix]!.test(input)) return null;

  return [Number.parseInt(input, radix), validationError];
}

function parseIPv4(
  input: string,
  validationErrors: URLValidationError[] = [],
): IPv4Address | null {
  const parts = input.split('.');

  if (parts.at(-1) === '') {
    validationErrors.push('IPv4-empty-part');
    if (parts.length > 1) parts.pop();
  }

  if (parts.length < 4) validationErrors.push('IPv4-too-few-parts');
  if (parts.length > 4) {
    validationErrors.push('IPv4-too-many-parts');
    return null;
  }

  const numbers: number[] = [];
  for (const part of parts) {
    const result = parseIPv4Number(part);
    if (result === null) {
      validationErrors.push('IPv4-non-numeric-part');
      return null;
    }
    if (result[1]) validationErrors.push('IPv4-non-decimal-part');
    numbers.push(result[0]);
  }

  if (numbers.some((number) => number > 255)) {
    validationErrors.push('IPv4-out-of-range-part');
  }
  if (numbers.slice(0, -1).some((number) => number > 255)) return null;

  const last = numbers.at(-1)!;
  if (last >= 256 ** (5 - numbers.length)) return null;

  let ipv4 = last;
  numbers.pop();
  for (const [counter, number] of numbers.entries()) {
    ipv4 += number * 256 ** (3 - counter);
  }

  return { kind: 'ipv4', value: ipv4 };
}

function parseIPv6(
  input: string,
  validationErrors: URLValidationError[] = [],
): IPv6Address | null {
  const address: IPv6Pieces = [0, 0, 0, 0, 0, 0, 0, 0];
  let pieceIndex = 0;
  let compress: number | null = null;
  const cursor = new CodePointCursor(input);

  if (cursor.peek() === ':') {
    if (cursor.peek(1) !== ':') {
      validationErrors.push('IPv6-invalid-compression');
      return null;
    }
    cursor.consume();
    cursor.consume();
    pieceIndex++;
    compress = pieceIndex;
  }

  while (!cursor.eof()) {
    if (pieceIndex === 8) {
      validationErrors.push('IPv6-too-many-pieces');
      return null;
    }

    if (cursor.peek() === ':') {
      if (compress !== null) {
        validationErrors.push('IPv6-multiple-compression');
        return null;
      }
      cursor.consume();
      pieceIndex++;
      compress = pieceIndex;
      continue;
    }

    let value = 0;
    let length = 0;
    while (length < 4 && isASCIIHexDigit(cursor.peek())) {
      value = value * 0x10 + Number.parseInt(cursor.consume(), 16);
      length++;
    }

    if (cursor.peek() === '.') {
      if (length === 0) {
        validationErrors.push('IPv4-in-IPv6-invalid-code-point');
        return null;
      }
      cursor.restore(cursor.pos() - length);
      if (pieceIndex > 6) {
        validationErrors.push('IPv4-in-IPv6-too-many-pieces');
        return null;
      }

      let numbersSeen = 0;
      while (!cursor.eof()) {
        let ipv4Piece: number | null = null;

        if (numbersSeen > 0) {
          if (cursor.peek() === '.' && numbersSeen < 4) {
            cursor.consume();
          } else {
            validationErrors.push('IPv4-in-IPv6-invalid-code-point');
            return null;
          }
        }

        if (!isASCIIDigit(cursor.peek())) {
          validationErrors.push('IPv4-in-IPv6-invalid-code-point');
          return null;
        }

        while (isASCIIDigit(cursor.peek())) {
          const number = Number(cursor.peek());
          if (ipv4Piece === null) {
            ipv4Piece = number;
          } else if (ipv4Piece === 0) {
            validationErrors.push('IPv4-in-IPv6-invalid-code-point');
            return null;
          } else {
            ipv4Piece = ipv4Piece * 10 + number;
          }

          if (ipv4Piece > 255) {
            validationErrors.push('IPv4-in-IPv6-out-of-range-part');
            return null;
          }
          cursor.consume();
        }

        address[pieceIndex] = address[pieceIndex]! * 0x100 + ipv4Piece!;
        numbersSeen++;
        if (numbersSeen === 2 || numbersSeen === 4) pieceIndex++;
      }

      if (numbersSeen !== 4) {
        validationErrors.push('IPv4-in-IPv6-too-few-parts');
        return null;
      }
      break;
    }

    if (cursor.peek() === ':') {
      cursor.consume();
      if (cursor.eof()) {
        validationErrors.push('IPv6-invalid-code-point');
        return null;
      }
    } else if (!cursor.eof()) {
      validationErrors.push('IPv6-invalid-code-point');
      return null;
    }

    if (length > 1 && value < 0x10 ** (length - 1)) {
      validationErrors.push('IPv6-piece-leading-zero');
    }
    address[pieceIndex] = value;
    pieceIndex++;
  }

  if (compress !== null) {
    let swaps = pieceIndex - compress;
    pieceIndex = 7;
    while (pieceIndex !== 0 && swaps > 0) {
      const swapIndex = compress + swaps - 1;
      [address[pieceIndex], address[swapIndex]] = [
        address[swapIndex]!, address[pieceIndex]!,
      ];
      pieceIndex--;
      swaps--;
    }
  } else if (pieceIndex !== 8) {
    validationErrors.push('IPv6-too-few-pieces');
    return null;
  }

  return { kind: 'ipv6', pieces: address };
}

function parseOpaqueHost(
  input: string,
  validationErrors: URLValidationError[] = [],
): OpaqueHost | EmptyHost | null {
  if (Array.from(input).some(isForbiddenHostCodePoint)) {
    validationErrors.push('host-invalid-code-point');
    return null;
  }

  const codePoints = Array.from(input);
  for (const [index, codePoint] of codePoints.entries()) {
    if (!isURLCodePoint(codePoint) && codePoint !== '%') {
      recordOnce(validationErrors, 'invalid-URL-unit');
    }
    if (codePoint === '%' && !(
      isASCIIHexDigit(codePoints[index + 1] ?? '') &&
      isASCIIHexDigit(codePoints[index + 2] ?? '')
    )) {
      recordOnce(validationErrors, 'invalid-URL-unit');
    }
  }

  const value = utf8PercentEncode(input, 'c0_control');
  return value === '' ? { kind: 'empty' } : { kind: 'opaque', value };
}

const textDecoder = new TextDecoder('utf-8');

const publicSuffixOptions = {
  allowPrivateDomains: true,
  detectIp: false,
  extractHostname: false,
  mixedInputs: false,
  validateHostname: false,
};

const forbiddenHostCodePoints = new Set([
  '\0', '\t', '\n', '\r', ' ', '#', '/', ':', '<', '>', '?', '@', '[', '\\',
  ']', '^', '|',
]);

const radixDigits: Record<number, RegExp> = {
  8: /^[0-7]+$/u,
  10: /^\d+$/u,
  16: /^[\dA-Fa-f]+$/u,
};

function isASCII(input: string): boolean {
  return Array.from(input).every((codePoint) => codePoint.codePointAt(0)! <= 0x7f);
}

function isASCIIDigit(codePoint: string): boolean {
  return /^\d$/u.test(codePoint);
}

function isASCIIHexDigit(codePoint: string): boolean {
  return /^[\dA-Fa-f]$/u.test(codePoint);
}

function recordOnce(
  validationErrors: URLValidationError[],
  error: URLValidationError,
): void {
  if (!validationErrors.includes(error)) validationErrors.push(error);
}

function serializeIPv4(address: IPv4Address): string {
  let output = '';
  let n = address.value;

  for (let i = 1; i <= 4; i++) {
    output = `${n % 256}${output}`;
    if (i !== 4) output = `.${output}`;
    n = Math.floor(n / 256);
  }

  return output;
}

function serializeIPv6(address: IPv6Address): string {
  let output = '';
  const compress = findIPv6CompressedPieceIndex(address);
  let ignore0 = false;

  for (let pieceIndex = 0; pieceIndex < address.pieces.length; pieceIndex++) {
    const piece = address.pieces[pieceIndex]!;

    if (ignore0 && piece === 0) continue;
    if (ignore0) ignore0 = false;

    if (compress === pieceIndex) {
      output += pieceIndex === 0 ? '::' : ':';
      ignore0 = true;
      continue;
    }

    output += piece.toString(16);
    if (pieceIndex !== 7) output += ':';
  }

  return output;
}

function findIPv6CompressedPieceIndex(address: IPv6Address): number | null {
  let longestIndex: number | null = null;
  let longestSize = 1;
  let foundIndex: number | null = null;
  let foundSize = 0;

  for (let pieceIndex = 0; pieceIndex < address.pieces.length; pieceIndex++) {
    if (address.pieces[pieceIndex] !== 0) {
      if (foundSize > longestSize) {
        longestIndex = foundIndex;
        longestSize = foundSize;
      }
      foundIndex = null;
      foundSize = 0;
    } else {
      foundIndex ??= pieceIndex;
      foundSize++;
    }
  }

  return foundSize > longestSize ? foundIndex : longestIndex;
}

function preserveTrailingDot(
  host: string,
  result: string | null,
): string | null {
  if (result === null) return null;
  return host.endsWith('.') ? `${result}.` : result;
}

function stripTrailingDot(host: string): string {
  return host.endsWith('.') ? host.slice(0, -1) : host;
}

function domainParserToASCII(domain: string, beStrict: boolean): string | null {
  return toASCII(domain, {
    checkHyphens: beStrict,
    checkBidi: true,
    checkJoiners: true,
    useSTD3ASCIIRules: beStrict,
    transitionalProcessing: false,
    verifyDNSLength: beStrict,
    ignoreInvalidPunycode: false,
  });
}

function isForbiddenDomainCodePoint(codePoint: string): boolean {
  const value = codePoint.codePointAt(0)!;
  return isForbiddenHostCodePoint(codePoint) || value <= 0x1f ||
    value === 0x25 || value === 0x7f;
}
