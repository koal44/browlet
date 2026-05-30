
export type SelectletShimWindow = {
  selectlet?: SelectletShimApi;
  document: Document;
};

type SelectletShimApi = {
  configure?: (...args: unknown[]) => unknown;
  select?: (
    selector: string,
    context?: QueryContext | null,
    callback?: ((el: Element) => unknown) | null
  ) => Element[];
  first?: (selector: string, context?: QueryContext | null) => Element | null;
  match?: (selector: string, element: Element) => boolean;
  snapshot?: SelectletShimSnapshot;
};

type SelectletShimConfig = {
  NODE_LIST: boolean;
  MUTATE_IDS: boolean;
};

type SelectletShimSnapshot = {
  config?: SelectletShimConfig;
  hasDocumentAll: boolean;
  hasTreeWalker: boolean;
};

type ComputedStyleWindow = {
  document: Document;
  getComputedStyle: typeof window.getComputedStyle;
};

export function installSelectletShim(win: SelectletShimWindow): void {
  const api = win.selectlet ??= {};

  api.snapshot ??= {
    config: {
      NODE_LIST: false,
      MUTATE_IDS: false,
    },
    hasDocumentAll: true,
    hasTreeWalker: true,
  };

  api.snapshot.config ??= {
    NODE_LIST: false,
    MUTATE_IDS: false,
  };

  api.configure ??= (opt) => {
    Object.assign(api.snapshot?.config ?? {}, opt);
  };

  api.select ??= (selector, context, callback) => {
    const root = context ?? win.document;
    const nodes = Array.from(root.querySelectorAll(selector));

    if (callback) {
      throw new Error(`selectlet.select with callback is not supported in jsdom harness`);
    }

    return nodes;
  };

  api.first ??= (selector, context) => {
    return (context ?? win.document).querySelector(selector);
  };

  api.match ??= (selector, element) => {
    return element.matches(selector);
  };
}

export function patchIframeSrcdoc(doc: Document): void {
  const win = doc.defaultView;
  if (!win) return;

  const proto = win.HTMLIFrameElement.prototype;

  const patched = proto as typeof proto & { __selectletSrcdocPatched?: boolean; };
  if (patched.__selectletSrcdocPatched) return;
  patched.__selectletSrcdocPatched = true;

  const desc = Object.getOwnPropertyDescriptor(proto, 'srcdoc');

  Object.defineProperty(proto, 'srcdoc', {
    configurable: true,
    enumerable: desc?.enumerable ?? true,

    get(this: HTMLIFrameElement) {
      if (desc?.get) return desc.get.call(this) as string;
      return this.getAttribute('srcdoc') ?? '';
    },

    set(this: HTMLIFrameElement, value: string) {
      if (desc?.set) desc.set.call(this, value);
      else this.setAttribute('srcdoc', value);

      hydrateIframeSrcdoc(this);

      win.setTimeout(() => {
        this.dispatchEvent(new win.Event('load'));
      }, 0);
    },
  });
}

export function hydrateIframeSrcdocs(doc: Document): void {
  for (const iframe of doc.querySelectorAll<HTMLIFrameElement>('iframe[srcdoc]')) {
    hydrateIframeSrcdoc(iframe);
  }
}

function hydrateIframeSrcdoc(iframe: HTMLIFrameElement): void {
  const srcdoc = iframe.getAttribute('srcdoc');
  if (srcdoc === null) return;

  const doc = iframe.contentDocument;
  if (!doc) return;

  doc.open();
  doc.write(normalizeIframeSrcdoc(srcdoc));
  doc.close();

  if (doc.defaultView) {
    installSelectletShim(doc.defaultView as SelectletShimWindow);
    patchIframeSrcdoc(doc);
    patchComputedStyleForWindow(doc.defaultView);
  }

  hydrateDeclarativeShadowRoots(doc);
  hydrateIframeSrcdocs(doc);
}

export function normalizeIframeSrcdoc(markup: string): string {
  return /<html[\s>]/i.test(markup)
    ? markup
    : `<!doctype html><html><head></head><body>${markup}</body></html>`;
}

export function hydrateDeclarativeShadowRoots(doc: Document): void {
  for (const tmpl of doc.querySelectorAll<HTMLTemplateElement>('template[shadowrootmode]')) {
    const host = tmpl.parentElement;
    if (!host) continue;

    const mode = tmpl.getAttribute('shadowrootmode');
    if (mode !== 'open' && mode !== 'closed') continue;

    const root = host.attachShadow({ mode });
    root.append(...tmpl.content.childNodes);
    tmpl.remove();
  }
}

export function patchComputedStyleForWindow(win: ComputedStyleWindow): void {
  // Avoid jsdom's stylesheet matcher here; it can route stylesheet selectors through the patched selector engine.
  win.getComputedStyle = ((elt: Element, pseudoElt?: string | null) => {
    if (!pseudoElt) {
      const props = findElementDeclarations(win.document, elt);

      return new Proxy({
        visibility: props.get('visibility') ?? 'visible',
        getPropertyValue(name: string) {
          const kebab = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
          return props.get(name) ?? props.get(kebab) ?? (
            kebab === 'visibility' ? 'visible' : ''
          );
        },
      }, {
        get(target, prop) {
          if (typeof prop !== 'string') return undefined;
          if (prop in target) return target[prop as keyof typeof target];

          const kebab = prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
          return props.get(prop) ?? props.get(kebab) ?? (
            kebab === 'visibility' ? 'visible' : ''
          );
        },
      });
    }

    const pseudo = pseudoElt.replace(/^::?/, '');
    if (
      pseudo !== 'before' &&
      pseudo !== 'after' &&
      pseudo !== 'first-letter' &&
      pseudo !== 'first-line'
    ) {
      return { content: 'none', getPropertyValue: () => '' };
    }

    const props = findPseudoDeclarations(win.document, elt, pseudo);

    return new Proxy({
      content: props.get('content') ?? 'none',
      getPropertyValue(name: string) {
        const kebab = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
        return props.get(name) ?? props.get(kebab) ?? '';
      },
    }, {
      get(target, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop in target) return target[prop as keyof typeof target];

        const kebab = prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
        return props.get(prop) ?? props.get(kebab) ?? '';
      },
    }) as CSSStyleDeclaration;
  }) as typeof win.getComputedStyle;
}

function findElementDeclarations(doc: Document, elt: Element): Map<string, string> {
  const props = new Map<string, string>();

  for (const style of doc.querySelectorAll('style')) {
    const css = style.textContent;

    for (const rule of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selector = rule[1].trim();

      let matched = false;
      try {
        matched = elt.matches(selector);
      } catch {
        continue;
      }

      if (!matched) continue;

      for (const decl of rule[2].split(';')) {
        const i = decl.indexOf(':');
        if (i < 0) continue;

        const name = decl.slice(0, i).trim().toLowerCase();
        const value = decl.slice(i + 1).trim();

        if (name) props.set(name, value);
      }
    }
  }

  return props;
}

function findPseudoDeclarations(doc: Document, elt: Element, pseudo: string): Map<string, string> {
  const props = new Map<string, string>();
  if (!elt.id) return props;

  const escapedId = elt.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `#${escapedId}\\s*:{1,2}${pseudo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
    'gi',
  );

  for (const style of doc.querySelectorAll('style')) {
    const css = style.textContent;

    for (let m = re.exec(css); m; m = re.exec(css)) {
      for (const decl of m[1].split(';')) {
        const i = decl.indexOf(':');
        if (i < 0) continue;

        const name = decl.slice(0, i).trim().toLowerCase();
        const value = decl.slice(i + 1).trim();

        if (name) props.set(name, value);
      }
    }
  }

  return props;
}
