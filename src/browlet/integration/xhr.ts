import { createFormDataEntry, formDataIDL } from '../../xhr/index';
import type { CapabilityRegistration } from '../../web-idl/capability';
import { createEntry } from '../html/forms/entry-list';

export const xhrCapabilities = [
  createFormDataEntry.for(formDataIDL, createEntry),
] satisfies CapabilityRegistration[];
