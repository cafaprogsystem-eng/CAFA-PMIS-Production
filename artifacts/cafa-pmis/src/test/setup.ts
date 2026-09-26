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
