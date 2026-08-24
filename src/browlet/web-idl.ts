import type { Definition } from '../web-idl/declaration/index';
import { locationIDL } from './location';
import { originIDL } from './origin';
import { windowEventIDL, windowIDL } from './window';

export const browletIDLDefinitions: Definition[] = [
  originIDL,
  locationIDL,
  windowIDL,
  windowEventIDL,
];
