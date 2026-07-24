import * as JsdomScenarios from './scenarios';
import { registerJsdomScenarios } from './registry';

registerJsdomScenarios(JsdomScenarios);
Error.stackTraceLimit = 100;
