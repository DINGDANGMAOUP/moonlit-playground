// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  hasPlaygroundContent,
  hasPlaygroundSentinel,
  isTopLevelPlaygroundRoot,
  isSupportedPlaygroundVersion,
  PLAYGROUND_CONTRACT_VERSION,
  PLAYGROUND_SENTINEL_PATTERN,
  readPlaygroundRunMode,
  readPlaygroundRootField,
  shouldAutoStartPlayground,
  writePlaygroundRootField,
} from "./playground-contract";

describe("Playground public contract", () => {
  it("detects current and legacy structured blocks but leaves future versions static", () => {
    document.body.innerHTML = '<div data-code-playground data-playground-version="1"></div>';
    expect(hasPlaygroundContent()).toBe(true);

    document.body.innerHTML = '<div data-code-playground></div>';
    expect(hasPlaygroundContent()).toBe(true);

    document.body.innerHTML = '<div data-code-playground data-playground-version="2"></div>';
    expect(hasPlaygroundContent()).toBe(false);
  });

  it("keeps everything nested in a future protocol root inert", () => {
    document.body.innerHTML = `
      <div data-code-playground data-playground-version="2">
        <div data-code-playground data-playground-version="1">
          <pre data-playground-file="/index.js"><code>console.log("nested")</code></pre>
        </div>
        <pre><code>// @moonlit-playground {"run":"auto"}\nconsole.log("legacy")</code></pre>
      </div>
    `;

    const nested = document.querySelectorAll<HTMLElement>("[data-code-playground]")[1]!;
    expect(isTopLevelPlaygroundRoot(nested)).toBe(false);
    expect(hasPlaygroundSentinel()).toBe(false);
    expect(hasPlaygroundContent()).toBe(false);
  });

  it("detects a supported root when the inserted node is the root itself", () => {
    const root = document.createElement("div");
    root.dataset.codePlayground = "";
    root.dataset.playgroundVersion = "1";
    expect(hasPlaygroundContent(root)).toBe(true);
  });

  it("reads only the branded v0 sentinel for backwards compatibility", () => {
    document.body.innerHTML =
      '<pre><code>// @moonlit-playground {"run":"manual"}\nconsole.log(1)</code></pre>';
    expect(hasPlaygroundContent()).toBe(true);
    expect(
      PLAYGROUND_SENTINEL_PATTERN.exec("// @moonlit-playground {}")?.[1],
    ).toBe("{}");

    document.body.innerHTML =
      '<pre><code>// @code-playground\nconsole.log("tutorial")</code></pre>';
    expect(hasPlaygroundContent()).toBe(false);
    expect(PLAYGROUND_SENTINEL_PATTERN.test("// @code-playground")).toBe(false);
  });

  it("prefers namespaced fields while keeping legacy aliases readable", () => {
    const element = document.createElement("div");
    element.dataset.template = "parcel";
    expect(readPlaygroundRootField(element, "template")).toBe("parcel");

    writePlaygroundRootField(element, "template", "vanilla", "parcel");
    expect(element.dataset.playgroundTemplate).toBe("vanilla");
    expect(element.dataset.template).toBe("parcel");
    expect(readPlaygroundRootField(element, "template")).toBe("vanilla");
  });

  it("publishes an explicit protocol version", () => {
    expect(PLAYGROUND_CONTRACT_VERSION).toBe(1);
    const legacy = document.createElement("div");
    const current = document.createElement("div");
    current.dataset.playgroundVersion = "1";
    const future = document.createElement("div");
    future.dataset.playgroundVersion = "2";
    expect(isSupportedPlaygroundVersion(legacy)).toBe(true);
    expect(isSupportedPlaygroundVersion(current)).toBe(true);
    expect(isSupportedPlaygroundVersion(future)).toBe(false);
  });

  it("defaults missing run mode to manual and requires explicit auto", () => {
    const root = document.createElement("div");
    expect(readPlaygroundRunMode(root)).toBe("manual");
    root.dataset.run = "auto";
    expect(readPlaygroundRunMode(root)).toBe("auto");
  });

  it("never auto-starts a source-only block", () => {
    expect(shouldAutoStartPlayground("auto", false)).toBe(false);
    expect(shouldAutoStartPlayground("auto", true)).toBe(true);
    expect(shouldAutoStartPlayground("manual", true)).toBe(false);
  });
});
