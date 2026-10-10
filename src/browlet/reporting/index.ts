// Shared Reporting implementations. The higher-level generate.ts entry also
// consumes policy report bodies, which depend on this barrel's base classes.
export { ReportingEndpoint } from './endpoint';
export {
  ReportingObserverImpl, type ReportingObserverOptions, type ReportingObserverCallback,
  reportingObserverIDL, reportingObserverCallbackIDL, reportingObserverOptionsIDL, reportListIDL,
} from './observer';
export { ReportImpl, ReportBodyImpl, reportIDL, reportBodyIDL } from './report';
export { TestReportBodyImpl, testReportBodyIDL } from './test-report';
