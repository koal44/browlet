import type { Definition } from '../web-idl/index';
import type { FileEnvironment } from '../file/index';

import {
  formDataEntryValueIDL, formDataIDL,
} from './form-data';

export {
  formDataEntryValueIDL, formDataIDL, FormDataImpl,
  type FormDataEntry, type FormDataEntryValue,
} from './form-data';

export const xhrIDLDefinitions: Definition<FileEnvironment>[] = [
  formDataEntryValueIDL,
  formDataIDL,
];
