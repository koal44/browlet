import type { Definition } from '../web-idl/index';
import {
  formDataEntryValueIDL, formDataIDL,
} from './form-data';

export {
  formDataEntryValueIDL, formDataIDL, FormDataImpl,
  type FormDataEntry, type FormDataEntryValue,
} from './form-data';

export const xhrIDLDefinitions: Definition[] = [
  formDataEntryValueIDL,
  formDataIDL,
];
