import type { Definition } from '../web-idl/declaration/index';
import {
  formDataEntryValueIDL, formDataIDL,
} from './form-data';

export {
  createFormDataEntry, formDataEntryValueIDL, formDataIDL, FormDataImpl,
  type CreateFormDataEntry, type FormDataEntry, type FormDataEntryValue,
} from './form-data';

export const xhrIDLDefinitions: Definition[] = [
  formDataEntryValueIDL,
  formDataIDL,
];
