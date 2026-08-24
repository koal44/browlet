import type { Definition } from '../web-idl/adapter/definition';
import { locationIDL } from './location';
import { originIDL } from './origin';
import { windowEventIDL, windowIDL } from './window';

export const browletIDLDefinitions: Definition[] = [
  originIDL,
  locationIDL,
  windowIDL,
  windowEventIDL,
];
