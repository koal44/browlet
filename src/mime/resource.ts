import { isomorphicDecode } from '../js-engine/index';
import type { PromiseValue } from '../infra/promises';
import { RangeError } from '../infra/exceptions';

import { parseMIMEType, type MIMEType } from './mime-type';

export type MIMETypeSource =
  | {
    kind: 'http';
    contentTypeHeaders: Uint8Array[];
  }
  | {
    kind: 'mime-type';
    mimeType: MIMEType | undefined;
  };

export type SuppliedMIMETypeDetection = {
  suppliedMIMEType: MIMEType | undefined;
  checkForApacheBug: boolean;
};

/*
 * Supply successive chunks of 1..maxBytes from the beginning of the resource.
 * Keep their storage valid and unchanged while the resource header is retained.
 * The loader preserves these bytes and any excess for later body consumption.
 *
 * deadline is an absolute time in milliseconds on the source's monotonic clock.
 * Resolve null at end-of-input or the deadline, including during a pending read;
 * later bytes remain available to the loader. Return promises from the source's
 * runtime and report cancellation or read failures by rejection.
 */
export type ReadResourceBytes = (
  maxBytes: number,
  deadline: number,
) => PromiseValue<Uint8Array | null>;

/*
 * MIME Sniffing §5.1: supplied MIME type detection algorithm.
 *
 * HTTP callers retain the raw Content-Type bytes so the legacy Apache values
 * can be compared exactly before parsing. Other resource owners supply the
 * MIME type they have already determined.
 *
 * https://mimesniff.spec.whatwg.org/#supplied-mime-type-detection-algorithm
 */
export function detectSuppliedMIMEType(
  source: MIMETypeSource,
): SuppliedMIMETypeDetection {
  if (source.kind === 'mime-type') {
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
 * MIME Sniffing §5.2: read the resource header.
 *
 * Return the header for the resource owner to retain in its metadata. Reads
 * share one deadline and the source's promise queue. A single chunk is reused;
 * a fragmented prefix is copied once into contiguous storage.
 *
 * https://mimesniff.spec.whatwg.org/#read-the-resource-header
 */
export function readResourceHeader(
  readBytes: ReadResourceBytes,
  deadline: number,
): PromiseValue<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  return readNext();

  function readNext(): PromiseValue<Uint8Array> {
    const maxBytes = maximumResourceHeaderLength - length;
    return readBytes(maxBytes, deadline).then((chunk) => {
      if (chunk !== null) {
        if (chunk.length === 0 || chunk.length > maxBytes) {
          throw new RangeError(
            'A resource byte source must return between 1 and the requested number of bytes',
          );
        }
        chunks.push(chunk);
        length += chunk.length;
        if (length < maximumResourceHeaderLength) return readNext();
      }

      if (chunks.length === 1) return chunks[0]!;
      const header = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        header.set(chunk, offset);
        offset += chunk.length;
      }
      return header;
    });
  }
}

export const maximumResourceHeaderLength = 1445;

const apacheBugMIMETypeValues = new Set([
  'text/plain',
  'text/plain; charset=ISO-8859-1',
  'text/plain; charset=iso-8859-1',
  'text/plain; charset=UTF-8',
]);
