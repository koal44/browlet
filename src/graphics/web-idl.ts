import {
  imageDataIDL, imageDataArrayIDL, imageDataPixelFormatIDL, imageDataSettingsIDL, predefinedColorSpaceIDL,
} from './image-data';
import {
  imageBitmapIDL, imageOrientationIDL, premultiplyAlphaIDL, colorSpaceConversionIDL, resizeQualityIDL, imageBitmapOptionsIDL,
} from './image-bitmap';

export const graphicsIDLDefinitions = [
  predefinedColorSpaceIDL, imageDataArrayIDL, imageDataPixelFormatIDL, imageDataSettingsIDL, imageDataIDL,
  imageBitmapIDL, imageOrientationIDL, premultiplyAlphaIDL, colorSpaceConversionIDL, resizeQualityIDL, imageBitmapOptionsIDL,
];
