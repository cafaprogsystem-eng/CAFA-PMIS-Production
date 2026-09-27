import "@testing-library/jest-dom";

// jsdom has no ResizeObserver; HeroUI/React Aria components (e.g. the Tabs
// selection indicator) observe their own size. Tests that need to assert on
// resize behaviour still install their own stub over this one.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom has no Web Animations API; React Aria waits on element.getAnimations()
// before unmounting exiting content (tab panels, popovers). No animations run
// in jsdom, so an empty list lets exits complete immediately.
if (typeof Element !== "undefined" && typeof Element.prototype.getAnimations !== "function") {
  Element.prototype.getAnimations = () => [];
}

// jsdom has no matchMedia; useIsMobile (which picks the HeroUI Pro KPIGroup
// orientation) reads it. Report a desktop-width, no-preference environment;
// tests that need a specific media query still install their own stub.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList;
}
