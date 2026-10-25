import { parseURL as parse, type URLRecord } from '../../src/url/index';

/** Parse URL records used as inputs to stylesheet and value tests. */
export const parseURL = (input: string, base: URLRecord | null = null): URLRecord | null => parse(input, base).url;
