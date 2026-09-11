import { parseMIMEType } from '../mime/index';
import type { RuntimeContext } from '../js-engine/index';
import {
  arg, atArg, ctor, defineDictionary, defineInterface, dictMember,
  emptyDictionary, idlType, impl, reference, roAttr, sequence, xattr,
} from '../web-idl/declaration/index';
import { runtimeContext, type BindingContext } from '../web-idl/projection';
import {
  BlobImpl, type BlobPart, type BlobPropertyBag,
} from './blob';
import { BlobData, type BlobByteSource } from './blob-data';

/*
 * [Exposed=(Window,Worker), Serializable]
 * interface File : Blob {
 *   constructor(sequence<BlobPart> fileBits,
 *               USVString fileName,
 *               optional FilePropertyBag options = {});
 *   readonly attribute DOMString name;
 *   readonly attribute long long lastModified;
 * };
 *
 * dictionary FilePropertyBag : BlobPropertyBag {
 *   long long lastModified;
 * };
 */
export class FileImpl extends BlobImpl {
  #lastModified: number | null;
  #name: string;

  constructor(
    fileBits: Iterable<BlobPart> = [],
    fileName = '',
    options: FilePropertyBag = {},
    runtime: RuntimeContext,
  ) {
    super(fileBits, options, runtime);
    this.#name = fileName;
    this.#lastModified = options.lastModified ?? Date.now();
  }

  get name(): string {
    return this.#name;
  }

  get lastModified(): number {
    if (this.#lastModified !== null) return this.#lastModified;
    return Date.now();
  }

  // -- Internal operations ----------------------------------------------

  getFileSerializationState(): FileSerializationState {
    return {
      lastModified: this.lastModified,
      name: this.#name,
    };
  }

  setFileSerializationState(
    state: FileSerializationState,
  ): void {
    this.#lastModified = state.lastModified;
    this.#name = state.name;
  }

  static is(value: unknown): value is FileImpl {
    return value !== null && typeof value === 'object' && #name in value;
  }

  setHostMetadata(
    name: string,
    lastModified: number | undefined,
  ): void {
    this.#lastModified = lastModified ?? null;
    this.#name = name;
  }
}

export type FilePropertyBag = BlobPropertyBag & {
  lastModified?: number;
};

export type FileSerializationState = {
  lastModified: number;
  name: string;
};

export type HostFileMetadata = {
  lastModified?: number;
  name: string;
  type: string;
};

/** Browlet host integration for File API §4 host-selected storage. */
// BINDING_INTEGRATION: associate a host-selected File with its destination binding.
export function createFileFromHost(
  context: BindingContext,
  source: BlobByteSource,
  metadata: HostFileMetadata,
): FileImpl {
  const type = requireHostFileType(metadata.type);
  const file = context.construct(
    FileImpl,
    [],
    metadata.name,
    { lastModified: metadata.lastModified ?? 0, type },
  );
  file.setSerializationState({
    data: BlobData.fromSource(source),
    snapshotState: source.snapshotState,
    type,
  });
  file.setHostMetadata(metadata.name, metadata.lastModified);
  return file;
}

function requireHostFileType(value: string): string {
  if (value === '') return value;
  const type = parseMIMEType(value);
  if (
    !type || !containsOnlyASCII(value) || value !== value.toLowerCase() ||
    (type.type === 'text' && type.subtype === 'plain' &&
      type.parameters.has('charset'))
  ) {
    throw new TypeError('A host File requires a valid lowercase MIME type');
  }
  return value;
}

function containsOnlyASCII(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    if (value.charCodeAt(index) > 0x7f) return false;
  }
  return true;
}

// -- Web IDL ------------------------------------------------------------

export const filePropertyBagIDL = defineDictionary({
  name: 'FilePropertyBag',
  inherits: 'BlobPropertyBag',
  members: [
    dictMember('lastModified', idlType.longLong),
  ],
});

export const fileIDL = defineInterface({
  name: 'File',
  inherits: 'Blob',
  exposed: ['Window', 'Worker'],
  ...xattr('Serializable'),
  implementation: impl(FileImpl, {
    constructWith: [atArg(3, runtimeContext)],
  }),
  members: [
    ctor([
      arg('fileBits', sequence(reference('BlobPart'))),
      arg('fileName', idlType.USVString),
      arg('options', reference(filePropertyBagIDL.name), {
        default: emptyDictionary,
        optional: true,
      }),
    ]),
    roAttr('name', idlType.DOMString),
    roAttr('lastModified', idlType.longLong),
  ],
});
