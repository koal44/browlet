import { parseHost, serializeHost } from '../../../src/url/host';
import { serializeOrigin, type Origin } from '../../../src/url/origin';
import {
  percentDecodeBytes,
  percentDecodeString,
  percentEncodeAfterEncoding,
  percentEncodeByte,
  type PercentEncodeSet,
  utf8PercentEncode,
} from '../../../src/url/percent-encoding';
import {
  obtainURLOrigin, parseURL, serializeURL, urlsEqual, type URLRecord,
} from '../../../src/url/url';
import {
  parseFormUrlEncoded, parseFormUrlEncodedString, serializeFormUrlEncoded,
} from '../../../src/url/form-url-encoded';
import type { URLValidationError } from '../../../src/url/validation-error';

export type { PercentEncodeSet } from '../../../src/url/percent-encoding';

/*
 * This adapter describes observable URL Standard behavior without prescribing
 * the production modules that implement each algorithm. Replace the throwing
 * function with an adapter over those modules as each test group is enabled.
 */
export function urlAlgorithms(): URLAlgorithms {
  return {
    percentEncodeByte,
    percentDecodeBytes,
    percentDecodeString,
    percentEncodeAfterEncoding,
    utf8PercentEncode,
    parseAndSerializeHost(input, isOpaque) {
      const result = parseHost(input, isOpaque);
      return {
        serialization: result.host === null ? null : serializeHost(result.host),
        validationErrors: result.validationErrors,
      };
    },
    parseURL(input, base) {
      let parsedBase: URLRecord | null = null;
      if (base !== undefined) {
        parsedBase = parseURL(base).url;
        if (parsedBase === null) return { url: null, validationErrors: [] };
      }
      return parseURL(input, parsedBase);
    },
    serializeURL(url, excludeFragment) {
      return serializeURL(url, excludeFragment);
    },
    inspectURL(url) {
      return {
        scheme: url.scheme,
        username: url.username,
        password: url.password,
        host: url.host === null ? null : serializeHost(url.host),
        port: url.port,
        path: typeof url.path === 'string' ? url.path : [...url.path],
        query: url.query,
        fragment: url.fragment,
      };
    },
    urlsEqual,
    obtainOrigin: obtainURLOrigin,
    serializeOrigin,
    parseFormUrlEncoded,
    parseFormUrlEncodedString,
    serializeFormUrlEncoded,
  };
}

export function urlConstructors(): URLConstructors {
  throw new Error('URL API bindings are not implemented');
}

export type URLAlgorithms = {
  percentEncodeByte(input: number): string;
  percentDecodeBytes(input: number[]): number[];
  percentDecodeString(input: string): number[];
  percentEncodeAfterEncoding(
    encoding: string,
    input: string,
    set: PercentEncodeSet,
  ): string;
  utf8PercentEncode(input: string, set: PercentEncodeSet): string;
  parseAndSerializeHost(input: string, isOpaque: boolean): HostParseResult;
  parseURL(input: string, base?: string): URLParseResult;
  serializeURL(url: URLRecord, excludeFragment?: boolean): string;
  inspectURL(url: URLRecord): URLSnapshot;
  urlsEqual(a: URLRecord, b: URLRecord, excludeFragments?: boolean): boolean;
  obtainOrigin(url: URLRecord): Origin;
  serializeOrigin(origin: Origin): string;
  parseFormUrlEncoded(input: number[]): FormTuple[];
  parseFormUrlEncodedString(input: string): FormTuple[];
  serializeFormUrlEncoded(tuples: FormTuple[], encoding?: string): string;
};

export type URLConstructors = {
  URL: typeof URL;
  URLSearchParams: typeof URLSearchParams;
};

export type HostParseResult = {
  serialization: string | null;
  validationErrors: URLValidationError[];
};

export type URLParseResult = {
  url: URLRecord | null;
  validationErrors: URLValidationError[];
};

export type URLSnapshot = {
  scheme: string;
  username: string;
  password: string;
  host: string | null;
  port: number | null;
  path: string | string[];
  query: string | null;
  fragment: string | null;
};

export type FormTuple = [name: string, value: string];
