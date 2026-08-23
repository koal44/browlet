import * as BrowletScenarios from './runner';
import { registerBrowletScenarios } from './registry';

registerBrowletScenarios(BrowletScenarios);
Error.stackTraceLimit = 100;
