import {
  imageDataIDL, imageDataArrayIDL, imageDataPixelFormatIDL, imageDataSettingsIDL, predefinedColorSpaceIDL,
} from './image-data';
import { imageBitmapIDL } from './image-bitmap';

export const graphicsIDLDefinitions = [
  predefinedColorSpaceIDL, imageDataArrayIDL, imageDataPixelFormatIDL, imageDataSettingsIDL, imageDataIDL,
  imageBitmapIDL,
];
