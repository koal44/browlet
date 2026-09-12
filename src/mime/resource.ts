import { isomorphicDecode } from '../js-engine/byte-string';
import type { PromiseValue } from '../js-engine/promises';
import type { RuntimeContext } from '../js-engine/runtime-context';
import { RangeError } from '../js-engine/simple-exception';

import { parseMIMEType, type MIMEType } from './mime-type';

/*
 * MIME Sniffing metadata associated with a resource.
 *
 * The resource itself remains owned by its loader. This record keeps only the
 * state that the MIME Sniffing Standard requires for that resource.
 *
 * https://mimesniff.spec.whatwg.org/#handling-a-resource
 */
export type ResourceMetadata = {
  suppliedMIMEType: MIMEType | undefined;
  checkForApacheBug: boolean;
  noSniff: boolean;
  computedMIMEType: MIMEType | undefined;
  resourceHeader: Uint8Array | undefined;
};

export type SuppliedMIMETypeSource =
  | {
    kind: 'http';
    contentTypeHeaders: Uint8Array[];
  }
  | {
    kind: 'file' | 'other';
    mimeType: MIMEType | undefined;
  };

export type ResourceMetadataOptions = {
  noSniff?: boolean;
};

/*
 * Read up to max bytes from the resource without consuming bytes beyond
 * that bound. Resolve null when the resource ends or the host's reasonable
 * read interval elapses. Reject to propagate cancellation or a source error.
 * The loader imports native I/O results through its runtime's promise facility.
 */
export type ReadResourceBytes = (
  max: number,
) => PromiseValue<Uint8Array | null>;

export function createResourceMetadata(
  source: SuppliedMIMETypeSource,
  options: ResourceMetadataOptions = {},
): ResourceMetadata {
  const supplied = detectSuppliedMIMEType(source);
  return {
    suppliedMIMEType: supplied.suppliedMIMEType,
    checkForApacheBug: supplied.checkForApacheBug,
    noSniff: options.noSniff ?? false,
    computedMIMEType: undefined,
    resourceHeader: undefined,
  };
}

/*
 * Supplied MIME type detection algorithm.
 *
 * HTTP supplies raw header bytes so the legacy Apache values can be compared
 * exactly before the final value is parsed into a MIME type record. File and
 * other protocol owners supply their already-determined record directly.
 *
 * https://mimesniff.spec.whatwg.org/#supplied-mime-type-detection-algorithm
 */
// SPEC_MISMATCH: supplied MIME type detection algorithm(resource) -> void
export function detectSuppliedMIMEType(
  source: SuppliedMIMETypeSource,
): {
  suppliedMIMEType: MIMEType | undefined;
  checkForApacheBug: boolean;
} {
  if (source.kind !== 'http') {
    return {
      suppliedMIMEType: source.mimeType,
      checkForApacheBug: false,
    };
  }

  const header = source.contentTypeHeaders.at(-1);
  if (header === undefined) {
    return {
      suppliedMIMEType: undefined,
      checkForApacheBug: false,
    };
  }

  const value = isomorphicDecode(header);
  return {
    suppliedMIMEType: parseMIMEType(value) ?? undefined,
    checkForApacheBug: apacheBugMIMETypeValues.has(value),
  };
}

/*
 * Read the resource header.
 *
 * The source controls end-of-input and the user agent's reasonable-time
 * decision by resolving null. The maximum passed to each read prevents the
 * MIME layer from consuming body bytes beyond the 1445-byte header.
 * Collection continuations use the supplied runtime's promise queue.
 *
 * https://mimesniff.spec.whatwg.org/#read-the-resource-header
 */
// SPEC_MISMATCH: read the resource header(resource) -> void
export function readResourceHeader(
  metadata: ResourceMetadata,
  readBytes: ReadResourceBytes,
  runtime: RuntimeContext,
): PromiseValue<Uint8Array> {
  return runtime.promises.try(() => {
    if (metadata.resourceHeader !== undefined) return metadata.resourceHeader;

    const buffer = new Uint8Array(maximumResourceHeaderLength);
    let length = 0;
    return readNext();

    function readNext(): PromiseValue<Uint8Array> {
      const max = buffer.length - length;
      return runtime.promises.try(() => readBytes(max)).then((chunk) => {
        if (chunk !== null) {
          if (chunk.length === 0 || chunk.length > max) {
            throw new RangeError(
              'A resource byte source must return between 1 and the requested number of bytes',
            );
          }
          buffer.set(chunk, length);
          length += chunk.length;
          if (length < buffer.length) return readNext();
        }

        metadata.resourceHeader = buffer.slice(0, length);
        return metadata.resourceHeader;
      });
    }
  });
}

export const maximumResourceHeaderLength = 1445;

const apacheBugMIMETypeValues = new Set([
  'text/plain',
  'text/plain; charset=ISO-8859-1',
  'text/plain; charset=iso-8859-1',
  'text/plain; charset=UTF-8',
]);
