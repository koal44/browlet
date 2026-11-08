import type { ModuleRequestPhase } from '../../js-engine/index';

import type { ModuleType } from './script';

/** ECMAScript's requested specifier, import attributes, and phase. */
// https://tc39.es/ecma262/#modulerequest-record
export class ModuleRequest {
  specifier: string;
  attributes: { key: string; value: string; }[];
  /** Whether the request needs source or evaluation; deferred loading remains unfinished. */
  phase: ModuleRequestPhase;

  constructor(
    specifier: string, attributes: { key: string; value: string; }[] = [], phase: ModuleRequestPhase = 'evaluation',
  ) {
    this.specifier = specifier;
    this.attributes = attributes;
    this.phase = phase;
  }

  /** Compare specifiers and attributes by value, independently of attribute order. */
  // https://tc39.es/ecma262/#sec-ModuleRequestsEqual
  equals(other: ModuleRequest): boolean {
    if (this.specifier !== other.specifier || this.phase !== other.phase ||
      this.attributes.length !== other.attributes.length) return false;
    return this.attributes.every((attribute) => other.attributes.some((candidate) =>
      attribute.key === candidate.key && attribute.value === candidate.value));
  }

  /** Select a supported module type, or null for an invalid type attribute. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#module-type-from-module-request
  // Recognize supported names here; the environment separately checks realm exposure.
  // SPEC_MISMATCH: module type from module request(moduleRequest) -> string or null
  getModuleType(): ModuleType | null {
    const type = this.attributes.find((attribute) => attribute.key === 'type');
    if (type === undefined) return 'javascript-or-wasm';
    if (type.value === 'css' || type.value === 'json' || type.value === 'text') return type.value;
    return null;
  }
}

/** Attribute names accepted by the HTML host, independently of their values. */
// https://html.spec.whatwg.org/multipage/webappapis.html#hostgetsupportedimportattributes
export function getSupportedImportAttributes(): string[] {
  return ['type'];
}
