import { hasPlaygroundContent } from "../playground-contract";

type PlaygroundRuntime = typeof import("./playground");
let runtimePromise: Promise<PlaygroundRuntime> | null = null;

const initialize = async (force = false) => {
  if (!hasPlaygroundContent() && !runtimePromise) return;

  const currentPromise = runtimePromise ?? import(
    /* webpackChunkName: "playground-runtime" */ "./playground"
  );
  runtimePromise = currentPromise;

  try {
    const { initializeCodePlaygrounds } = await currentPromise;
    initializeCodePlaygrounds({ force });
  } catch (error) {
    if (runtimePromise === currentPromise) runtimePromise = null;
    console.error("[Moonlit Playground] 前台运行器加载失败", error);
  }
};

let refreshQueued = false;
let forceRefreshQueued = false;
const scheduleInitialize = (force = false) => {
  forceRefreshQueued ||= force;
  if (refreshQueued) return;
  refreshQueued = true;
  queueMicrotask(() => {
    refreshQueued = false;
    const shouldForce = forceRefreshQueued;
    forceRefreshQueued = false;
    void initialize(shouldForce);
  });
};

const start = () => {
  void initialize();

  const observer = new MutationObserver((records) => {
    const mayContainPlayground = records.some((record) =>
      record.type === "attributes" ||
      [...record.addedNodes, ...record.removedNodes].some(
        (node) => node instanceof HTMLElement && hasPlaygroundContent(node),
      )
    );
    if (mayContainPlayground) scheduleInitialize();
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-code-playground", "data-playground-version"],
    childList: true,
    subtree: true,
  });

  // Explicit hook for PJAX/Turbo/custom client-side themes. MutationObserver
  // is the default path; the event also lets a theme refresh after batched DOM
  // work without importing plugin internals.
  document.addEventListener("moonlit:playground:refresh", () => scheduleInitialize(true));
  window.addEventListener("pjax:complete", () => scheduleInitialize());
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
