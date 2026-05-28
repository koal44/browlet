import { isHTMLElement, isIFrame } from '../../utils/util';
import type { SelectletShimWindow } from './patches';
import {
  hydrateDeclarativeShadowRoots, hydrateIframeSrcdocs, installSelectletShim, normalizeIframeSrcdoc, patchComputedStyleForWindow, patchIframeSrcdoc,
} from './patches';
import type { JsdomInst } from './scenarios';

type JsdomPage = {
  evaluate<T>(fn: () => T | Promise<T>): Promise<Awaited<T>>;
  evaluate<T, A>(fn: (arg: A) => T | Promise<T>, arg: A): Promise<Awaited<T>>;
  locator(selector: string): JsdomLocator;
  goto(url: string): Promise<void>;
  mouse: {
    move(x: number, y: number): Promise<void>;
    down(): Promise<void>;
    up(): Promise<void>;
  };
  route(pattern: string, handler: JsdomRouteHandler): Promise<void>;
  frame(id: string): JsdomFrame | null;
};

type JsdomLocator = {
  focus(): Promise<void>;
  hover(): Promise<void>;
  evaluate<T>(fn: (el: Element) => T | Promise<T>): Promise<Awaited<T>>;
  evaluate<T, A>(fn: (arg: A) => T | Promise<T>, arg: A): Promise<Awaited<T>>;
};

type JsdomFrame = {
  waitForURL(url: string): Promise<void>;
  evaluate<T>(fn: () => T | Promise<T>): Promise<Awaited<T>>;
  locator(selector: string): {
    count(): number;
  };
  content(): string;
};

type JsdomRouteHandler = (route: JsdomRoute) => void;


type JsdomRouteFulfillOptions = {
  status?: number;
  contentType?: string;
  body?: string;
};

type JsdomRoute = {
  request(): { url(): string; };
  fulfill(options: JsdomRouteFulfillOptions): void;
};

type JsdomRouteRegistration = {
  pattern: string;
  handler: JsdomRouteHandler;
};

let nextEvalArgId = 1;

export function createJsdomPage(dom: JsdomInst): JsdomPage {
  const routes: JsdomRouteRegistration[] = [];
  let hovered: Element | null = null;
  let active: Element | null = null;

  patchIframeSrcNavigation(dom.window.document, routes);

  return {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    async evaluate(fn: Function, arg?: unknown) {
      const win = dom.window;

      return await withWindowSlot(win, arg, (argKey) => {
        return win.eval(`(${fn.toString()})(window.${argKey})`);
      });
    },

    locator(selector: string) {
      return {
        focus() {
          const el = dom.window.document.querySelector(selector);
          if (!isHTMLElement(el)) {
            throw new Error(`locator(${selector}).focus(): element not found or not HTMLElement`);
          }
          el.focus();
          return Promise.resolve();
        },

        hover() {
          const el = dom.window.document.querySelector(selector);
          if (!el) {
            throw new Error(`locator(${selector}).hover(): element not found`);
          }

          if (hovered && hovered !== el) {
            fireHoverOut(hovered);
          }

          fireHoverIn(el);
          hovered = el;
          return Promise.resolve();
        },

        // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
        async evaluate(fn: Function, arg?: unknown) {
          const win = dom.window;
          const el = dom.window.document.querySelector(selector);

          if (!el) {
            throw new Error(`locator(${selector}).evaluate(): element not found`);
          }

          return await withWindowSlot(win, el, (elKey) => {
            return withWindowSlot(win, arg, (argKey) => {
              return win.eval(`(${fn.toString()})(window.${elKey}, window.${argKey})`);
            });
          });
        },
      };
    },

    goto(url: string) {
      dom.reconfigure({ url });
      return Promise.resolve();
    },

    mouse: {
      move() {
        if (active) {
          fireRelease(active);
          active = null;
        }

        if (hovered) {
          fireHoverOut(hovered);
          hovered = null;
        }

        return Promise.resolve();
      },

      down() {
        if (hovered) {
          active = hovered;
          firePress(active);
        }

        return Promise.resolve();
      },

      up() {
        if (active) {
          fireRelease(active);
          active = null;
        }

        return Promise.resolve();
      },
    },

    route(pattern: string, handler: JsdomRouteHandler) {
      routes.push({ pattern, handler });
      return Promise.resolve();
    },

    frame(id: string) {
      const iframe = dom.window.document.getElementById(id);
      if (!isIFrame(iframe)) return null;

      return createJsdomFrame(iframe);
    },
  };

  function mouseEvent(type: string, bubbles = true, buttons = 0) {
    return new dom.window.MouseEvent(type, {
      bubbles,
      button: 0,
      buttons,
    });
  }

  function firePress(el: Element) {
    el.dispatchEvent(mouseEvent('pointerdown', true, 1));
    el.dispatchEvent(mouseEvent('mousedown', true, 1));
  }

  function fireRelease(el: Element) {
    el.dispatchEvent(mouseEvent('pointerup', true, 0));
    el.dispatchEvent(mouseEvent('mouseup', true, 0));
  }

  function fireHoverIn(el: Element) {
    el.dispatchEvent(mouseEvent('pointerover'));
    el.dispatchEvent(mouseEvent('mouseover'));
    el.dispatchEvent(mouseEvent('pointerenter', false));
    el.dispatchEvent(mouseEvent('mouseenter', false));
  }

  function fireHoverOut(el: Element) {
    el.dispatchEvent(mouseEvent('pointerout'));
    el.dispatchEvent(mouseEvent('mouseout'));
    el.dispatchEvent(mouseEvent('pointerleave', false));
    el.dispatchEvent(mouseEvent('mouseleave', false));
  }
}

async function withWindowSlot<T>(
  win: JsdomInst['window'],
  value: unknown,
  fn: (key: string) => T | Promise<T>,
): Promise<Awaited<T>> {
  const key = `__selectletEvalArg${nextEvalArgId++}`;
  win[key] = value;
  try { return await fn(key); }
  finally { delete win[key]; }
}

function createJsdomFrame(iframe: HTMLIFrameElement): JsdomFrame {
  return {
    waitForURL(url: string) {
      if (iframe.src === url || iframe.getAttribute('src') === url) {
        return Promise.resolve();
      }

      return new Promise<void>((resolve) => {
        iframe.addEventListener('load', () => {
          if (iframe.src === url || iframe.getAttribute('src') === url) {
            resolve();
          }
        }, { once: true });
      });
    },

    evaluate<T>(fn: () => T | Promise<T>): Promise<Awaited<T>> {
      const win = iframe.contentWindow as JsdomInst['window'] | null;
      if (!win) {
        throw new Error(`frame(${iframe.id}).evaluate(): contentWindow is null`);
      }

      return Promise.resolve(
        win.eval(`(${fn.toString()})()`),
      ) as Promise<Awaited<T>>;
    },

    locator(selector: string) {
      return {
        count() {
          const doc = iframe.contentDocument;
          if (!doc) throw new Error(`frame(${iframe.id}).locator(${selector}).count(): contentDocument is null`);
          return doc.querySelectorAll(selector).length;
        },
      };
    },

    content() {
      const doc = iframe.contentDocument;
      if (!doc) throw new Error(`frame(${iframe.id}).content(): contentDocument is null`);
      return doc.documentElement.outerHTML;
    },
  };
}

function patchIframeSrcNavigation(doc: Document, routes: JsdomRouteRegistration[]): void {
  const win = doc.defaultView;
  if (!win) return;

  const proto = win.HTMLIFrameElement.prototype;

  const patched = proto as typeof proto & { __selectletSrcPatched?: boolean; };
  if (patched.__selectletSrcPatched) return;
  patched.__selectletSrcPatched = true;

  const desc = Object.getOwnPropertyDescriptor(proto, 'src');

  Object.defineProperty(proto, 'src', {
    configurable: true,
    enumerable: desc?.enumerable ?? true,

    get(this: HTMLIFrameElement) {
      if (desc?.get) return desc.get.call(this) as string;
      return this.getAttribute('src') ?? '';
    },

    set(this: HTMLIFrameElement, value: string) {
      if (desc?.set) desc.set.call(this, value);
      else this.setAttribute('src', value);

      loadIframeFromRoute(this, value, routes);
    },
  });
}

function loadIframeFromRoute(
  iframe: HTMLIFrameElement,
  url: string,
  routes: JsdomRouteRegistration[],
): void {
  const win = iframe.ownerDocument.defaultView;
  if (!win) return;

  const match = routes.find((r) => routeMatches(r.pattern, url));
  if (!match) return;

  const state: { fulfilled?: JsdomRouteFulfillOptions; } = {};

  const route: JsdomRoute = {
    request: () => ({ url: () => url }),
    fulfill: (options) => {
      state.fulfilled = options;
    },
  };

  match.handler(route);

  const fulfilled = state.fulfilled;
  if (!fulfilled) {
    throw new Error(`route for ${url} did not fulfill`);
  }

  writeIframeDocument(iframe, fulfilled.body ?? '', routes);

  win.setTimeout(() => {
    iframe.dispatchEvent(new win.Event('load'));
  }, 0);
}

function routeMatches(pattern: string, url: string): boolean {
  if (pattern.endsWith('/**')) {
    return url.startsWith(pattern.slice(0, -3));
  }

  if (pattern.endsWith('**')) {
    return url.startsWith(pattern.slice(0, -2));
  }

  return pattern === url;
}

function writeIframeDocument(iframe: HTMLIFrameElement, markup: string, routes: JsdomRouteRegistration[]): void {
  const doc = iframe.contentDocument;
  if (!doc) throw new Error(`iframe.contentDocument is null`);

  doc.open();
  doc.write(normalizeIframeSrcdoc(markup));
  doc.close();

  if (doc.defaultView) {
    installSelectletShim(doc.defaultView as SelectletShimWindow);
    patchIframeSrcdoc(doc);
    patchIframeSrcNavigation(doc, routes);
    patchComputedStyleForWindow(doc.defaultView);
  }

  hydrateDeclarativeShadowRoots(doc);
  hydrateIframeSrcdocs(doc);
}
