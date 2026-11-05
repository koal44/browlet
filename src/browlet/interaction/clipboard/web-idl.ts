import { clipboardPermissionDescriptorIDL } from './permission';
import { clipboardEventIDL, clipboardEventInitIDL } from './event';
import { clipboardChangeEventIDL, clipboardChangeEventInitIDL } from './change-event';
import { clipboardIDL, clipboardItemsIDL, clipboardUnsanitizedFormatsIDL } from './clipboard';
import { clipboardItemDataIDL, clipboardItemOptionsIDL, clipboardItemIDL, presentationStyleIDL } from './item';

export const clipboardIDLDefinitions = [
  clipboardPermissionDescriptorIDL,
  clipboardEventInitIDL, clipboardEventIDL,
  clipboardChangeEventInitIDL, clipboardChangeEventIDL,
  clipboardItemDataIDL, presentationStyleIDL, clipboardItemOptionsIDL, clipboardItemIDL,
  clipboardItemsIDL, clipboardUnsanitizedFormatsIDL, clipboardIDL,
];
