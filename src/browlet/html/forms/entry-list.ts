import { FileImpl } from '../../../file/index';
import { toScalarValueString } from '../../../infra/index';
import type { CreateFormDataEntry } from '../../../xhr/form-data';

/**
 * HTML §4.10.22.4, create an entry.
 *
 * New Files retain the FormData owner's runtime; an unchanged File keeps its owner.
 */
export const createEntry: CreateFormDataEntry = (name, value, filename, runtime) => {
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
      runtime,
    ),
  ];
};

/*
 * HTML §4.10.22.4, construct the entry list, belongs beside the
 * create-an-entry algorithm above.
 * It remains deferred until form association, successful controls, submitter
 * validation, and the formdata event exist.
 */
