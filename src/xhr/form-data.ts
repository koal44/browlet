import type { BlobImpl } from '../file/blob';
import { FileImpl } from '../file/file';
import { toScalarValueString, type ScalarValueString } from '../infra/index';
import type { RuntimeContext } from '../js-engine/index';
import {
  arg, atArg, ctor, defineInterface, defineTypedef, idlType, impl, iter, nullable, op,
  reference, sequence, union,
} from '../web-idl/index';

export type FormDataEntryValue = FileImpl | ScalarValueString;
export type FormDataEntry = [
  name: ScalarValueString,
  value: FormDataEntryValue,
];

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
  #entryList: FormDataEntry[] = [];
  #runtime: RuntimeContext;

  // SPEC_MISMATCH: FormData(form?, submitter = null) -> FormData
  constructor(
    form: object | undefined = undefined,
    _submitter: object | null = null,
    runtime: RuntimeContext,
  ) {
    this.#runtime = runtime;

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
    this.#entryList.push(this.#createEntry(name, value, filename));
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

  // -- Internal methods -------------------------------------------------

  /** Adopt parsed entries without running HTML's entry-creation algorithm again. */
  static fromEntries(entries: FormDataEntry[], runtime: RuntimeContext): FormDataImpl {
    const formData = new FormDataImpl(undefined, null, runtime);
    formData.#entryList = entries;
    return formData;
  }

  /** XHR §4 — value pairs to iterate over; also used by Fetch BodyInit extraction. */
  getEntryList(): FormDataEntry[] {
    return this.#entryList;
  }

  // HTML, create an entry: https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#append-an-entry
  // New Files use this FormData's runtime; an unchanged File keeps its owner.
  #createEntry(name: string, value: BlobImpl | string, filename?: ScalarValueString): FormDataEntry {
    const entryName = toScalarValueString(name);
    if (typeof value === 'string') return [entryName, toScalarValueString(value)];
    if (FileImpl.is(value) && filename === undefined) return [entryName, value];

    const lastModified = FileImpl.is(value) ? value.lastModified : undefined;
    return [entryName, new FileImpl(
      [value], filename ?? toScalarValueString('blob'),
      { lastModified, type: value.type }, this.#runtime,
    )];
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
    constructWith: [atArg(2, (ctx) => ctx.getRuntime())],
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
