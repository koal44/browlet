import { domHighResTimeStampIDL, epochTimeStampIDL } from '../../../timing/index';
import { streamsIDLDefinitions } from '../../../streams/index';
import { encodingIDLDefinitions } from '../../../encoding/index';
import { urlIDLDefinitions } from '../../../url/index';
import { permissionsIDLDefinitions } from '../../../permissions/index';
import { storageIDLDefinitions } from '../../../storage/index';
import { fileIDLDefinitions } from '../../../file/index';
import { xhrIDLDefinitions } from '../../../xhr/index';
import { fetchIDLDefinitions } from '../../../fetch/index';
import { styleletIDLDefinitions } from '../../../stylelet/index';

import { wasmIDLDefinitions } from '../../webassembly/index';
import {
  errorEventIDL, errorEventInitIDL, promiseRejectionEventIDL, promiseRejectionEventInitIDL,
} from '../../dom/events/index';
import {
  eventHandlerIDL, eventHandlerNonNullIDL, onErrorEventHandlerIDL, onErrorEventHandlerNonNullIDL,
  onBeforeUnloadEventHandlerIDL, onBeforeUnloadEventHandlerNonNullIDL,
  globalEventHandlersIDL, windowEventHandlersIDL,
} from '../../scripting/index';
import {
  reportIDL, reportBodyIDL, testReportBodyIDL, reportingObserverIDL, reportingObserverCallbackIDL,
  reportingObserverOptionsIDL, reportListIDL,
} from '../../reporting/index';
import { dataTransferIDLDefinitions } from '../../interaction/drag-drop/index';
import { navigationEventIDLDefinitions } from '../../browsing/navigation/events/index';
import { interactionEventIDLDefinitions } from '../../interaction/events/index';
import { clipboardIDLDefinitions } from '../../interaction/clipboard/index';
import {
  integrityViolationReportBodyIDL, coepViolationReportBodyIDL, coepInheritanceViolationReportBodyIDL,
  permissionsPolicyIDL, documentPermissionsPolicyIDL, iframePermissionsPolicyIDL,
  permissionsPolicyViolationReportBodyIDL,
} from '../../browsing/policy/index';
import {
  cspViolationReportBodyIDL, securityPolicyViolationEventIDL, securityPolicyViolationEventInitIDL,
  securityPolicyViolationEventDispositionIDL,
} from '../../browsing/policy/csp/index';
import { trustedTypesIDLDefinitions } from '../../browsing/policy/trusted-types/index';
import { selectionIDLDefinitions } from '../../interaction/selection/index';
import { historyIDL, scrollRestorationIDL } from '../../browsing/history/index';
import { notRestoredReasonDetailsIDL, notRestoredReasonsIDL } from '../../browsing/navigation/diagnostics/index';
import {
  htmlDocumentIDL, documentReadyStateIDL, documentVisibilityStateIDL, htmlOrSVGScriptElementIDL,
  htmlDocumentOrShadowRootIDL, htmlAllCollectionIDL, documentIncludesGlobalEventHandlersIDL,
} from '../../dom/nodes/index';
import { htmlIDLDefinitions } from '../../dom/nodes/html/index';
import { mathMLIDLDefinitions } from '../../dom/nodes/mathml/index';
import { svgIDLDefinitions } from '../../dom/nodes/svg/index';
import { domIDLDefinitions } from '../../dom/index';
import { performanceIDLDefinitions } from '../../performance/index';
import { navigatorIDLDefinitions } from '../../navigator/index';
import {
  messageEventIDL, messageEventInitIDL, messageEventSourceIDL, messagePortIDL, eventSourceIDL, eventSourceInitIDL,
  messageChannelIDL, messageEventTargetIDL, messagePortIncludesMessageEventTargetIDL, windowPostMessageOptionsIDL,
  broadcastChannelIDL,
} from '../../communication/index';
import { webStorageIDLDefinitions } from '../../storage/index';
import { navigationIDLDefinitions } from '../../browsing/navigation/api/index';
import {
  locationIDL, barPropIDL, windowEventIDL, windowIDL, windowIncludesWindowOrWorkerGlobalScopeIDL,
  windowIncludesGlobalEventHandlersIDL, windowIncludesWindowEventHandlersIDL, windowProxyDefinition,
  windowIdleCallbackIDL, idleDeadlineIDL, idleRequestCallbackIDL, idleRequestOptionsIDL,
} from '../../browsing/window/index';
import { originIDL } from '../../browsing/index';
import {
  highResolutionTimeWindowOrWorkerGlobalScopeIDL, timerHandlerIDL, windowOrWorkerGlobalScopeIDL,
  trustedTypesWindowOrWorkerGlobalScopeIDL,
} from '../../environment/index';
import { structuredSerializeOptionsIDL } from '../../scripting/structured-data/index';
import { workerIDLDefinitions } from '../../workers/index';
import { elementPointerCaptureIDL, navigatorPointerEventsIDL, pointerLockIDLDefinitions } from '../../interaction/index';
import { renderingIDLDefinitions } from '../../rendering/index';
import { progressEventIDL, progressEventInitIDL } from '../xhr/index';
import { permissionStatusIDL } from '../permissions/index';
import { fileReaderIDL, objectURLIDL } from '../file/index';

/** Declarations combined by Browlet's binding world, also available for development validation. */
export const browletDefinitions = [
  documentReadyStateIDL,
  documentVisibilityStateIDL,
  htmlOrSVGScriptElementIDL,
  htmlDocumentIDL,
  documentIncludesGlobalEventHandlersIDL,
  htmlDocumentOrShadowRootIDL,
  htmlAllCollectionIDL,
  ...htmlIDLDefinitions,
  ...svgIDLDefinitions,
  ...mathMLIDLDefinitions,
  originIDL,
  locationIDL,
  historyIDL, scrollRestorationIDL,
  ...navigationIDLDefinitions,
  ...navigationEventIDLDefinitions,
  ...interactionEventIDLDefinitions,
  ...pointerLockIDLDefinitions,
  ...selectionIDLDefinitions,
  ...dataTransferIDLDefinitions,
  ...clipboardIDLDefinitions,
  notRestoredReasonDetailsIDL, notRestoredReasonsIDL,
  ...renderingIDLDefinitions,
  barPropIDL,
  reportIDL, reportBodyIDL, integrityViolationReportBodyIDL, testReportBodyIDL,
  coepViolationReportBodyIDL, coepInheritanceViolationReportBodyIDL,
  permissionsPolicyIDL, documentPermissionsPolicyIDL, iframePermissionsPolicyIDL,
  permissionsPolicyViolationReportBodyIDL,
  cspViolationReportBodyIDL,
  securityPolicyViolationEventIDL, securityPolicyViolationEventInitIDL, securityPolicyViolationEventDispositionIDL,
  reportingObserverIDL, reportingObserverCallbackIDL, reportingObserverOptionsIDL, reportListIDL,
  domHighResTimeStampIDL,
  epochTimeStampIDL,
  ...performanceIDLDefinitions,
  ...navigatorIDLDefinitions,
  navigatorPointerEventsIDL,
  eventHandlerNonNullIDL,
  eventHandlerIDL,
  onErrorEventHandlerNonNullIDL,
  onErrorEventHandlerIDL,
  onBeforeUnloadEventHandlerNonNullIDL,
  onBeforeUnloadEventHandlerIDL,
  globalEventHandlersIDL,
  windowEventHandlersIDL,
  errorEventIDL,
  errorEventInitIDL,
  messageEventIDL,
  messageEventInitIDL,
  messageEventSourceIDL,
  messagePortIDL,
  messageChannelIDL,
  messageEventTargetIDL,
  messagePortIncludesMessageEventTargetIDL,
  broadcastChannelIDL,
  eventSourceIDL,
  eventSourceInitIDL,
  windowPostMessageOptionsIDL,
  ...workerIDLDefinitions,
  promiseRejectionEventIDL,
  promiseRejectionEventInitIDL,
  structuredSerializeOptionsIDL,
  timerHandlerIDL,
  windowOrWorkerGlobalScopeIDL,
  highResolutionTimeWindowOrWorkerGlobalScopeIDL,
  trustedTypesWindowOrWorkerGlobalScopeIDL,
  windowIDL,
  windowProxyDefinition,
  windowEventIDL,
  windowIdleCallbackIDL, idleDeadlineIDL, idleRequestCallbackIDL, idleRequestOptionsIDL,
  windowIncludesWindowOrWorkerGlobalScopeIDL,
  windowIncludesGlobalEventHandlersIDL,
  windowIncludesWindowEventHandlersIDL,
  ...domIDLDefinitions,
  elementPointerCaptureIDL,
  ...styleletIDLDefinitions,
  ...streamsIDLDefinitions,
  ...encodingIDLDefinitions,
  ...fileIDLDefinitions,
  ...permissionsIDLDefinitions,
  permissionStatusIDL,
  ...storageIDLDefinitions,
  ...webStorageIDLDefinitions,
  ...wasmIDLDefinitions,
  fileReaderIDL,
  objectURLIDL,
  ...xhrIDLDefinitions,
  progressEventIDL,
  progressEventInitIDL,
  ...urlIDLDefinitions,
  ...fetchIDLDefinitions,
  ...trustedTypesIDLDefinitions,
];
