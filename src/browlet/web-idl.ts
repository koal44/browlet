import type { Definition } from '../web-idl/declaration/index';
import { htmlDocumentIDL } from './dom/nodes/document';
import { htmlIDLDefinitions } from './html/web-idl';
import { mathMLIDLDefinitions } from './mathml/web-idl';
import { svgIDLDefinitions } from './svg/web-idl';
import { locationIDL } from './browsing/window/location';
import { originIDL } from './browsing/origin';
import {
  windowEventIDL, windowIDL,
} from './browsing/window/window';

export const browletIDLDefinitions: Definition[] = [
  htmlDocumentIDL,
  ...htmlIDLDefinitions,
  ...svgIDLDefinitions,
  ...mathMLIDLDefinitions,
  originIDL,
  locationIDL,
  windowIDL,
  windowEventIDL,
];
