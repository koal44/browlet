import type { BlobImpl } from '../file/blob';
import type { FileImpl } from '../file/file';
import type { ScalarValueString } from '../infra/index';
import { defineCapability } from '../web-idl/capability';
import {
  arg, contextValue, ctor, defineInterface, defineTypedef, idlType, impl, iter,
  nullable, op, reference, sequence, union,
} from '../web-idl/declaration/index';
import type { BindingContext } from '../web-idl/projection';

export type FormDataEntryValue = FileImpl | ScalarValueString;
export type FormDataEntry = readonly [
  name: ScalarValueString,
  value: FormDataEntryValue,
];

export type CreateFormDataEntry = (
  name: string,
  value: BlobImpl | string,
  filename?: ScalarValueString,
) => FormDataEntry;

/* HTML supplies its create-an-entry algorithm to XHR's FormData. */
export const createFormDataEntry =
  defineCapability<CreateFormDataEntry>('HTML create an entry');

/*
 * XMLHttpRequest Standard §4 — Interface FormData
 *
 * typedef (File or USVString) FormDataEntryValue;
 *
 * [Exposed=(Window,Worker)]
 * interface FormData {
 *   constructor(optional HTMLFormElement form,
 *               optional HTMLElement? submitter = null);
 *
 *   undefined append(USVString name, USVString value);
 *   undefined append(USVString name, Blob blobValue,
 *                    optional USVString filename);
 *   undefined delete(USVString name);
 *   FormDataEntryValue? get(USVString name);
 *   sequence<FormDataEntryValue> getAll(USVString name);
 *   boolean has(USVString name);
 *   undefined set(USVString name, USVString value);
 *   undefined set(USVString name, Blob blobValue,
 *                 optional USVString filename);
 *   iterable<USVString, FormDataEntryValue>;
 * };
 */
export class FormDataImpl {
  readonly #createEntry: CreateFormDataEntry;
  readonly #entryList: FormDataEntry[] = [];

  // SPEC_MISMATCH: FormData(form?, submitter = null) -> FormData
  constructor(createEntry: CreateFormDataEntry, form?: object) {
    this.#createEntry = createEntry;

    /*
     * XHR §4 delegates this branch to HTML's construct-the-entry-list
     * algorithm. HTMLFormElement, form ownership, successful controls, and
     * the formdata event are not implemented yet. Keep this guard for the
     * point at which HTMLFormElement becomes a resolvable IDL interface; until
     * then Web IDL rejects the argument at that earlier missing dependency.
     */
    if (form !== undefined) {
      throw new Error(
        'FormData(form, submitter) requires HTML form entry-list construction',
      );
    }
  }

  append(
    name: ScalarValueString,
    value: BlobImpl | ScalarValueString,
    filename?: ScalarValueString,
  ): void {
    this.#entryList.push(
      this.#createEntry(name, value, filename),
    );
  }

  delete(name: ScalarValueString): void {
    for (let index = this.#entryList.length - 1; index >= 0; index--) {
      if (this.#entryList[index]![0] === name) this.#entryList.splice(index, 1);
    }
  }

  get(name: ScalarValueString): FormDataEntryValue | null {
    return this.#entryList.find((entry) => entry[0] === name)?.[1] ?? null;
  }

  getAll(name: ScalarValueString): FormDataEntryValue[] {
    return this.#entryList
      .filter((entry) => entry[0] === name)
      .map((entry) => entry[1]);
  }

  has(name: ScalarValueString): boolean {
    return this.#entryList.some((entry) => entry[0] === name);
  }

  set(
    name: ScalarValueString,
    value: BlobImpl | ScalarValueString,
    filename?: ScalarValueString,
  ): void {
    const entry = this.#createEntry(name, value, filename);
    const first = this.#entryList.findIndex((candidate) =>
      candidate[0] === name);

    if (first === -1) {
      this.#entryList.push(entry);
      return;
    }

    this.#entryList[first] = entry;
    for (let index = this.#entryList.length - 1; index > first; index--) {
      if (this.#entryList[index]![0] === name) this.#entryList.splice(index, 1);
    }
  }

  *entries(): IterableIterator<FormDataEntry> {
    for (let index = 0; index < this.#entryList.length; index++) {
      yield this.#entryList[index]!;
    }
  }

  /** XHR §4 entry-list access for Fetch BodyInit extraction. */
  static getEntryList(formData: FormDataImpl): readonly FormDataEntry[] {
    return formData.#entryList;
  }
}

// -- Web IDL ------------------------------------------------------------
export const formDataEntryValueIDL = defineTypedef({
  name: 'FormDataEntryValue',
  type: union(reference('File'), idlType.USVString),
});

export const formDataIDL = defineInterface({
  name: 'FormData',
  exposed: ['Window', 'Worker'],
  implementation: impl(FormDataImpl, {
    constructWith: [contextValue(getCreateEntry)],
  }),
  members: [
    /*
     * HTMLFormElement is deliberately unresolved until HTML forms exist.
     * This preserves the normative signature and makes the missing dependency
     * observable instead of accepting and ignoring a supplied form.
     */
    ctor([
      arg('form', reference('HTMLFormElement'), { optional: true }),
      arg('submitter', nullable(reference('HTMLElement')), {
        default: null,
        optional: true,
      }),
    ]),
    op('append', idlType.undefined, [
      arg('name', idlType.USVString),
      arg('value', idlType.USVString),
    ]),
    op('append', idlType.undefined, [
      arg('name', idlType.USVString),
      arg('blobValue', reference('Blob')),
      arg('filename', idlType.USVString, { optional: true }),
    ]),
    op('delete', idlType.undefined, [
      arg('name', idlType.USVString),
    ]),
    op('get', nullable(reference(formDataEntryValueIDL.name)), [
      arg('name', idlType.USVString),
    ]),
    op('getAll', sequence(reference(formDataEntryValueIDL.name)), [
      arg('name', idlType.USVString),
    ]),
    op('has', idlType.boolean, [
      arg('name', idlType.USVString),
    ]),
    op('set', idlType.undefined, [
      arg('name', idlType.USVString),
      arg('value', idlType.USVString),
    ]),
    op('set', idlType.undefined, [
      arg('name', idlType.USVString),
      arg('blobValue', reference('Blob')),
      arg('filename', idlType.USVString, { optional: true }),
    ]),
    iter(reference(formDataEntryValueIDL.name), {
      key: idlType.USVString,
    }),
  ],
});

// BINDING_INTEGRATION: supply HTML's entry-creation algorithm to the FormData constructor.
function getCreateEntry(context: BindingContext): CreateFormDataEntry {
  const createEntry = context.getCapability(
    formDataIDL,
    createFormDataEntry,
  );
  if (!createEntry) {
    throw new Error('FormData has no HTML create-an-entry capability');
  }
  return createEntry;
}
