import type { Definition } from '../web-idl/core/index';
import type { FileEnvironment } from '../file/index';

import {
  formDataEntryValueIDL, formDataIDL,
} from './form-data';

/** Implemented XMLHttpRequest-family declarations supplied to the host binding. */
export const xhrIDLDefinitions: Definition<FileEnvironment>[] = [
  formDataEntryValueIDL,
  formDataIDL,
];
