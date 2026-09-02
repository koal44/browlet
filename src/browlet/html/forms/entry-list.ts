import { FileImpl } from '../../../file/file';
import { toScalarValueString } from '../../../shared/strings';
import type { CreateFormDataEntry } from '../../../xhr/form-data';

/**
 * HTML §4.10.22.4, create an entry.
 *
 * The returned File implementation is realm-neutral until Web IDL projects it
 * as an operation result.
 */
export const createEntry: CreateFormDataEntry = (name, value, filename) => {
  const entryName = toScalarValueString(name);
  if (typeof value === 'string') {
    return [entryName, toScalarValueString(value)];
  }
  if (FileImpl.is(value) && filename === undefined) {
    return [entryName, value];
  }

  const lastModified = FileImpl.is(value) ? value.lastModified : undefined;
  return [
    entryName,
    new FileImpl(
      [value],
      filename ?? toScalarValueString('blob'),
      { lastModified, type: value.type },
    ),
  ];
};

/*
 * HTML §4.10.22.4, construct the entry list, belongs beside the
 * create-an-entry algorithm above.
 * It remains deferred until form association, successful controls, submitter
 * validation, and the formdata event exist.
 */
