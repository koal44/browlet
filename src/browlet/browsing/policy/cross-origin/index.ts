export {
  EmbedderPolicy, type EmbedderPolicyValue, COEPViolationReportBodyImpl, type COEPViolationReportBody,
  coepViolationReportBodyIDL, queueCOEPInheritanceViolation,
  COEPInheritanceViolationReportBodyImpl, type COEPInheritanceViolationReportBody, coepInheritanceViolationReportBodyIDL,
} from './coep';
export { OpenerPolicy, sanitizeURLForReport, type OpenerPolicyValue, type OpenerPolicyAccessReportParams } from './coop';
