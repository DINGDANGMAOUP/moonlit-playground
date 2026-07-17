// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ObserverCallback = IntersectionObserverCallback;

class TestIntersectionObserver implements IntersectionObserver {
  static latest: TestIntersectionObserver | null = null;

  readonly root = null;
  readonly rootMargin = "240px 0px";
  readonly thresholds = [0.01];
  readonly observed = new Set<Element>();

  constructor(private readonly callback: ObserverCallback) {
    TestIntersectionObserver.latest = this;
  }

  disconnect() {
    this.observed.clear();
  }

  observe(target: Element) {
    this.observed.add(target);
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  unobserve(target: Element) {
    this.observed.delete(target);
  }

  intersect(target: Element) {
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this,
    );
  }
}

describe("Playground frontend lifecycle", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-color-scheme");
    TestIntersectionObserver.latest = null;
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
  });

  afterEach(() => {
    window.dispatchEvent(new Event("pagehide"));
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-color-scheme");
  });

  it("defers construction and safely revalidates detached or future roots", async () => {
    const { initializeCodePlaygrounds } = await import("./playground");
    const root = document.createElement("div");
    root.dataset.codePlayground = "";
    root.dataset.playgroundVersion = "1";
    root.dataset.playgroundRun = "manual";
    root.innerHTML =
      '<pre data-playground-file="/index.js"><code>console.log(1)</code></pre>';
    document.body.append(root);

    initializeCodePlaygrounds();
    const observer = TestIntersectionObserver.latest!;
    expect(root.dataset.playgroundEnhancementState).toBe("pending");
    expect(root.classList.contains("is-enhanced")).toBe(false);
    expect(observer.observed.has(root)).toBe(true);

    root.dataset.playgroundVersion = "2";
    observer.intersect(root);
    expect(root.dataset.playgroundEnhancementState).toBeUndefined();
    expect(root.classList.contains("is-enhanced")).toBe(false);

    root.dataset.playgroundVersion = "1";
    initializeCodePlaygrounds();
    expect(root.dataset.playgroundEnhancementState).toBe("pending");

    root.remove();
    initializeCodePlaygrounds();
    expect(root.dataset.playgroundEnhancementState).toBeUndefined();
    expect(observer.observed.has(root)).toBe(false);

    document.body.append(root);
    initializeCodePlaygrounds();
    expect(root.dataset.playgroundEnhancementState).toBe("pending");
    expect(observer.observed.has(root)).toBe(true);

    root.removeAttribute("data-code-playground");
    initializeCodePlaygrounds();
    expect(root.dataset.playgroundEnhancementState).toBeUndefined();
    expect(observer.observed.has(root)).toBe(false);
    observer.intersect(root);
    expect(root.classList.contains("is-enhanced")).toBe(false);
  });

  it("keeps CodeMirror colors live through root color-scheme switches", async () => {
    const { initializeCodePlaygrounds } = await import("./playground");
    const root = document.createElement("div");
    root.dataset.codePlayground = "";
    root.dataset.playgroundVersion = "1";
    root.dataset.playgroundRun = "manual";
    root.innerHTML =
      '<pre data-playground-file="/index.js"><code>const answer = true;</code></pre>';
    document.body.append(root);

    initializeCodePlaygrounds();
    TestIntersectionObserver.latest!.intersect(root);

    const editor = root.querySelector(".cm-editor");
    expect(editor).not.toBeNull();
    const editorStyles = Array.from(document.head.querySelectorAll("style"))
      .map((style) => style.textContent || "")
      .join("\n");
    [
      "--moonlit-playground-syntax-keyword",
      "--moonlit-playground-caret",
      "--moonlit-playground-gutter-text",
      "--moonlit-playground-active-line",
      "--moonlit-playground-selection",
    ].forEach((variable) => expect(editorStyles).toContain(`var(${variable})`));

    document.documentElement.dataset.colorScheme = "dark";
    expect(root.querySelector(".cm-editor")).toBe(editor);
    document.documentElement.dataset.colorScheme = "light";
    expect(root.querySelector(".cm-editor")).toBe(editor);
    document.documentElement.dataset.colorScheme = "auto";
    expect(root.querySelector(".cm-editor")).toBe(editor);
  });
});
