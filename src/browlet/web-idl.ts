import type { Definition } from '../web-idl/declaration/index';
import { htmlDocumentIDL } from './dom/nodes/document';
import { browletElementIDLDefinitions } from './elements/web-idl';
import { locationIDL } from './window/location';
import { originIDL } from './origin';
import { windowEventIDL, windowIDL } from './window/window';

export const browletIDLDefinitions: Definition[] = [
  htmlDocumentIDL,
  ...browletElementIDLDefinitions,
  originIDL,
  locationIDL,
  windowIDL,
  windowEventIDL,
];
