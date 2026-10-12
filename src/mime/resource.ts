import { parseMIMEType, type MIMEType } from './mime-type';

/** Detect a supplied type, preserving the exact HTTP field value for Apache compatibility. */
// MIME Sniffing §5.1: supplied MIME type detection algorithm.
// https://mimesniff.spec.whatwg.org/#supplied-mime-type-detection-algorithm
export function detectSuppliedMIMEType(source: MIMETypeSource): SuppliedMIMETypeDetection {
  if (source.kind === 'mime-type') return { suppliedMIMEType: source.mimeType, checkForApacheBug: false };
  const value = source.contentType;
  return {
    suppliedMIMEType: value === undefined ? undefined : parseMIMEType(value) ?? undefined,
    checkForApacheBug: value !== undefined && apacheBugMIMETypeValues.has(value),
  };
}

/** Maximum prefix inspected when reading a resource header. */
// https://mimesniff.spec.whatwg.org/#read-the-resource-header
export const maximumResourceHeaderLength = 1445;

export type MIMETypeSource =
  | {
    kind: 'http';
    /** Last Content-Type field, as an unchanged isomorphic byte string; undefined if absent. */
    contentType: string | undefined;
  }
  | {
    kind: 'mime-type';
    mimeType: MIMEType | undefined;
  };

export type SuppliedMIMETypeDetection = {
  suppliedMIMEType: MIMEType | undefined;
  checkForApacheBug: boolean;
};

const apacheBugMIMETypeValues = new Set([
  'text/plain',
  'text/plain; charset=ISO-8859-1',
  'text/plain; charset=iso-8859-1',
  'text/plain; charset=UTF-8',
]);
