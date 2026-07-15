// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  createDefaultConfig,
  normalizePlaygroundConfig,
  parsePlaygroundConfigText,
  parsePlaygroundElement,
  renderOpaquePlaygroundElement,
  renderPlaygroundElement,
  serializePlaygroundConfig,
  serializeOpaquePlaygroundElement,
} from "./playground-config";

describe("Playground HTML contract", () => {
  it("uses manual execution by default to avoid an implicit third-party upload", () => {
    expect(createDefaultConfig("react").run).toBe("manual");
    expect(createDefaultConfig("vanilla").run).toBe("manual");
  });

  it("round-trips a multi-file React project", () => {
    const input = createDefaultConfig("react");
    input.showFiles = false;
    input.showPreview = true;
    input.showConsole = true;
    const output = parsePlaygroundElement(renderPlaygroundElement(input));
    expect(output).toEqual(input);
  });

  it("writes the source, preview, and console visibility contract", () => {
    const input = createDefaultConfig("react");
    input.showFiles = false;
    input.showPreview = false;
    input.showConsole = true;
    const element = renderPlaygroundElement(input);
    expect(element.dataset.playgroundVersion).toBe("1");
    expect(element.dataset.playgroundShowFiles).toBe("false");
    expect(element.dataset.showFiles).toBe("false");
    expect(element.dataset.showPreview).toBe("false");
    expect(element.dataset.showConsole).toBe("true");
  });

  it("infers visibility for legacy elements from the saved default view", () => {
    const legacyPreview = renderPlaygroundElement(createDefaultConfig("react"));
    delete legacyPreview.dataset.playgroundShowFiles;
    delete legacyPreview.dataset.playgroundShowPreview;
    delete legacyPreview.dataset.playgroundShowConsole;
    delete legacyPreview.dataset.playgroundView;
    delete legacyPreview.dataset.showFiles;
    delete legacyPreview.dataset.showPreview;
    delete legacyPreview.dataset.showConsole;
    expect(parsePlaygroundElement(legacyPreview)).toMatchObject({
      showFiles: true,
      showPreview: true,
      showConsole: false,
    });

    legacyPreview.dataset.view = "console";
    expect(parsePlaygroundElement(legacyPreview)).toMatchObject({
      showFiles: true,
      showPreview: false,
      showConsole: true,
    });
  });

  it("writes source as text instead of executable markup", () => {
    const input = createDefaultConfig("vanilla");
    input.files[1]!.code = '<script>window.__unsafe = true</script>';
    const element = renderPlaygroundElement(input);
    expect(element.querySelector("script")).toBeNull();
    expect(parsePlaygroundElement(element).files[1]!.code).toContain("<script>");
  });

  it("reads source after Halo wraps a code block for syntax highlighting", () => {
    const input = createDefaultConfig("react");
    const element = renderPlaygroundElement(input);
    const source = element.querySelector("pre[data-playground-file]")!;
    const shiki = document.createElement("shiki-code");
    source.replaceWith(shiki);
    shiki.append(source);

    expect(parsePlaygroundElement(element)).toEqual(input);
  });

  it("rejects malformed dependency JSON so the original HTML can remain static", () => {
    const element = renderPlaygroundElement(createDefaultConfig("react"));
    element.dataset.playgroundDependencies = "{broken";
    expect(() => parsePlaygroundElement(element)).toThrow("Playground 依赖 JSON 无法解析");
  });

  it("rejects an empty structured root so the editor can preserve it opaquely", () => {
    const element = document.createElement("div");
    element.dataset.codePlayground = "";
    element.dataset.playgroundVersion = "1";
    expect(() => parsePlaygroundElement(element)).toThrow("Playground 至少需要一个");
  });

  it("rejects a non-object dependency value", () => {
    expect(() => normalizePlaygroundConfig({ dependencies: [] })).toThrow(
      "npm 依赖必须是 JSON 对象",
    );
  });

  it("preserves third-party templates instead of rewriting them as vanilla", () => {
    const element = renderPlaygroundElement(createDefaultConfig("vanilla"));
    element.dataset.playgroundTemplate = "svelte";
    expect(() => parsePlaygroundElement(element)).toThrow(
      "默认编辑器不支持 Playground 模板：svelte",
    );
  });

  it("rejects invalid dependencies instead of silently deleting them", () => {
    expect(() => normalizePlaygroundConfig({
      template: "react",
      dependencies: { safe: "^1.2.3", remote: "https://example.com/pkg.tgz" },
    })).toThrow("无效的 npm 依赖：remote");
  });

  it("rejects duplicate paths instead of silently dropping source", () => {
    expect(() => normalizePlaygroundConfig({
      template: "react",
      files: [
        { path: "/App.jsx", code: "one" },
        { path: "/App.jsx", code: "two" },
      ],
    })).toThrow("文件路径重复：/App.jsx");
  });

  it("preserves published HTML opaquely when a file path is invalid", () => {
    const element = renderPlaygroundElement(createDefaultConfig("vanilla"));
    element.querySelector("pre")!.dataset.playgroundFile = "/../secret.js";
    expect(() => parsePlaygroundElement(element)).toThrow("第 1 个文件路径无效");
  });

  it("preserves published HTML opaquely when the entry path is invalid", () => {
    const element = renderPlaygroundElement(createDefaultConfig("vanilla"));
    element.dataset.playgroundEntry = "/index.js?raw";
    expect(() => parsePlaygroundElement(element)).toThrow("入口文件路径无效");
  });

  it("never persists a hidden file as the active frontend file", () => {
    const input = createDefaultConfig("react");
    input.activeFile = "/index.js";
    const output = normalizePlaygroundConfig(input);
    const element = renderPlaygroundElement(output);
    expect(output.activeFile).toBe("/App.jsx");
    expect(
      element.querySelector('[data-playground-file="/index.js"]')?.getAttribute("data-hidden-file"),
    ).toBe("true");
    expect(element.querySelector("[data-active-file]")?.getAttribute("data-playground-file"))
      .toBe("/App.jsx");
  });

  it("accepts the documented source limit without truncation", () => {
    const code = "x".repeat(200_000);
    const output = normalizePlaygroundConfig({
      template: "vanilla",
      files: [1, 2, 3].map((index) => ({ path: `/file-${index}.js`, code })),
    });
    expect(output.files.reduce((total, file) => total + file.code.length, 0)).toBe(600_000);
    expect(output.files[2]!.code).toBe(code);
  });

  it("rejects excess source instead of silently truncating it", () => {
    const code = "x".repeat(200_000);
    expect(() => normalizePlaygroundConfig({
      template: "vanilla",
      files: [1, 2, 3, 4].map((index) => ({ path: `/file-${index}.js`, code })),
    })).toThrow("Playground 源码总量不能超过 600000 个字符");
  });

  it("still reads the legacy ProseMirror text payload during migration", () => {
    const input = createDefaultConfig("react");
    input.title = "持久化回读验证";
    input.files[0]!.code = "// saved through the node document\nexport default 1;";
    const serialized = serializePlaygroundConfig(input);
    expect(parsePlaygroundConfigText(serialized)).toEqual(input);
  });

  it("keeps an intentionally empty title instead of restoring the template default", () => {
    const input = createDefaultConfig("react");
    input.title = "";
    const serialized = serializePlaygroundConfig(input);
    const element = renderPlaygroundElement(input);

    expect(parsePlaygroundConfigText(serialized).title).toBe("");
    expect(element.dataset.title).toBe("");
    expect(parsePlaygroundElement(element).title).toBe("");
  });

  it("distinguishes a cleared title from a missing title", () => {
    expect(normalizePlaygroundConfig({ template: "react", title: "   " }).title).toBe("");
    expect(normalizePlaygroundConfig({ template: "react" }).title).toBe("Live Code Playground");
  });

  it("falls back safely when stored node content is invalid", () => {
    const fallback = createDefaultConfig("vanilla");
    expect(parsePlaygroundConfigText("{broken", fallback)).toEqual(fallback);
  });

  it("round-trips an unsupported protocol as inert opaque HTML", () => {
    const source = document.createElement("div");
    source.dataset.codePlayground = "";
    source.dataset.playgroundVersion = "2";
    source.dataset.futureOption = "kept";
    source.innerHTML = '<pre data-playground-file="/future.js"><code>future()</code></pre><a href="java&#10;script:alert(1)" style="background:url(javascript:alert(1))">unsafe</a><script>alert(1)</script>';

    const serialized = serializeOpaquePlaygroundElement(source);
    const restored = renderOpaquePlaygroundElement(serialized);
    expect(restored.dataset.playgroundVersion).toBe("2");
    expect(restored.dataset.futureOption).toBe("kept");
    expect(restored.querySelector("code")?.textContent).toBe("future()");
    expect(restored.querySelector("script")).toBeNull();
    expect(restored.querySelector("a")?.hasAttribute("href")).toBe(false);
    expect(restored.querySelector("a")?.hasAttribute("style")).toBe(false);
  });
});
