# Browlet assets

## Artwork

- [browlet.svg](browlet.svg): editable master, with named Inkscape layers and
  a transparent background.
- [browlet.png](browlet.png): transparent 1024 × 1024 PNG for uploads and
  applications that need a raster image.
- [browlet-preview.png](browlet-preview.png): the selected mark on dark and
  white backgrounds at 256, 160, 96, 64, 32, and 16 pixels.

The SVG is the source of truth. It contains the final geometry and colors;
no tracing script or reference image is required. Make future artwork edits
in the SVG, then refresh the PNG and comparison. To export another size in
Inkscape, select the page as the export area and keep the background transparent.

For the repository's root README:

```html
<img src="assets/browlet.svg" width="160" alt="Browlet owl">
```

GitHub serves this relative image path from the same branch as the README.
The PNG can also be uploaded separately wherever an attachment is useful.

## WPT progress

The README's WPT image is generated and published by CI through GitHub Pages.
The [WPT runner and generator](../wpt/README.md#progress-graphic) also retain the
underlying results. Progress graphics are generated output, not artwork stored
in this directory.
