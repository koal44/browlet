import * as DomletScenarios from './scenarios';
import { registerDomletScenarios } from './registry';

registerDomletScenarios(DomletScenarios);
Error.stackTraceLimit = 100;
