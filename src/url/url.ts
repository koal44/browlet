import {
  domainToUnicode, obtainRegistrableDomain, parseHost, serializeHost, type Host,
} from './host';
import { utf8PercentEncode, percentEncodeAfterEncoding } from './percent-encoding';
import { CodePointCursor, isURLCodePoint } from './cp-cursor';
import { createOpaqueOrigin, type Origin } from './origin';
import type { URLValidationError } from './validation-error';

/*
 * A URL record.
 *
 * https://url.spec.whatwg.org/#concept-url
 */
export type URLRecord = {
  scheme: string;
  username: string;
  password: string;
  host: Host | null;
  port: number | null;
  path: URLPath;
  query: string | null;
  fragment: string | null;
  blobURLEntry: BlobURLEntry | null;
};

export type URLParseResult = {
  url: URLRecord | null;
  validationErrors: URLValidationError[];
};

export type URLRenderOptions = {
  hostOnly?: boolean;
  omitScheme?: boolean;
  simplifyHost?: boolean;
  maxLength?: number;
};

type URLPath = string | string[];

type BlobURLEntry = {
  environment: {
    origin: Origin;
  };
};

type BasicURLParserOptions = {
  base?: URLRecord | null;
  encoding?: string;
  url?: URLRecord;
  stateOverride?: URLParserState;
};

type URLParserState =
  | 'scheme start'
  | 'scheme'
  | 'no scheme'
  | 'special relative or authority'
  | 'path or authority'
  | 'relative'
  | 'relative slash'
  | 'special authority slashes'
  | 'special authority ignore slashes'
  | 'authority'
  | 'host'
  | 'hostname'
  | 'port'
  | 'file'
  | 'file slash'
  | 'file host'
  | 'path start'
  | 'path'
  | 'opaque path'
  | 'query'
  | 'fragment';

/*
 * URL parser.
 *
 * Blob URL entry resolution belongs to the host's blob URL store. Until that
 * service exists, parsed blob URLs retain their record's initial null entry.
 *
 * https://url.spec.whatwg.org/#concept-url-parser
 */
export function parseURL(
  input: string,
  base: URLRecord | null = null,
  encoding = 'UTF-8',
): URLParseResult {
  return basicURLParse(input, { base, encoding });
}

/*
 * Basic URL parser.
 *
 * https://url.spec.whatwg.org/#concept-basic-url-parser
 */
export function basicURLParse(
  input: string,
  options: BasicURLParserOptions = {},
): URLParseResult {
  const validationErrors: URLValidationError[] = [];
  const suppliedURL = options.url;
  const url = suppliedURL ?? createURL();
  const base = options.base ?? null;
  const stateOverride = options.stateOverride;
  let encoding = options.encoding ?? 'UTF-8';

  if (suppliedURL === undefined) {
    const stripped = trimC0ControlOrSpace(input);
    if (stripped !== input) validationErrors.push('invalid-URL-unit');
    input = stripped;
  }

  if (/[\t\n\r]/u.test(input)) validationErrors.push('invalid-URL-unit');
  input = input.replace(/[\t\n\r]/gu, '');

  let state: URLParserState = stateOverride ?? 'scheme start';
  let buffer = '';
  let atSignSeen = false;
  let insideBrackets = false;
  let passwordTokenSeen = false;
  const cursor = new CodePointCursor(input);

  while (true) {
    const c = cursor.peek();
    let advance = true;
    let terminate = false;

    switch (state) {
      case 'scheme start':
        if (isASCIIAlpha(c)) {
          buffer += c.toLowerCase();
          state = 'scheme';
        } else if (stateOverride === undefined) {
          state = 'no scheme';
          advance = false;
        } else {
          return failure(validationErrors);
        }
        break;

      case 'scheme':
        if (isASCIIAlphanumeric(c) || c === '+' || c === '-' || c === '.') {
          buffer += c.toLowerCase();
        } else if (c === ':') {
          if (stateOverride !== undefined) {
            if (isSpecialScheme(url.scheme) !== isSpecialScheme(buffer)) {
              return { url, validationErrors };
            }
            if ((includesCredentials(url) || url.port !== null) && buffer === 'file') {
              return { url, validationErrors };
            }
            if (
              url.scheme === 'file' && url.host !== null &&
              url.host.kind === 'empty'
            ) {
              return { url, validationErrors };
            }
          }

          url.scheme = buffer;
          if (stateOverride !== undefined) {
            if (url.port === getDefaultPort(url.scheme)) url.port = null;
            terminate = true;
            break;
          }

          buffer = '';
          if (url.scheme === 'file') {
            if (!(cursor.peek(1) === '/' && cursor.peek(2) === '/')) {
              validationErrors.push('special-scheme-missing-following-solidus');
            }
            state = 'file';
          } else if (
            isSpecialURL(url) && base !== null && base.scheme === url.scheme
          ) {
            state = 'special relative or authority';
          } else if (isSpecialURL(url)) {
            state = 'special authority slashes';
          } else if (cursor.peek(1) === '/') {
            state = 'path or authority';
            cursor.restore(cursor.pos() + 2);
            advance = false;
          } else {
            url.path = '';
            state = 'opaque path';
          }
        } else if (stateOverride === undefined) {
          buffer = '';
          state = 'no scheme';
          cursor.restore(0);
          advance = false;
        } else {
          return failure(validationErrors);
        }
        break;

      case 'no scheme':
        if (base === null || hasOpaquePath(base) && c !== '#') {
          validationErrors.push('missing-scheme-non-relative-URL');
          return failure(validationErrors);
        }
        if (hasOpaquePath(base) && c === '#') {
          url.scheme = base.scheme;
          url.path = base.path;
          url.query = base.query;
          url.fragment = '';
          state = 'fragment';
        } else if (base.scheme !== 'file') {
          state = 'relative';
          advance = false;
        } else {
          state = 'file';
          advance = false;
        }
        break;

      case 'special relative or authority':
        if (c === '/' && cursor.peek(1) === '/') {
          state = 'special authority ignore slashes';
          cursor.restore(cursor.pos() + 2);
          advance = false;
        } else {
          validationErrors.push('special-scheme-missing-following-solidus');
          state = 'relative';
          advance = false;
        }
        break;

      case 'path or authority':
        if (c === '/') {
          state = 'authority';
        } else {
          state = 'path';
          advance = false;
        }
        break;

      case 'relative':
        url.scheme = base!.scheme;
        if (c === '/') {
          state = 'relative slash';
        } else if (isSpecialURL(url) && c === '\\') {
          validationErrors.push('invalid-reverse-solidus');
          state = 'relative slash';
        } else {
          copyAuthority(base!, url);
          url.path = clonePath(base!.path);
          url.query = base!.query;
          if (c === '?') {
            url.query = '';
            state = 'query';
          } else if (c === '#') {
            url.fragment = '';
            state = 'fragment';
          } else if (c !== '') {
            url.query = null;
            shortenURLPath(url);
            state = 'path';
            advance = false;
          }
        }
        break;

      case 'relative slash':
        if (isSpecialURL(url) && (c === '/' || c === '\\')) {
          if (c === '\\') validationErrors.push('invalid-reverse-solidus');
          state = 'special authority ignore slashes';
        } else if (c === '/') {
          state = 'authority';
        } else {
          copyAuthority(base!, url);
          state = 'path';
          advance = false;
        }
        break;

      case 'special authority slashes':
        if (c === '/' && cursor.peek(1) === '/') {
          state = 'special authority ignore slashes';
          cursor.restore(cursor.pos() + 2);
          advance = false;
        } else {
          validationErrors.push('special-scheme-missing-following-solidus');
          state = 'special authority ignore slashes';
          advance = false;
        }
        break;

      case 'special authority ignore slashes':
        if (c !== '/' && c !== '\\') {
          state = 'authority';
          advance = false;
        } else {
          validationErrors.push('special-scheme-missing-following-solidus');
        }
        break;

      case 'authority':
        if (c === '@') {
          validationErrors.push('invalid-credentials');
          if (atSignSeen) buffer = `%40${buffer}`;
          atSignSeen = true;

          for (const codePoint of buffer) {
            if (codePoint === ':' && !passwordTokenSeen) {
              passwordTokenSeen = true;
              continue;
            }
            const encoded = utf8PercentEncode(codePoint, 'userinfo');
            if (passwordTokenSeen) url.password += encoded;
            else url.username += encoded;
          }
          buffer = '';
        } else if (
          c === '' || c === '/' || c === '?' || c === '#' ||
          isSpecialURL(url) && c === '\\'
        ) {
          if (atSignSeen && buffer === '') {
            validationErrors.push('host-missing');
            return failure(validationErrors);
          }
          cursor.restore(cursor.pos() - Array.from(buffer).length);
          buffer = '';
          state = 'host';
          advance = false;
        } else {
          buffer += c;
        }
        break;

      case 'host':
      case 'hostname':
        if (stateOverride !== undefined && url.scheme === 'file') {
          state = 'file host';
          advance = false;
        } else if (c === ':' && !insideBrackets) {
          if (buffer === '') {
            validationErrors.push('host-missing');
            return failure(validationErrors);
          }
          if (stateOverride === 'hostname') return failure(validationErrors);
          if (!setParsedHost(url, buffer, validationErrors)) {
            return failure(validationErrors);
          }
          buffer = '';
          state = 'port';
        } else if (
          c === '' || c === '/' || c === '?' || c === '#' ||
          isSpecialURL(url) && c === '\\'
        ) {
          advance = false;
          if (isSpecialURL(url) && buffer === '') {
            validationErrors.push('host-missing');
            return failure(validationErrors);
          }
          if (
            stateOverride !== undefined && buffer === '' &&
            (includesCredentials(url) || url.port !== null)
          ) {
            return failure(validationErrors);
          }
          if (!setParsedHost(url, buffer, validationErrors)) {
            return failure(validationErrors);
          }
          buffer = '';
          state = 'path start';
          if (stateOverride !== undefined) terminate = true;
        } else {
          if (c === '[') insideBrackets = true;
          if (c === ']') insideBrackets = false;
          buffer += c;
        }
        break;

      case 'port':
        if (isASCIIDigit(c)) {
          buffer += c;
        } else if (
          c === '' || c === '/' || c === '?' || c === '#' ||
          isSpecialURL(url) && c === '\\' || stateOverride !== undefined
        ) {
          if (buffer !== '') {
            const port = Number(buffer);
            if (port > 0xffff) {
              validationErrors.push('port-out-of-range');
              return failure(validationErrors);
            }
            url.port = port === getDefaultPort(url.scheme) ? null : port;
            buffer = '';
            if (stateOverride !== undefined) {
              terminate = true;
              break;
            }
          }
          if (stateOverride !== undefined) return failure(validationErrors);
          state = 'path start';
          advance = false;
        } else {
          validationErrors.push('port-invalid');
          return failure(validationErrors);
        }
        break;

      case 'file':
        url.scheme = 'file';
        url.host = { kind: 'empty' };
        if (c === '/' || c === '\\') {
          if (c === '\\') validationErrors.push('invalid-reverse-solidus');
          state = 'file slash';
        } else if (base !== null && base.scheme === 'file') {
          url.host = base.host;
          url.path = clonePath(base.path);
          url.query = base.query;
          if (c === '?') {
            url.query = '';
            state = 'query';
          } else if (c === '#') {
            url.fragment = '';
            state = 'fragment';
          } else if (c !== '') {
            url.query = null;
            if (!startsWithWindowsDriveLetterAt(cursor)) {
              shortenURLPath(url);
            } else {
              validationErrors.push('file-invalid-Windows-drive-letter');
              url.path = [];
            }
            state = 'path';
            advance = false;
          }
        } else {
          state = 'path';
          advance = false;
        }
        break;

      case 'file slash':
        if (c === '/' || c === '\\') {
          if (c === '\\') validationErrors.push('invalid-reverse-solidus');
          state = 'file host';
        } else {
          if (base !== null && base.scheme === 'file') {
            url.host = base.host;
            if (
              !startsWithWindowsDriveLetterAt(cursor) &&
              !hasOpaquePath(base) && base.path.length > 0 &&
              isNormalizedWindowsDriveLetter(base.path[0]!)
            ) {
              hierarchicalPath(url).push(base.path[0]!);
            }
          }
          state = 'path';
          advance = false;
        }
        break;

      case 'file host':
        if (c === '' || c === '/' || c === '\\' || c === '?' || c === '#') {
          advance = false;
          if (stateOverride === undefined && isWindowsDriveLetterString(buffer)) {
            validationErrors.push('file-invalid-Windows-drive-letter-host');
            state = 'path';
          } else if (buffer === '') {
            url.host = { kind: 'empty' };
            if (stateOverride !== undefined) terminate = true;
            else state = 'path start';
          } else {
            const result = parseHost(buffer, !isSpecialURL(url));
            validationErrors.push(...result.validationErrors);
            if (result.host === null) return failure(validationErrors);
            url.host = result.host.kind === 'domain' &&
              result.host.value === 'localhost'
              ? { kind: 'empty' }
              : result.host;
            if (stateOverride !== undefined) {
              terminate = true;
            } else {
              buffer = '';
              state = 'path start';
            }
          }
        } else {
          buffer += c;
        }
        break;

      case 'path start':
        if (isSpecialURL(url)) {
          if (c === '\\') validationErrors.push('invalid-reverse-solidus');
          state = 'path';
          if (c !== '/' && c !== '\\') advance = false;
        } else if (stateOverride === undefined && c === '?') {
          url.query = '';
          state = 'query';
        } else if (stateOverride === undefined && c === '#') {
          url.fragment = '';
          state = 'fragment';
        } else if (c !== '') {
          state = 'path';
          if (c !== '/') advance = false;
        } else if (stateOverride !== undefined && url.host === null) {
          hierarchicalPath(url).push('');
        }
        break;

      case 'path':
        if (
          c === '' || c === '/' || isSpecialURL(url) && c === '\\' ||
          stateOverride === undefined && (c === '?' || c === '#')
        ) {
          if (isSpecialURL(url) && c === '\\') {
            validationErrors.push('invalid-reverse-solidus');
          }
          const path = hierarchicalPath(url);
          if (isDoubleDotPathSegment(buffer)) {
            shortenURLPath(url);
            if (c !== '/' && !(isSpecialURL(url) && c === '\\')) path.push('');
          } else if (isSingleDotPathSegment(buffer)) {
            if (c !== '/' && !(isSpecialURL(url) && c === '\\')) path.push('');
          } else {
            if (
              url.scheme === 'file' && path.length === 0 &&
              isWindowsDriveLetterString(buffer)
            ) {
              buffer = `${buffer[0]}:`;
            }
            path.push(buffer);
          }
          buffer = '';
          if (c === '?') {
            url.query = '';
            state = 'query';
          } else if (c === '#') {
            url.fragment = '';
            state = 'fragment';
          }
        } else {
          validateURLUnit(c, cursor, validationErrors);
          buffer += utf8PercentEncode(c, 'path');
        }
        break;

      case 'opaque path':
        if (c === '?') {
          url.query = '';
          state = 'query';
        } else if (c === '#') {
          url.fragment = '';
          state = 'fragment';
        } else if (c === ' ') {
          validationErrors.push('invalid-URL-unit');
          url.path = `${url.path as string}${
            cursor.peek(1) === '?' || cursor.peek(1) === '#' ? '%20' : ' '
          }`;
        } else if (c !== '') {
          validateURLUnit(c, cursor, validationErrors);
          url.path = `${url.path as string}${utf8PercentEncode(c, 'c0_control')}`;
        }
        break;

      case 'query':
        if (
          encoding.toUpperCase() !== 'UTF-8' &&
          (!isSpecialURL(url) || url.scheme === 'ws' || url.scheme === 'wss')
        ) {
          encoding = 'UTF-8';
        }
        if (stateOverride === undefined && c === '#' || c === '') {
          const set = isSpecialURL(url) ? 'special_query' : 'query';
          url.query! += percentEncodeAfterEncoding(encoding, buffer, set);
          buffer = '';
          if (c === '#') {
            url.fragment = '';
            state = 'fragment';
          }
        } else {
          validateURLUnit(c, cursor, validationErrors);
          buffer += c;
        }
        break;

      case 'fragment':
        if (c !== '') {
          validateURLUnit(c, cursor, validationErrors);
          url.fragment! += utf8PercentEncode(c, 'fragment');
        }
        break;
    }

    if (terminate) break;
    if (advance) {
      if (cursor.eof()) break;
      cursor.consume();
    }
  }

  return { url, validationErrors };
}

export function setURLUsername(url: URLRecord, username: string): void {
  url.username = utf8PercentEncode(username, 'userinfo');
}

export function setURLPassword(url: URLRecord, password: string): void {
  url.password = utf8PercentEncode(password, 'userinfo');
}

/*
 * URL serializer.
 *
 * https://url.spec.whatwg.org/#concept-url-serializer
 */
export function serializeURL(
  url: URLRecord,
  excludeFragment = false,
): string {
  let output = `${url.scheme}:`;

  if (url.host !== null) {
    output += '//';
    if (includesCredentials(url)) {
      output += url.username;
      if (url.password !== '') output += `:${url.password}`;
      output += '@';
    }
    output += serializeHost(url.host);
    if (url.port !== null) output += `:${url.port}`;
  }

  if (
    url.host === null && !hasOpaquePath(url) && url.path.length > 1 &&
    url.path[0] === ''
  ) {
    output += '/.';
  }

  output += serializeURLPath(url);
  if (url.query !== null) output += `?${url.query}`;
  if (!excludeFragment && url.fragment !== null) output += `#${url.fragment}`;

  return output;
}

/*
 * URL equivalence.
 *
 * https://url.spec.whatwg.org/#url-equivalence
 */
export function urlsEqual(
  a: URLRecord,
  b: URLRecord,
  excludeFragments = false,
): boolean {
  return serializeURL(a, excludeFragments) ===
    serializeURL(b, excludeFragments);
}

/*
 * The origin of a URL.
 *
 * The URL Standard leaves file origins to the user agent. This implementation
 * follows its conservative fallback and returns a new opaque origin.
 *
 * https://url.spec.whatwg.org/#concept-url-origin
 */
export function obtainURLOrigin(url: URLRecord): Origin {
  switch (url.scheme) {
    case 'blob': {
      if (url.blobURLEntry !== null) {
        return url.blobURLEntry.environment.origin;
      }

      const pathURL = parseURL(serializeURLPath(url)).url;
      if (
        pathURL !== null &&
        (pathURL.scheme === 'http' ||
          pathURL.scheme === 'https' ||
          pathURL.scheme === 'file')
      ) {
        return obtainURLOrigin(pathURL);
      }
      return createOpaqueOrigin();
    }

    case 'ftp':
    case 'http':
    case 'https':
    case 'ws':
    case 'wss':
      return {
        kind: 'tuple',
        scheme: url.scheme,
        host: url.host!,
        port: url.port,
        domain: null,
      };

    default:
      return createOpaqueOrigin();
  }
}

/*
 * Render a URL for a security- or trust-sensitive display surface.
 *
 * Credentials are always omitted. Elision treats maxLength as a code-point
 * budget, but preserves the complete registrable domain even when it exceeds
 * that budget.
 *
 * https://url.spec.whatwg.org/#url-rendering
 */
export function renderURL(
  url: URLRecord,
  options: URLRenderOptions = {},
): string {
  const host = url.host === null || !options.simplifyHost
    ? url.host
    : obtainRegistrableDomain(url.host) ?? url.host;
  const portSuffix = url.port === null ? '' : `:${url.port}`;
  const authority = host === null
    ? ''
    : (host.kind === 'domain' ? domainToUnicode(host) : serializeHost(host)) +
      portSuffix;

  if (options.hostOnly) {
    return elideHost(authority, host, url.port, options.maxLength);
  }

  const displayURL: URLRecord = {
    ...url,
    username: '',
    password: '',
    host,
  };
  let output = serializeURL(displayURL);
  const schemePrefix = host === null ? `${url.scheme}:` : `${url.scheme}://`;

  if (host !== null) {
    const serializedAuthority = serializeHost(host) + portSuffix;
    output = schemePrefix + authority +
      output.slice(schemePrefix.length + serializedAuthority.length);
  }

  if (options.omitScheme) output = output.slice(schemePrefix.length);
  if (
    options.maxLength === undefined ||
    codePointLength(output) <= options.maxLength
  ) {
    return output;
  }

  if (host === null) {
    if (options.maxLength <= 1) return '…';
    return Array.from(output).slice(0, options.maxLength - 1).join('') + '…';
  }

  const prefix = options.omitScheme ? '' : schemePrefix;
  const suffix = output.slice(prefix.length + authority.length);
  const tail = suffix === '' ? '' : suffix.startsWith('/') ? '/…' : '…';

  if (fits(prefix + authority + tail, options.maxLength)) {
    return prefix + authority + tail;
  }
  if (fits(prefix + authority, options.maxLength)) return prefix + authority;
  if (fits(authority + tail, options.maxLength)) return authority + tail;
  if (fits(authority, options.maxLength)) return authority;

  return elideHost(authority, host, url.port, options.maxLength, prefix);
}

function elideHost(
  authority: string,
  host: Host | null,
  port: number | null,
  maxLength: number | undefined,
  prefix = '',
): string {
  if (maxLength === undefined || fits(prefix + authority, maxLength)) {
    return prefix + authority;
  }
  if (host === null || host.kind !== 'domain') return authority;

  const registrable = obtainRegistrableDomain(host) ?? host;
  const registrableValue = domainToUnicode(registrable);
  const portSuffix = port === null ? '' : `:${port}`;
  const { labels, trailingDot } = splitDomain(domainToUnicode(host));
  const registrableLabels = splitDomain(registrableValue).labels.length;
  const lastRemovableLabel = labels.length - registrableLabels;
  const prefixes = prefix === '' ? [''] : [prefix, ''];

  for (const candidatePrefix of prefixes) {
    for (let removed = 1; removed <= lastRemovableLabel; removed++) {
      const value =
        `…${labels.slice(removed).join('.')}${trailingDot}${portSuffix}`;
      if (fits(candidatePrefix + value, maxLength)) {
        return candidatePrefix + value;
      }
    }

    const registrableAuthority = registrableValue + portSuffix;
    if (fits(candidatePrefix + registrableAuthority, maxLength)) {
      return candidatePrefix + registrableAuthority;
    }
  }
  return registrableValue + portSuffix;
}

function splitDomain(domain: string): {
  labels: string[];
  trailingDot: string;
} {
  const trailingDot = domain.endsWith('.') ? '.' : '';
  const value = trailingDot === '' ? domain : domain.slice(0, -1);
  return { labels: value.split('.'), trailingDot };
}

function fits(value: string, maxLength: number): boolean {
  return codePointLength(value) <= maxLength;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function failure(validationErrors: URLValidationError[]): URLParseResult {
  return { url: null, validationErrors };
}

function setParsedHost(
  url: URLRecord,
  buffer: string,
  validationErrors: URLValidationError[],
): boolean {
  const result = parseHost(buffer, !isSpecialURL(url));
  validationErrors.push(...result.validationErrors);
  if (result.host === null) return false;
  url.host = result.host;
  return true;
}

function copyAuthority(from: URLRecord, to: URLRecord): void {
  to.username = from.username;
  to.password = from.password;
  to.host = from.host;
  to.port = from.port;
}

function clonePath(path: URLRecord['path']): URLRecord['path'] {
  return typeof path === 'string' ? path : [...path];
}

function hierarchicalPath(url: URLRecord): string[] {
  if (hasOpaquePath(url)) throw new TypeError('Expected a hierarchical URL path');
  return url.path as string[];
}

function startsWithWindowsDriveLetterAt(cursor: CodePointCursor): boolean {
  return isWindowsDriveLetter(cursor.peek(), cursor.peek(1)) &&
    isWindowsDriveLetterTerminator(cursor.peek(2));
}

function validateURLUnit(
  c: string,
  cursor: CodePointCursor,
  validationErrors: URLValidationError[],
): void {
  if ((!isURLCodePoint(c) && c !== '%') || c === '%' && !(
    isASCIIHexDigit(cursor.peek(1)) && isASCIIHexDigit(cursor.peek(2))
  )) {
    validationErrors.push('invalid-URL-unit');
  }
}

function trimC0ControlOrSpace(input: string): string {
  let start = 0;
  let end = input.length;
  while (start < end && input.charCodeAt(start) <= 0x20) start++;
  while (end > start && input.charCodeAt(end - 1) <= 0x20) end--;
  return input.slice(start, end);
}

function isASCIIAlpha(c: string): boolean {
  return /^[A-Za-z]$/u.test(c);
}

function isASCIIAlphanumeric(c: string): boolean {
  return /^[\dA-Za-z]$/u.test(c);
}

function isASCIIDigit(c: string): boolean {
  return /^\d$/u.test(c);
}

function isASCIIHexDigit(c: string): boolean {
  return /^[\dA-Fa-f]$/u.test(c);
}

function createURL(): URLRecord {
  return {
    scheme: '',
    username: '',
    password: '',
    host: null,
    port: null,
    path: [],
    query: null,
    fragment: null,
    blobURLEntry: null,
  };
}

function getDefaultPort(scheme: string): number | null {
  return specialSchemes.get(scheme) ?? null;
}

function isSpecialScheme(scheme: string): boolean {
  return specialSchemes.has(scheme);
}

function isSpecialURL(url: URLRecord): boolean {
  return isSpecialScheme(url.scheme);
}

function includesCredentials(url: URLRecord): boolean {
  return url.username !== '' || url.password !== '';
}

function hasOpaquePath(url: URLRecord): url is URLRecord & { path: string; } {
  return typeof url.path === 'string';
}

function isSingleDotPathSegment(segment: string): boolean {
  return segment === '.' || segment.toLowerCase() === '%2e';
}

function isDoubleDotPathSegment(segment: string): boolean {
  return ['..', '.%2e', '%2e.', '%2e%2e'].includes(segment.toLowerCase());
}

function isWindowsDriveLetter(first: string, second: string): boolean {
  return isASCIIAlpha(first) && (second === ':' || second === '|');
}

function isNormalizedWindowsDriveLetter(input: string): boolean {
  const codePoints = Array.from(input);
  return codePoints.length === 2 && isASCIIAlpha(codePoints[0]!) &&
    codePoints[1] === ':';
}

function isWindowsDriveLetterString(input: string): boolean {
  const codePoints = Array.from(input);
  return codePoints.length === 2 &&
    isWindowsDriveLetter(codePoints[0]!, codePoints[1]!);
}

function isWindowsDriveLetterTerminator(codePoint: string): boolean {
  return codePoint === '' || ['/', '\\', '?', '#'].includes(codePoint);
}

function shortenURLPath(url: URLRecord): void {
  if (hasOpaquePath(url)) {
    throw new TypeError('An opaque URL path cannot be shortened');
  }
  const path = url.path as string[];

  if (
    url.scheme === 'file' && path.length === 1 &&
    isNormalizedWindowsDriveLetter(path[0]!)
  ) {
    return;
  }

  path.pop();
}

function serializeURLPath(url: URLRecord): string {
  if (hasOpaquePath(url)) return url.path;
  return (url.path as string[]).map((segment) => `/${segment}`).join('');
}

const specialSchemes = new Map<string, number | null>([
  ['ftp', 21],
  ['file', null],
  ['http', 80],
  ['https', 443],
  ['ws', 80],
  ['wss', 443],
]);
