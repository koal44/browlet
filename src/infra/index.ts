export {
  forgivingBase64Decode, forgivingBase64Encode,
} from './base64';
export {
  HTML_NAMESPACE, MATHML_NAMESPACE, SVG_NAMESPACE, XLINK_NAMESPACE,
  XML_NAMESPACE, XMLNS_NAMESPACE,
} from './namespaces';
export { toScalarValueString, type ScalarValueString } from './strings';
export { InternalError } from './internal-error';
export type { AsyncExecution, TaskCreationOptions, TaskHandle, TaskSourceKey } from './execution';
export { standardDOM, type DOMOperations, type DOMNode, type DOMCollection } from './dom-operations';
