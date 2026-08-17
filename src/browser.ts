import { createSelectlet } from './selectlet/selectlet';
import { Stylelet } from './stylelet/stylelet';

const root = globalThis as typeof globalThis & {
  Stylelet?: typeof Stylelet;
};

root.Stylelet = Stylelet;

export default createSelectlet;
