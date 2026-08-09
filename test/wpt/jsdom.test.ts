import { runTest } from './jsdom-runner';
import { defineWptTests } from './suite';

defineWptTests('Stylelet with jsdom', runTest);
