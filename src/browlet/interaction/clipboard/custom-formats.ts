import type { InfraValue } from '../../../infra/index';
import { DOMExceptionImpl, DOMExceptionNames } from '../../../web-idl/core/index';
import { parseMIMEType, serializeMIMEType } from '../../../mime/index';
import type { BlobImpl } from '../../../file/index';

import type { BrowletEnvironment } from '../../environment/index';

import { getCustomFormatMapName, getCustomFormatName, type ClipboardPlatform } from './formats';

/** Decode one custom-format map to canonical web-prefixed MIME keys and OS format names. */
// https://w3c.github.io/clipboard-apis/#to-read-web-custom-format
// The caller supplies the map bytes from its clipboard generation; payloads remain unread.
export function readCustomFormats(data: Uint8Array, env: BrowletEnvironment): Map<string, string> {
  const formats = new Map<string, string>();
  if (data.length === 0) return formats;
  let value: InfraValue;
  try { value = env.parseJSONBytesToInfra(data); }
  catch (error) {
    if (!(error instanceof env.realm.SyntaxError)) throw error;
    return formats;
  }
  // SPEC_GAP(clipboard-custom-map-failures): Ignore malformed/non-object maps and invalid entries,
  // retaining the first valid canonical key. Distinct keys may name the same OS format.
  if (!(value instanceof Map)) return formats;
  for (const [type, format] of value) {
    if (typeof format !== 'string' || format === '') continue;
    const mimeType = parseMIMEType(type);
    if (mimeType === null) continue;
    // SPEC_CLASH(clipboard-custom-map-mime): Keep the full parsed MIME type as A.5 requires;
    // Blink strips parameters. Strict JSON uses Infra rather than Blink's JSON extensions.
    const key = 'web ' + serializeMIMEType(mimeType);
    if (!formats.has(key)) formats.set(key, format);
  }
  return formats;
}

/** Prepare custom payload/name pairs and their UTF-8 JSON map for one later OS commit. */
// https://w3c.github.io/clipboard-apis/#to-write-web-custom-formats
// A.6's writes are returned as data, preserving the approved collective-commit policy.
export function prepareCustomFormats(items: BlobImpl[], platform: ClipboardPlatform, env: BrowletEnvironment): ClipboardCustomWrite {
  // SPEC_CLASH(clipboard-custom-format-count): A.6 writes 101 entries then truncates.
  // Like Blink's public write admission, reject more than 100 before any OS effect.
  if (items.length > 100) throw new DOMExceptionImpl('Clipboard writes support at most 100 custom formats', DOMExceptionNames.notAllowed);
  const map = new Map<string, InfraValue>();
  const representations: ClipboardCustomRepresentation[] = [];
  for (const item of items) {
    const mimeType = parseMIMEType(item.type);
    if (mimeType === null) throw new DOMExceptionImpl('Invalid custom clipboard MIME type', DOMExceptionNames.notAllowed);
    const type = serializeMIMEType(mimeType);
    // SPEC_CLASH(clipboard-custom-write-duplicates): A.6 overwrites duplicate map keys;
    // Blink's writer keeps the first. Reject canonical duplicates so no requested payload is lost.
    if (map.has(type)) throw new DOMExceptionImpl('Duplicate custom clipboard MIME type', DOMExceptionNames.notAllowed);
    const format = getCustomFormatName(representations.length, platform);
    map.set(type, format);
    representations.push({ format, data: item });
  }
  return {
    mapFormat: getCustomFormatMapName(platform), mapData: env.serializeInfraValueToJSONBytes(map), representations,
  };
}

/** One prepared A.6 batch; its map and payloads must be committed together. */
export interface ClipboardCustomWrite {
  mapFormat: string;
  mapData: Uint8Array;
  representations: ClipboardCustomRepresentation[];
}
export interface ClipboardCustomRepresentation {
  format: string;
  data: BlobImpl;
}
