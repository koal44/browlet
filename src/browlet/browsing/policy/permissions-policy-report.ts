import { defineInterface, idlType, impl, nullable, op, roAttr, xattr } from '../../../web-idl/core/index';

import { ReportBodyImpl } from '../../reporting/index';
import type { BrowletEnvironment } from '../../environment/index';

import type { PolicyControlledFeature } from './permissions';

/** Queue an actual feature-use violation through its Document's environment. */
// https://w3c.github.io/webappsec-permissions-policy/#report-permissions-policy-violation
export function reportPermissionsPolicyViolation(
  feature: PolicyControlledFeature, env: BrowletEnvironment,
  disposition: 'enforce' | 'report', endpoint: string | null,
): void {
  // TODO(Permissions Policy): Capture the executing script's location when the engine exposes it.
  // §9.13 permits null coordinates when source-location extraction is unavailable.
  const body: PermissionsPolicyViolationReportBody = {
    featureId: feature.name, sourceFile: null, lineNumber: null, columnNumber: null, disposition,
  };
  // Reporting uses an empty destination for local-only reports; Structured Fields
  // endpoint names cannot be empty, so this cannot select a network endpoint.
  env.queueReport('permissions-policy-violation', endpoint ?? '', body);
}

/** Queue a potential violation using the embedding environment and the supplied iframe attribute text. */
// https://w3c.github.io/webappsec-permissions-policy/#report-potential-permissions-policy-violation
export function reportPotentialPermissionsPolicyViolation(
  feature: PolicyControlledFeature, env: BrowletEnvironment,
  disposition: 'enforce' | 'report', endpoint: string | null,
  allowAttribute: string | null, srcAttribute: string | null,
): void {
  // Source-location extraction remains the same optional dependency as for actual violations.
  const body: PermissionsPolicyViolationReportBody = {
    featureId: feature.name, sourceFile: null, lineNumber: null, columnNumber: null,
    disposition, allowAttribute, srcAttribute,
  };
  env.queueReport('potential-permissions-policy-violation', endpoint ?? '', body);
}

/** Observer-facing snapshot of an actual or potential Permissions Policy violation. */
// https://w3c.github.io/webappsec-permissions-policy/#reporting
export class PermissionsPolicyViolationReportBodyImpl extends ReportBodyImpl implements PermissionsPolicyViolationReportBody {
  /** Name of the feature whose policy was violated. */
  featureId: string;
  /** Producer-supplied script source URL, or null when unavailable. */
  sourceFile: string | null;
  /** Source line, or null when unavailable. */
  lineNumber: number | null;
  /** Source column, or null when unavailable. */
  columnNumber: number | null;
  /** Whether the violated policy was enforced or only monitored. */
  disposition: 'enforce' | 'report';
  /** Captured iframe allow attribute, or null when absent or inapplicable. */
  allowAttribute: string | null;
  /** Captured iframe src attribute, or null when absent or inapplicable. */
  srcAttribute: string | null;

  constructor(body: PermissionsPolicyViolationReportBody) {
    super();
    this.featureId = body.featureId;
    this.sourceFile = body.sourceFile;
    this.lineNumber = body.lineNumber;
    this.columnNumber = body.columnNumber;
    this.disposition = body.disposition;
    // Ordinary payloads omit iframe fields; their nullable IDL getters still expose null.
    this.allowAttribute = body.allowAttribute ?? null;
    this.srcAttribute = body.srcAttribute ?? null;
  }
}

/** JSON payload supplied by Permissions Policy's violation-report producers. */
export type PermissionsPolicyViolationReportBody = {
  featureId: string;
  sourceFile: string | null;
  lineNumber: number | null;
  columnNumber: number | null;
  disposition: 'enforce' | 'report';
  allowAttribute?: string | null;
  srcAttribute?: string | null;
};

// SPEC_CLASH(permissions-policy-report-interface): Follow §8's exposed Window interface,
// signed coordinates, and Default toJSON. Chromium restored hidden interfaces after a
// Report global-name collision; its custom serializer predates this spec's toJSON.
// SPEC_CLASH(permissions-policy-report-optional-fields): Default toJSON includes null IDL
// attributes; §8's omitted-field prose is preserved in the separate outbound payload.
/*
 * [Exposed=Window]
 * interface PermissionsPolicyViolationReportBody : ReportBody {
 *   [Default] object toJSON();
 *   readonly attribute DOMString featureId;
 *   readonly attribute DOMString? sourceFile;
 *   readonly attribute long? lineNumber;
 *   readonly attribute long? columnNumber;
 *   readonly attribute DOMString disposition;
 *   readonly attribute DOMString? allowAttribute;
 *   readonly attribute DOMString? srcAttribute;
 * };
 */
export const permissionsPolicyViolationReportBodyIDL = defineInterface({
  name: 'PermissionsPolicyViolationReportBody',
  inherits: 'ReportBody',
  exposed: 'Window',
  implementation: impl(PermissionsPolicyViolationReportBodyImpl),
  members: [
    op('toJSON', idlType.object, [], xattr('Default')),
    roAttr('featureId', idlType.DOMString),
    roAttr('sourceFile', nullable(idlType.DOMString)),
    roAttr('lineNumber', nullable(idlType.long)),
    roAttr('columnNumber', nullable(idlType.long)),
    roAttr('disposition', idlType.DOMString),
    roAttr('allowAttribute', nullable(idlType.DOMString)),
    roAttr('srcAttribute', nullable(idlType.DOMString)),
  ],
});
