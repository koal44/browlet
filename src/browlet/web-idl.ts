import type { Definition } from '../web-idl/declaration/index';
import { originIDL } from '../url/origin-api';
import { htmlDocumentIDL } from './dom/nodes/document';
import { htmlIDLDefinitions } from './html/web-idl';
import { mathMLIDLDefinitions } from './mathml/web-idl';
import { svgIDLDefinitions } from './svg/web-idl';
import { locationIDL } from './browsing/window/location';
import {
  windowEventIDL, windowIDL, windowIncludesWindowOrWorkerGlobalScopeIDL,
} from './browsing/window/window';
import {
  highResolutionTimeWindowOrWorkerGlobalScopeIDL,
  timerHandlerIDL,
  windowOrWorkerGlobalScopeIDL,
} from './scripting/global-scope';
import {
  domHighResTimeStampIDL, epochTimeStampIDL, performanceIDL,
} from './performance/performance';
import {
  eventHandlerIDL, eventHandlerNonNullIDL,
} from './scripting/event-handlers';
import {
  structuredSerializeOptionsIDL,
} from './scripting/structured-data/web-idl';

export const browletIDLDefinitions: Definition[] = [
  htmlDocumentIDL,
  ...htmlIDLDefinitions,
  ...svgIDLDefinitions,
  ...mathMLIDLDefinitions,
  originIDL,
  locationIDL,
  domHighResTimeStampIDL,
  epochTimeStampIDL,
  performanceIDL,
  eventHandlerNonNullIDL,
  eventHandlerIDL,
  structuredSerializeOptionsIDL,
  timerHandlerIDL,
  windowOrWorkerGlobalScopeIDL,
  highResolutionTimeWindowOrWorkerGlobalScopeIDL,
  windowIDL,
  windowEventIDL,
  windowIncludesWindowOrWorkerGlobalScopeIDL,
];
