import type { Definition } from '../web-idl/declaration/index';
import {
  byteLengthQueuingStrategyIDL,
} from './byte-length-queuing-strategy';
import { countQueuingStrategyIDL } from './count-queuing-strategy';
import {
  queuingStrategyIDL, queuingStrategyInitIDL, queuingStrategySizeIDL,
} from './queuing-strategy';

export const streamsIDLDefinitions: readonly Definition[] = [
  queuingStrategySizeIDL,
  queuingStrategyIDL,
  queuingStrategyInitIDL,
  byteLengthQueuingStrategyIDL,
  countQueuingStrategyIDL,
];
