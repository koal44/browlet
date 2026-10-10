import { obtainURLOrigin, stripURLForReporting } from '../../url/index';
import { getEnvironmentDefaultUserAgent, type IntegrityViolationReportBody } from '../../fetch/index';

import { ReportImpl, ReportBodyImpl } from './report';
import { TestReportBodyImpl } from './test-report';
import {
  IntegrityViolationReportBodyImpl, COEPViolationReportBodyImpl, type COEPViolationReportBody,
} from '../browsing/policy/index';
import type { BrowletEnvironment } from '../environment';

/** Create a report and its observer body, capturing the environment's current source and identification. */
// https://w3c.github.io/reporting/#queue-report
export function generateReport(data: unknown, type: string, destination: string, env: BrowletEnvironment): ReportImpl {
  // HTML's NavigatorID.userAgent uses this same environment-default algorithm.
  const report = new ReportImpl(
    data, type, destination, stripURLForReporting(env.creationURL),
    obtainURLOrigin(env.creationURL), getEnvironmentDefaultUserAgent(env),
  );
  if (data instanceof ReportBodyImpl) {
    report.body = data;
  } else if (data !== null) {
    switch (type) {
      case 'test':
        report.body = new TestReportBodyImpl((data as { message: string; }).message);
        break;
      case 'integrity-violation':
        report.body = new IntegrityViolationReportBodyImpl(data as IntegrityViolationReportBody);
        break;
      case 'coep':
        report.body = new COEPViolationReportBodyImpl(data as COEPViolationReportBody);
        break;
    }
  }
  return report;
}
