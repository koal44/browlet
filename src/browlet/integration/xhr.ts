import { createFormDataEntry, formDataIDL } from '../../xhr/index';
import type { CapabilityRegistration } from '../../web-idl/index';
import { createEntry } from '../html/forms/entry-list';

export const xhrCapabilities = [
  createFormDataEntry.for(formDataIDL, createEntry),
] satisfies CapabilityRegistration[];
