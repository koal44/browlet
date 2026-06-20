import { createSelectlet } from './selectlet/selectlet';
import { createStylelet } from './stylelet/stylelet';

const root = globalThis as typeof globalThis & {
  createStylelet?: typeof createStylelet;
};

root.createStylelet = createStylelet;

export default createSelectlet;
