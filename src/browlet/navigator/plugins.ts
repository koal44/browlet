import {
  arg, defineInterface, defineInterfaceMixin, idlType, impl, indexedGetter,
  nullable, op, reference, roAttr, xattr,
} from '../../web-idl/core/index';

import type { WindowEnvironment } from '../environment/index';

/** PDF capability reporting and the two legacy collections retained by a Window Navigator. */
// https://html.spec.whatwg.org/multipage/system-state.html#pdf-viewing-support
export class NavigatorPluginsMixin {
  /** Relevant settings of the including Window Navigator. */
  env: WindowEnvironment;
  /** SameObject collection identities survive navigation and frame removal. */
  // SPEC_CLASH(navigator-plugins-detached): Follow HTML/Chromium/WebKit; Firefox replaces these collections after frame removal.
  readonly plugins: PluginArrayImpl;
  readonly mimeTypes: MimeTypeArrayImpl;

  constructor(env: WindowEnvironment) {
    this.env = env;
    this.plugins = new PluginArrayImpl(env);
    this.mimeTypes = new MimeTypeArrayImpl(env);
  }

  // https://html.spec.whatwg.org/multipage/system-state.html#dom-navigator-pdfviewerenabled
  get pdfViewerEnabled(): boolean {
    // SPEC_CLASH(navigator-pdf-detached): Follow HTML/Firefox/WebKit's UserAgent flag; Chromium returns false after frame removal.
    return this.env.userAgent.pdfViewerSupported;
  }

  // https://html.spec.whatwg.org/multipage/system-state.html#dom-navigator-javaenabled
  javaEnabled(): boolean { return false; }
}

export const navigatorPluginsIDL = defineInterfaceMixin({
  name: 'NavigatorPlugins',
  members: [
    roAttr('plugins', reference('PluginArray'), xattr('SameObject')),
    roAttr('mimeTypes', reference('MimeTypeArray'), xattr('SameObject')),
    op('javaEnabled', idlType.boolean),
    roAttr('pdfViewerEnabled', idlType.boolean),
  ],
});

/** Legacy indexed and named view of this Window's PDF viewer aliases. */
// https://html.spec.whatwg.org/multipage/system-state.html#pluginarray
export class PluginArrayImpl {
  /** Relevant global owns every object returned by this collection. */
  env: WindowEnvironment;

  constructor(env: WindowEnvironment) {
    this.env = env;
  }

  // https://html.spec.whatwg.org/multipage/system-state.html#dom-pluginarray-length
  get length(): number { return this.env.window.pdfViewerPluginObjects.length; }

  // https://html.spec.whatwg.org/multipage/system-state.html#dom-pluginarray-refresh
  // SPEC_CLASH(navigator-plugins-refresh): Follow HTML's no-op; Chromium accepts an obsolete reload argument.
  refresh(): void { }

  // https://html.spec.whatwg.org/multipage/system-state.html#dom-pluginarray-item
  item(index: number): PluginImpl | null {
    return this.env.window.pdfViewerPluginObjects[index] ?? null;
  }

  // https://html.spec.whatwg.org/multipage/system-state.html#dom-pluginarray-nameditem
  namedItem(name: string): PluginImpl | null {
    return this.env.window.pdfViewerPluginObjects.find((plugin) => plugin.name === name) ?? null;
  }

  /** Supported indices for Web IDL's legacy indexed properties. */
  getSupportedPropertyIndices(): Iterable<number> {
    return this.env.window.pdfViewerPluginObjects.keys();
  }

  /** Exact compatibility aliases; Web IDL makes the corresponding named properties unenumerable. */
  getSupportedPropertyNames(): ReadonlySet<string> {
    return new Set(this.env.window.pdfViewerPluginObjects.map((plugin) => plugin.name));
  }
}

export const pluginArrayIDL = defineInterface({
  name: 'PluginArray', exposed: 'Window', ...xattr('LegacyUnenumerableNamedProperties'),
  implementation: impl(PluginArrayImpl),
  members: [
    op('refresh', idlType.undefined),
    roAttr('length', idlType.unsignedLong),
    op('item', nullable(reference('Plugin')),
      [arg('index', idlType.unsignedLong)],
      indexedGetter((plugins: PluginArrayImpl) => plugins.getSupportedPropertyIndices(), { unsupportedValue: null }),
    ),
    { kind: 'named-getter', name: 'namedItem', method: 'namedItem', returns: nullable(reference('Plugin')) },
  ],
});

/** Legacy indexed and named view of the Window's two PDF MIME types. */
// https://html.spec.whatwg.org/multipage/system-state.html#mimetypearray
export class MimeTypeArrayImpl {
  /** Relevant global supplies the shared MIME objects. */
  env: WindowEnvironment;

  constructor(env: WindowEnvironment) {
    this.env = env;
  }

  // https://html.spec.whatwg.org/multipage/system-state.html#dom-mimetypearray-length
  get length(): number { return this.env.window.pdfViewerMimeTypeObjects.length; }

  // https://html.spec.whatwg.org/multipage/system-state.html#dom-mimetypearray-item
  item(index: number): MimeTypeImpl | null {
    return this.env.window.pdfViewerMimeTypeObjects[index] ?? null;
  }

  // https://html.spec.whatwg.org/multipage/system-state.html#dom-mimetypearray-nameditem
  namedItem(name: string): MimeTypeImpl | null {
    return this.env.window.pdfViewerMimeTypeObjects.find((mimeType) => mimeType.type === name) ?? null;
  }

  /** Supported indices for Web IDL's legacy indexed properties. */
  getSupportedPropertyIndices(): Iterable<number> {
    return this.env.window.pdfViewerMimeTypeObjects.keys();
  }

  /** Exact MIME names, without normalization or aliases. */
  getSupportedPropertyNames(): ReadonlySet<string> {
    return new Set(this.env.window.pdfViewerMimeTypeObjects.map((mimeType) => mimeType.type));
  }
}

export const mimeTypeArrayIDL = defineInterface({
  name: 'MimeTypeArray', exposed: 'Window', ...xattr('LegacyUnenumerableNamedProperties'),
  implementation: impl(MimeTypeArrayImpl),
  members: [
    roAttr('length', idlType.unsignedLong),
    op('item', nullable(reference('MimeType')),
      [arg('index', idlType.unsignedLong)],
      indexedGetter((types: MimeTypeArrayImpl) => types.getSupportedPropertyIndices(), { unsupportedValue: null }),
    ),
    { kind: 'named-getter', name: 'namedItem', method: 'namedItem', returns: nullable(reference('MimeType')) },
  ],
});

/** One of HTML's five compatibility aliases, all exposing the same Window-owned MIME objects. */
// https://html.spec.whatwg.org/multipage/system-state.html#dom-plugin
export class PluginImpl {
  /** Compatibility name assigned when this Window creates its plugin objects. */
  name: string;
  /** Relevant global supplies the shared MIME objects. */
  env: WindowEnvironment;

  constructor(name: string, env: WindowEnvironment) {
    this.name = name;
    this.env = env;
  }

  // https://html.spec.whatwg.org/multipage/system-state.html#dom-plugin-description
  get description(): string { return 'Portable Document Format'; }

  // https://html.spec.whatwg.org/multipage/system-state.html#dom-plugin-filename
  get filename(): string { return 'internal-pdf-viewer'; }

  // https://html.spec.whatwg.org/multipage/system-state.html#dom-plugin-length
  get length(): number { return this.env.window.pdfViewerMimeTypeObjects.length; }

  // https://html.spec.whatwg.org/multipage/system-state.html#dom-plugin-item
  item(index: number): MimeTypeImpl | null {
    // SPEC_CLASH(navigator-pdf-mime-identity): Follow HTML/Firefox's shared Window list; Chromium/WebKit use per-plugin objects.
    return this.env.window.pdfViewerMimeTypeObjects[index] ?? null;
  }

  // https://html.spec.whatwg.org/multipage/system-state.html#dom-plugin-nameditem
  namedItem(name: string): MimeTypeImpl | null {
    return this.env.window.pdfViewerMimeTypeObjects.find((mimeType) => mimeType.type === name) ?? null;
  }

  /** Supported indices for Web IDL's legacy indexed properties. */
  getSupportedPropertyIndices(): Iterable<number> {
    return this.env.window.pdfViewerMimeTypeObjects.keys();
  }

  /** Exact MIME names, shared by every PDF alias. */
  getSupportedPropertyNames(): ReadonlySet<string> {
    return new Set(this.env.window.pdfViewerMimeTypeObjects.map((mimeType) => mimeType.type));
  }
}

export const pluginIDL = defineInterface({
  name: 'Plugin', exposed: 'Window', ...xattr('LegacyUnenumerableNamedProperties'),
  implementation: impl(PluginImpl),
  members: [
    roAttr('name', idlType.DOMString), roAttr('description', idlType.DOMString), roAttr('filename', idlType.DOMString),
    roAttr('length', idlType.unsignedLong),
    op('item', nullable(reference('MimeType')),
      [arg('index', idlType.unsignedLong)],
      indexedGetter((plugin: PluginImpl) => plugin.getSupportedPropertyIndices(), { unsupportedValue: null }),
    ),
    { kind: 'named-getter', name: 'namedItem', method: 'namedItem', returns: nullable(reference('MimeType')) },
  ],
});

/** A PDF MIME name paired with the generic viewer in the same Window. */
// https://html.spec.whatwg.org/multipage/system-state.html#mimetype
export class MimeTypeImpl {
  /** MIME name assigned when the Window creates its MIME objects. */
  type: string;
  /** Relevant global supplies this MIME object's generic plugin. */
  env: WindowEnvironment;

  constructor(type: string, env: WindowEnvironment) {
    this.type = type;
    this.env = env;
  }

  // https://html.spec.whatwg.org/multipage/system-state.html#dom-mimetype-description
  get description(): string { return 'Portable Document Format'; }

  // https://html.spec.whatwg.org/multipage/system-state.html#dom-mimetype-suffixes
  get suffixes(): string { return 'pdf'; }

  // https://html.spec.whatwg.org/multipage/system-state.html#dom-mimetype-enabledplugin
  get enabledPlugin(): PluginImpl { return this.env.window.pdfViewerPluginObjects[0]!; }
}

export const mimeTypeIDL = defineInterface({
  name: 'MimeType', exposed: 'Window', implementation: impl(MimeTypeImpl),
  members: [
    roAttr('type', idlType.DOMString), roAttr('description', idlType.DOMString), roAttr('suffixes', idlType.DOMString),
    roAttr('enabledPlugin', reference('Plugin')),
  ],
});

// https://html.spec.whatwg.org/multipage/system-state.html#pdf-viewer-plugin-names
export const pdfViewerPluginNames = [
  'PDF Viewer', 'Chrome PDF Viewer', 'Chromium PDF Viewer', 'Microsoft Edge PDF Viewer', 'WebKit built-in PDF',
] as const;

// https://html.spec.whatwg.org/multipage/system-state.html#pdf-viewer-mime-types
export const pdfViewerMimeTypes = ['application/pdf', 'text/pdf'] as const;
