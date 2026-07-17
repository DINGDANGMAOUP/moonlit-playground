import "./playground.css";

import { basicSetup } from "codemirror";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import {
  AlertCircle,
  AlertTriangle,
  Ban,
  createElement as createLucideIcon,
  Play,
  RefreshCw,
  RotateCcw,
  Share2,
  type IconNode,
} from "lucide";
import type {
  ClientOptions,
  SandpackClient,
  SandpackMessage,
  SandpackTemplate,
  SandboxSetup,
} from "@codesandbox/sandpack-client";
import {
  PLAYGROUND_CONTRACT_VERSION,
  PLAYGROUND_FILE_SELECTOR,
  PLAYGROUND_SELECTOR,
  PLAYGROUND_SENTINEL_PATTERN,
  isTopLevelPlaygroundRoot,
  isSupportedPlaygroundVersion,
  readPlaygroundRunMode,
  readPlaygroundRootField,
  shouldAutoStartPlayground,
  writePlaygroundRootField,
} from "../playground-contract";

type PlaygroundStatus = "idle" | "loading" | "success" | "error" | "dirty";

type PlaygroundFile = {
  code: string;
  initialCode: string;
  language: string;
  label: string;
  path: string;
  readOnly: boolean;
  hidden: boolean;
  source: HTMLElement;
  state?: EditorState;
};

type RuntimeClient = SandpackClient & {
  getCodeSandboxURL?: () => Promise<{ editorUrl: string }>;
};

const MAX_FILES = 24;
const MAX_FILE_PATH_LENGTH = 180;
const MAX_FILE_LENGTH = 200_000;
const MAX_TOTAL_SOURCE_LENGTH = 600_000;
const MAX_CONSOLE_ROWS = 200;
const MAX_CONSOLE_VALUE_LENGTH = 8_000;
let playgroundSequence = 0;
const ALLOWED_TEMPLATES = new Set<SandpackTemplate>([
  "static",
  "parcel",
  "create-react-app",
  "create-react-app-typescript",
  "vue-cli",
  "svelte",
  "solid",
]);

// Keep token colors bound to the Playground palette instead of choosing a
// HighlightStyle once during construction. CSS custom properties update in
// place when a theme switches between explicit or system-following schemes.
const playgroundHighlightStyle = HighlightStyle.define([
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: "var(--moonlit-playground-syntax-comment)",
  },
  {
    tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword, tags.operatorKeyword],
    color: "var(--moonlit-playground-syntax-keyword)",
  },
  {
    tag: [tags.tagName, tags.deleted],
    color: "var(--moonlit-playground-syntax-tag)",
  },
  {
    tag: [tags.punctuation, tags.bracket],
    color: "var(--moonlit-playground-syntax-punctuation)",
  },
  {
    tag: [tags.definition(tags.variableName), tags.function(tags.variableName)],
    color: "var(--moonlit-playground-syntax-definition)",
  },
  {
    tag: [tags.propertyName, tags.attributeName],
    color: "var(--moonlit-playground-syntax-property)",
  },
  {
    tag: [tags.string, tags.special(tags.string)],
    color: "var(--moonlit-playground-syntax-string)",
  },
  {
    tag: [tags.number, tags.bool, tags.null],
    color: "var(--moonlit-playground-syntax-literal)",
  },
  {
    tag: [tags.typeName, tags.className],
    color: "var(--moonlit-playground-syntax-type)",
  },
  {
    tag: [tags.operator, tags.special(tags.variableName)],
    color: "var(--moonlit-playground-syntax-operator)",
  },
  {
    tag: tags.invalid,
    color: "var(--moonlit-playground-syntax-invalid)",
    textDecoration: "underline",
  },
]);

const languageForPath = (path: string, declaredLanguage: string): Extension => {
  const language = declaredLanguage.toLowerCase();
  if (language === "html" || /\.html?$/.test(path)) return html();
  if (language === "css" || /\.css$/.test(path)) return css();
  return javascript({
    jsx: language === "jsx" || language === "tsx" || /\.[jt]sx$/.test(path),
    typescript: language === "ts" || language === "tsx" || /\.tsx?$/.test(path),
  });
};

const normalizePath = (path: string) => {
  const normalized = path.trim().replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  if (
    !segments.length ||
    segments.some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        /[\u0000-\u001f\u007f?#]/.test(segment),
    )
  ) {
    throw new Error(`Playground 文件路径不合法：${path}`);
  }
  const result = `/${segments.join("/")}`;
  if (result.length > MAX_FILE_PATH_LENGTH) {
    throw new Error(`Playground 文件路径过长：${path}`);
  }
  return result;
};

const fileLabel = (path: string) => path.split("/").filter(Boolean).at(-1) || path;

const parseDependencies = (value: string | undefined) => {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Playground 依赖必须是 JSON 对象");
    }

    const safeVersion = /^(?:[v~^<>=*xX0-9.\s|-]+(?:-[0-9A-Za-z.-]+)?|latest|next|beta|alpha|canary|rc)$/;
    const entries = Object.entries(parsed);
    if (entries.length > 32) throw new Error("Playground npm 依赖不能超过 32 个");
    entries.forEach(([name, version]) => {
      if (
        name.length > 214 ||
        typeof version !== "string" ||
        version.length > 100 ||
        !safeVersion.test(version) ||
        !/^(?:@[-\w.]+\/)?[-\w.]+$/.test(name)
      ) {
        throw new Error(`Playground npm 依赖无效：${name}`);
      }
    });
    return Object.fromEntries(entries) as Record<string, string>;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Playground")) throw error;
    throw new Error("Playground 依赖 JSON 无法解析");
  }
};

const button = (label: string, className: string, text: string) => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = text;
  element.setAttribute("aria-label", label);
  return element;
};

const iconButton = (label: string, className: string, icon: IconNode) => {
  const element = button(label, className, "");
  element.title = label;
  const svg = createLucideIcon(icon);
  svg.setAttribute("aria-hidden", "true");
  element.append(svg);
  return element;
};

const iconTextButton = (
  label: string,
  className: string,
  text: string,
  icon: IconNode,
) => {
  const element = button(label, className, "");
  const textElement = document.createElement("span");
  textElement.textContent = text;
  const svg = createLucideIcon(icon);
  svg.setAttribute("aria-hidden", "true");
  element.append(textElement, svg);
  return element;
};

const explicitBoolean = (value: string | undefined) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
};

const truncateConsoleValue = (value: unknown) => {
  let output: string;
  if (typeof value === "string") {
    output = value;
  } else {
    try {
      const serialized = JSON.stringify(value);
      output = serialized === undefined ? String(value) : serialized;
    } catch {
      output = String(value);
    }
  }
  return output.length > MAX_CONSOLE_VALUE_LENGTH
    ? `${output.slice(0, MAX_CONSOLE_VALUE_LENGTH)}\n…输出已截断`
    : output;
};

const createSourceFile = ({
  active = false,
  code,
  hidden = false,
  language,
  path,
}: {
  active?: boolean;
  code: string;
  hidden?: boolean;
  language: string;
  path: string;
}) => {
  const pre = document.createElement("pre");
  pre.dataset.playgroundFile = path;
  pre.dataset.language = language;
  if (active) pre.setAttribute("data-active-file", "");
  if (hidden) {
    pre.dataset.hiddenFile = "true";
    pre.hidden = true;
  }
  const codeElement = document.createElement("code");
  codeElement.className = `language-${language}`;
  codeElement.textContent = code;
  pre.append(codeElement);
  return pre;
};

const materializeSentinelPlaygrounds = () => {
  const codeBlocks = Array.from(
    document.querySelectorAll<HTMLElement>("pre code, shiki-code code"),
  );

  codeBlocks.forEach((codeBlock) => {
    // Structured blocks may legitimately contain this marker as source code.
    // Only legacy, standalone code blocks should be materialized.
    if (codeBlock.closest(PLAYGROUND_SELECTOR)) return;

    const source = codeBlock.textContent || "";
    const lines = source.split("\n");
    const markerIndex = lines.findIndex((line) => line.trim());
    if (markerIndex < 0) return;
    const markerMatch = lines[markerIndex]!.match(PLAYGROUND_SENTINEL_PATTERN);
    if (!markerMatch) return;

    const rawOptions = markerMatch[1];
    let options: Record<string, unknown> = {};
    if (rawOptions) {
      try {
        const parsed = JSON.parse(rawOptions) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          options = parsed as Record<string, unknown>;
        }
      } catch {
        console.warn("[Moonlit Playground] 标记配置不是有效 JSON，已保留普通代码块");
        return;
      }
    }

    const originalBlock = codeBlock.closest("shiki-code") || codeBlock.closest("pre");
    if (!originalBlock?.parentElement) return;

    const wrapper = document.createElement("div");
    wrapper.dataset.codePlayground = "";
    wrapper.dataset.playgroundVersion = String(PLAYGROUND_CONTRACT_VERSION);
    writePlaygroundRootField(
      wrapper,
      "showFiles",
      String(typeof options.showFiles === "boolean" ? options.showFiles : false),
    );
    writePlaygroundRootField(wrapper, "run", options.run === "manual" ? "manual" : "auto");
    writePlaygroundRootField(wrapper, "view", options.view === "console" ? "console" : "preview");
    writePlaygroundRootField(wrapper, "showPreview", String(
      typeof options.showPreview === "boolean"
        ? options.showPreview
        : options.view !== "console",
    ));
    writePlaygroundRootField(wrapper, "showConsole", String(
      typeof options.showConsole === "boolean"
        ? options.showConsole
        : options.view === "console",
    ));
    if (typeof options.title === "string" && options.title.length <= 120) {
      writePlaygroundRootField(wrapper, "title", options.title);
    }

    const code = lines.filter((_, index) => index !== markerIndex).join("\n");
    const isReact = options.template === "react";
    if (isReact) {
      writePlaygroundRootField(wrapper, "template", "react", "create-react-app");
      writePlaygroundRootField(wrapper, "entry", "/index.js");
      writePlaygroundRootField(
        wrapper,
        "dependencies",
        JSON.stringify({ react: "18.3.1", "react-dom": "18.3.1" }),
      );
      wrapper.append(
        createSourceFile({ active: true, code, language: "jsx", path: "/App.jsx" }),
        createSourceFile({
          code: `import React from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./styles.css";\n\ncreateRoot(document.getElementById("root")).render(<App />);`,
          hidden: true,
          language: "jsx",
          path: "/index.js",
        }),
        createSourceFile({
          code: "html, body, #root { min-height: 100%; margin: 0; }\nbody { font-family: system-ui, sans-serif; }",
          hidden: true,
          language: "css",
          path: "/styles.css",
        }),
      );
    } else {
      writePlaygroundRootField(wrapper, "template", "vanilla", "parcel");
      writePlaygroundRootField(wrapper, "entry", "/index.html");
      wrapper.append(
        createSourceFile({ active: true, code, language: "javascript", path: "/index.js" }),
        createSourceFile({
          code: '<main id="app"></main>\n<script type="module" src="/index.js"></script>',
          hidden: true,
          language: "html",
          path: "/index.html",
        }),
      );
    }

    originalBlock.replaceWith(wrapper);
  });
};

const enhancementErrorText = (error: unknown) =>
  error instanceof Error && error.message
    ? error.message
    : "交互式运行环境暂时无法加载。";

const restoreStaticPlaygroundRoot = (root: HTMLElement) => {
  root.querySelectorAll(":scope > .moonlit-playground__shell").forEach((shell) => shell.remove());
  root.querySelectorAll<HTMLElement>(PLAYGROUND_FILE_SELECTOR).forEach((source) => {
    source.hidden = false;
    source.removeAttribute("hidden");
    const wrapper = source.parentElement;
    if (wrapper?.matches("shiki-code") && wrapper.parentElement === root) {
      delete wrapper.dataset.playgroundSourceWrapper;
      wrapper.removeAttribute("hidden");
    }
  });
  root.classList.remove(
    "moonlit-playground",
    "is-enhanced",
    "has-playground-error",
  );
  root.removeAttribute("aria-busy");
  root.removeAttribute("aria-label");
  root
    .querySelectorAll(":scope > .moonlit-playground__fallback-error")
    .forEach((notice) => notice.remove());
  delete root.dataset.playgroundEnhancementState;
};

const rollbackPlaygroundRoot = (root: HTMLElement, error: unknown) => {
  restoreStaticPlaygroundRoot(root);
  root.dataset.playgroundEnhancementState = "failed";
  const notice = document.createElement("div");
  notice.className = "moonlit-playground__fallback-error";
  notice.setAttribute("role", "alert");
  notice.setAttribute("aria-live", "assertive");
  notice.textContent = `Playground 无法启动，已保留原始代码：${enhancementErrorText(error)}`;
  root.prepend(notice);
};

class MoonlitPlayground {
  private readonly root: HTMLElement;
  private readonly files = new Map<string, PlaygroundFile>();
  private readonly dependencies: Record<string, string>;
  private readonly entry: string;
  private readonly template: SandpackTemplate;
  private readonly showFiles: boolean;
  private readonly showPreview: boolean;
  private readonly showConsole: boolean;
  private readonly runMode: "auto" | "manual";
  private readonly title: string;
  private readonly instanceId = `moonlit-playground-${++playgroundSequence}`;
  private activePath: string;
  private client: RuntimeClient | null = null;
  private unsubscribeClient: (() => void) | null = null;
  private editor: EditorView | null = null;
  private initializePromise: Promise<void> | null = null;
  private runTimer = 0;
  private compileFallbackTimer = 0;
  private compileInFlight = false;
  private runQueued = false;
  private sourceDirty = false;
  private destroyed = false;
  private shell: HTMLElement | null = null;

  private readonly fileTabs = document.createElement("div");
  private readonly editorHost = document.createElement("div");
  private readonly previewFrame = document.createElement("iframe");
  private readonly previewPanel = document.createElement("div");
  private readonly consolePanel = document.createElement("div");
  private readonly consoleOutput = document.createElement("div");
  private readonly status = document.createElement("span");
  private readonly statusText = document.createElement("span");
  private readonly runButton = iconTextButton(
    "Run",
    "moonlit-playground__button is-primary",
    "Run",
    Play,
  );
  private readonly resetButton = iconButton(
    "Reset code",
    "moonlit-playground__icon-button",
    RotateCcw,
  );
  private readonly refreshButton = iconButton(
    "Refresh preview",
    "moonlit-playground__icon-button",
    RefreshCw,
  );
  private readonly clearButton = iconButton(
    "Clear console",
    "moonlit-playground__icon-button moonlit-playground__clear",
    Ban,
  );
  private readonly externalButton = iconButton(
    "Open in Code Sandbox",
    "moonlit-playground__icon-button",
    Share2,
  );
  private readonly announcement = document.createElement("span");

  private get hasOutput() {
    return this.showPreview || this.showConsole;
  }

  constructor(root: HTMLElement) {
    this.root = root;
    this.runMode = readPlaygroundRunMode(root);
    this.title = readPlaygroundRootField(root, "title") || "Live Code Playground";
    this.dependencies = parseDependencies(readPlaygroundRootField(root, "dependencies"));
    this.showFiles = explicitBoolean(readPlaygroundRootField(root, "showFiles")) ?? true;
    this.showPreview =
      explicitBoolean(readPlaygroundRootField(root, "showPreview")) ??
      readPlaygroundRootField(root, "view") !== "console";
    this.showConsole =
      explicitBoolean(readPlaygroundRootField(root, "showConsole")) ??
      readPlaygroundRootField(root, "view") === "console";

    const templateValue = readPlaygroundRootField(root, "template");
    const requestedTemplate = (
      templateValue === "react"
        ? "create-react-app"
        : templateValue === "vanilla"
          ? "parcel"
          : templateValue
    ) as SandpackTemplate | undefined;
    this.template = requestedTemplate && ALLOWED_TEMPLATES.has(requestedTemplate)
      ? requestedTemplate
      : "static";

    // Halo's frontend syntax highlighter wraps published <pre> nodes in a
    // <shiki-code> element. Keep direct children for raw/theme-authored HTML,
    // and accept exactly one known Halo wrapper without scanning unrelated
    // nested code blocks inside the Playground root.
    const allSourceNodes = Array.from(
      root.querySelectorAll<HTMLElement>(PLAYGROUND_FILE_SELECTOR),
    );
    if (allSourceNodes.length > MAX_FILES) {
      throw new Error(`Playground 最多支持 ${MAX_FILES} 个文件`);
    }
    const sourceNodes = allSourceNodes.slice(0, MAX_FILES);
    let totalSourceLength = 0;

    sourceNodes.forEach((node, index) => {
      const path = normalizePath(node.dataset.playgroundFile || `file-${index + 1}.js`);
      const code = node.querySelector("code")?.textContent ?? node.textContent ?? "";
      if (code.length > MAX_FILE_LENGTH) {
        throw new Error(`Playground 单个文件不能超过 ${MAX_FILE_LENGTH} 个字符`);
      }
      totalSourceLength += code.length;
      if (totalSourceLength > MAX_TOTAL_SOURCE_LENGTH) {
        throw new Error(`Playground 源码总量不能超过 ${MAX_TOTAL_SOURCE_LENGTH} 个字符`);
      }
      if (this.files.has(path)) throw new Error(`Playground 文件路径重复：${path}`);
      const language =
        node.dataset.language ||
        node.querySelector("code")?.className.match(/language-([\w-]+)/)?.[1] ||
        "javascript";
      this.files.set(path, {
        path,
        label: node.dataset.label || fileLabel(path),
        code,
        initialCode: code,
        language,
        readOnly: node.dataset.readonly === "true",
        hidden: node.dataset.hiddenFile === "true",
        source: node,
      });
    });

    const firstPath = this.files.keys().next().value as string | undefined;
    if (!firstPath) throw new Error("Playground 至少需要一个 data-playground-file 文件");

    const requestedEntry = normalizePath(readPlaygroundRootField(root, "entry") || firstPath);
    this.entry = this.files.has(requestedEntry) ? requestedEntry : firstPath;
    this.activePath =
      sourceNodes.find((node) => node.hasAttribute("data-active-file"))?.dataset.playgroundFile
        ? normalizePath(
            sourceNodes.find((node) => node.hasAttribute("data-active-file"))!.dataset
              .playgroundFile!,
          )
        : firstPath;
    if (!this.files.has(this.activePath)) this.activePath = firstPath;

    sourceNodes.forEach((node) => {
      const wrapper = node.parentElement;
      if (wrapper?.matches("shiki-code") && wrapper.parentElement === root) {
        wrapper.dataset.playgroundSourceWrapper = "";
      }
    });

    this.shell = this.buildInterface();
    this.buildEditor();
    const requestedView = readPlaygroundRootField(root, "view") === "console"
      ? "console"
      : "preview";
    if (requestedView === "console" && this.showConsole) this.setOutputView("console");
    else if (this.showPreview) this.setOutputView("preview");
    else if (this.showConsole) this.setOutputView("console");
    this.commitInterface();
  }

  private buildInterface() {
    const shell = document.createElement("section");
    shell.className = "moonlit-playground__shell";

    const toolbar = document.createElement("div");
    toolbar.className = "moonlit-playground__toolbar";

    this.fileTabs.className = "moonlit-playground__files";
    this.fileTabs.setAttribute("role", "tablist");
    this.fileTabs.setAttribute("aria-label", "Code files");
    const visibleFiles = Array.from(this.files.values()).filter((file) => !file.hidden);
    if (!this.showFiles) {
      const label = document.createElement("span");
      label.className = "moonlit-playground__label";
      label.textContent = this.title;
      this.fileTabs.append(label);
    } else {
      visibleFiles.forEach((file) => {
        const fileButton = button(
          `Edit ${file.label}`,
          "moonlit-playground__file",
          file.label,
        );
        fileButton.dataset.filePath = file.path;
        fileButton.setAttribute("role", "tab");
        fileButton.setAttribute("aria-selected", String(file.path === this.activePath));
        fileButton.tabIndex = file.path === this.activePath ? 0 : -1;
        fileButton.addEventListener("click", () => this.switchFile(file.path));
        fileButton.addEventListener("keydown", (event) => this.handleFileTabKeydown(event));
        this.fileTabs.append(fileButton);
      });
    }

    const actions = document.createElement("div");
    actions.className = "moonlit-playground__actions";
    const provider = document.createElement("span");
    provider.className = "moonlit-playground__provider";
    provider.textContent = "CodeSandbox";
    provider.title = "运行会将该示例的源码与依赖发送到 CodeSandbox";
    this.status.className = "moonlit-playground__status";
    this.status.dataset.status = "idle";
    this.status.setAttribute("role", "status");
    this.statusText.textContent = "待运行";
    this.status.append(this.statusText);

    this.runButton.hidden = this.runMode !== "manual" || !this.hasOutput;
    this.runButton.title = "Run (⌘/Ctrl + Enter)";
    this.runButton.addEventListener("click", () => void this.run());
    this.resetButton.addEventListener("click", () => this.reset());
    this.refreshButton.addEventListener("click", () => {
      try {
        if (this.client) this.client.dispatch({ type: "refresh" });
        else void this.run();
      } catch (error) {
        this.failEnhancement(error);
      }
    });
    this.clearButton.addEventListener("click", () => this.clearConsole());
    this.externalButton.addEventListener("click", () => void this.openInCodeSandbox());
    actions.append(provider, this.status, this.resetButton, this.externalButton);
    toolbar.append(this.fileTabs, actions);

    const editorPanel = document.createElement("div");
    editorPanel.className = "moonlit-playground__editor";
    this.editorHost.className = "moonlit-playground__editor-host";
    editorPanel.append(this.editorHost, this.runButton);

    const outputPanel = document.createElement("div");
    outputPanel.className = "moonlit-playground__output";
    const outputToolbar = document.createElement("div");
    outputToolbar.className = "moonlit-playground__output-toolbar";
    const outputTabs = document.createElement("div");
    outputTabs.className = "moonlit-playground__output-tabs";
    outputTabs.setAttribute("role", "tablist");
    outputTabs.setAttribute("aria-label", "Playground output");
    const outputViews = ([
      ["preview", "Preview", this.showPreview],
      ["console", "Console", this.showConsole],
    ] as const).filter(([, , visible]) => visible);
    outputViews.forEach(([view, label]) => {
      const outputButton = button(`Show ${label}`, "moonlit-playground__output-tab", label);
      outputButton.dataset.outputView = view;
      outputButton.setAttribute("role", "tab");
      outputButton.id = `${this.instanceId}-${view}-tab`;
      outputButton.setAttribute("aria-controls", `${this.instanceId}-${view}-panel`);
      outputButton.setAttribute("aria-selected", "false");
      outputButton.tabIndex = -1;
      outputButton.addEventListener("click", () => this.setOutputView(view));
      outputButton.addEventListener("keydown", (event) =>
        this.handleOutputTabKeydown(event),
      );
      outputTabs.append(outputButton);
    });
    outputToolbar.append(outputTabs, this.refreshButton, this.clearButton);
    this.refreshButton.hidden = true;
    this.clearButton.hidden = true;

    this.previewPanel.className = "moonlit-playground__preview";
    this.previewPanel.dataset.outputPanel = "preview";
    this.previewPanel.id = `${this.instanceId}-preview-panel`;
    this.previewPanel.setAttribute("role", "tabpanel");
    this.previewPanel.setAttribute("aria-labelledby", `${this.instanceId}-preview-tab`);
    this.previewFrame.title = `${this.title} preview`;
    this.previewFrame.loading = "lazy";
    this.previewFrame.referrerPolicy = "no-referrer";
    this.previewFrame.setAttribute(
      "sandbox",
      "allow-scripts allow-same-origin",
    );
    this.previewFrame.setAttribute("aria-label", "Code preview");
    this.previewPanel.append(this.previewFrame);

    this.consolePanel.className = "moonlit-playground__console";
    this.consolePanel.dataset.outputPanel = "console";
    this.consolePanel.id = `${this.instanceId}-console-panel`;
    this.consolePanel.setAttribute("role", "tabpanel");
    this.consolePanel.setAttribute("aria-labelledby", `${this.instanceId}-console-tab`);
    this.consolePanel.hidden = true;
    this.consoleOutput.className = "moonlit-playground__console-output";
    this.consoleOutput.setAttribute("role", "log");
    this.consoleOutput.setAttribute("aria-label", "Console output");
    this.consolePanel.append(this.consoleOutput);

    if (outputViews.length) {
      outputPanel.append(outputToolbar, this.previewPanel, this.consolePanel);
    } else {
      outputPanel.hidden = true;
      outputPanel.append(this.previewPanel);
    }

    const workspace = document.createElement("div");
    workspace.className = "moonlit-playground__workspace";
    workspace.append(editorPanel, outputPanel);

    this.announcement.className = "moonlit-playground__sr-only";
    this.announcement.setAttribute("aria-live", "polite");
    shell.append(toolbar, workspace, this.announcement);
    this.setStatus("idle", "待运行");
    return shell;
  }

  private commitInterface() {
    if (!this.shell) throw new Error("Playground 界面未完成初始化");
    // `is-enhanced` is the final commit marker. Until it is applied, authored
    // source remains visible even if an earlier construction step fails.
    this.root.classList.add("moonlit-playground");
    this.root.setAttribute("aria-label", this.title);
    this.root.append(this.shell);
    this.root.dataset.playgroundEnhancementState = "enhanced";
    this.root.classList.add("is-enhanced");
  }

  private buildEditor() {
    this.files.forEach((file) => {
      file.state = this.createEditorState(file);
    });
    this.editor = new EditorView({
      state: this.files.get(this.activePath)!.state,
      parent: this.editorHost,
    });
  }

  private createEditorState(file: PlaygroundFile) {
    return EditorState.create({
      doc: file.code,
      extensions: [
        basicSetup,
        languageForPath(file.path, file.language),
        syntaxHighlighting(playgroundHighlightStyle),
        EditorView.contentAttributes.of({
          "aria-label": `编辑 ${file.label}`,
          "aria-describedby": this.root.dataset.descriptionId || "",
          spellcheck: "false",
        }),
        EditorView.theme({
          "&": { height: "100%", backgroundColor: "transparent" },
          ".cm-scroller": { overflow: "auto", fontFamily: "inherit" },
          ".cm-content": {
            caretColor: "var(--moonlit-playground-caret)",
          },
          ".cm-cursor, .cm-dropCursor": {
            borderLeftColor: "var(--moonlit-playground-caret)",
          },
          ".cm-gutters": {
            backgroundColor: "transparent",
            border: "none",
            color: "var(--moonlit-playground-gutter-text)",
          },
          ".cm-activeLine, .cm-activeLineGutter": {
            backgroundColor: "var(--moonlit-playground-active-line)",
          },
          ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
            backgroundColor: "var(--moonlit-playground-selection)",
          },
        }),
        EditorView.editable.of(!file.readOnly),
        EditorState.readOnly.of(file.readOnly),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || this.destroyed) return;
          const current = this.files.get(this.activePath);
          if (!current) return;
          current.code = update.state.doc.toString();
          current.state = update.state;
          this.sourceDirty = true;
          this.setStatus("dirty", this.runMode === "manual" ? "等待运行" : "正在更新");
          window.clearTimeout(this.runTimer);
          if (shouldAutoStartPlayground(this.runMode, this.hasOutput)) {
            this.runTimer = window.setTimeout(() => void this.run(), 650);
          }
        }),
        keymap.of([
          {
            key: "Mod-Enter",
            preventDefault: true,
            run: () => {
              void this.run();
              return true;
            },
          },
        ]),
      ],
    });
  }

  private switchFile(path: string, focusEditor = true) {
    if (!this.editor || path === this.activePath || !this.files.has(path)) return;
    const current = this.files.get(this.activePath)!;
    current.state = this.editor.state;
    current.code = this.editor.state.doc.toString();
    this.activePath = path;
    const next = this.files.get(path)!;
    next.state ||= this.createEditorState(next);
    this.editor.setState(next.state);
    this.fileTabs.querySelectorAll<HTMLButtonElement>("[data-file-path]").forEach((fileButton) => {
      const selected = fileButton.dataset.filePath === path;
      fileButton.setAttribute("aria-selected", String(selected));
      fileButton.tabIndex = selected ? 0 : -1;
    });
    this.announcement.textContent = `正在编辑 ${next.label}`;
    if (focusEditor) this.editor.focus();
  }

  private handleFileTabKeydown(event: KeyboardEvent) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = Array.from(
      this.fileTabs.querySelectorAll<HTMLButtonElement>("[data-file-path]"),
    );
    const currentIndex = tabs.indexOf(event.currentTarget as HTMLButtonElement);
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const next = event.key === "Home"
      ? tabs[0]
      : event.key === "End"
        ? tabs.at(-1)
        : tabs[(currentIndex + direction + tabs.length) % tabs.length];
    if (!next?.dataset.filePath) return;
    event.preventDefault();
    this.switchFile(next.dataset.filePath, false);
    next.focus();
  }

  private handleOutputTabKeydown(event: KeyboardEvent) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = Array.from(
      this.root.querySelectorAll<HTMLButtonElement>("[data-output-view]"),
    );
    const currentIndex = tabs.indexOf(event.currentTarget as HTMLButtonElement);
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const next = event.key === "Home"
      ? tabs[0]
      : event.key === "End"
        ? tabs.at(-1)
        : tabs[(currentIndex + direction + tabs.length) % tabs.length];
    const nextView = next?.dataset.outputView;
    if (!next || (nextView !== "preview" && nextView !== "console")) return;
    event.preventDefault();
    this.setOutputView(nextView);
    next.focus();
  }

  private createSetup(): SandboxSetup {
    const files = Object.fromEntries(
      Array.from(this.files.values()).map((file) => [
        file.path,
        { code: file.code, active: file.path === this.activePath, readOnly: file.readOnly },
      ]),
    );

    return {
      files,
      entry: this.entry,
      template: this.template,
      dependencies: this.dependencies,
    };
  }

  private startCompilation(text: string) {
    this.compileInFlight = true;
    this.runButton.disabled = true;
    this.root.setAttribute("aria-busy", "true");
    this.setStatus("loading", text);
    window.clearTimeout(this.compileFallbackTimer);
    this.compileFallbackTimer = window.setTimeout(() => {
      if (!this.compileInFlight || this.destroyed) return;
      this.compileInFlight = false;
      this.runButton.disabled = false;
      this.root.removeAttribute("aria-busy");
      this.setStatus("error", "运行超时");
      this.appendConsole("error", ["运行服务响应超时，请检查网络后重试。"]);
    }, 30_000);
  }

  private finishCompilation() {
    this.compileInFlight = false;
    window.clearTimeout(this.compileFallbackTimer);
    this.root.removeAttribute("aria-busy");
    this.runButton.disabled = false;
    if (this.runQueued && !this.destroyed) {
      this.runQueued = false;
      void this.run();
    }
  }

  private async initializeClient() {
    if (this.client || this.destroyed) return;
    if (this.initializePromise) return this.initializePromise;

    this.initializePromise = (async () => {
      this.setStatus("loading", "正在准备");
      this.root.setAttribute("aria-busy", "true");
      const options: ClientOptions = {
        clearConsoleOnFirstCompile: true,
        height: "100%",
        width: "100%",
        showErrorScreen: true,
        showLoadingScreen: true,
        showOpenInCodeSandbox: false,
      };

      try {
        const { loadSandpackClient } = await import("@codesandbox/sandpack-client");
        if (this.destroyed || !this.root.isConnected) return;
        const client = (await loadSandpackClient(
          this.previewFrame,
          this.createSetup(),
          options,
        )) as RuntimeClient;
        if (this.destroyed) {
          client.destroy();
          return;
        }
        this.client = client;
        this.unsubscribeClient = client.listen((message) => this.handleClientMessage(message));
        client.updateSandbox(this.createSetup());
        this.startCompilation("正在编译");
      } catch (error) {
        console.error("[Moonlit Playground]", error);
        this.failEnhancement(error);
      } finally {
        if (!this.client) this.root.removeAttribute("aria-busy");
      }
    })();
    const currentPromise = this.initializePromise;
    await currentPromise;
    if (this.initializePromise === currentPromise) this.initializePromise = null;
  }

  async run() {
    if (!this.hasOutput) {
      this.setStatus("idle", "仅源码");
      return;
    }
    window.clearTimeout(this.runTimer);
    this.runTimer = 0;
    if (this.compileInFlight && this.client) {
      this.runQueued = true;
      this.setStatus("dirty", "等待更新");
      return;
    }
    this.sourceDirty = false;
    this.clearConsole();
    this.runButton.disabled = true;
    this.setStatus("loading", this.client ? "正在更新" : "正在准备");

    const hadClient = Boolean(this.client);
    await this.initializeClient();
    if (this.destroyed) return;
    if (this.client && hadClient) {
      this.files.get(this.activePath)!.state = this.editor?.state;
      this.files.get(this.activePath)!.code = this.editor?.state.doc.toString() || "";
      try {
        this.client.updateSandbox(this.createSetup());
        this.startCompilation("正在编译");
      } catch (error) {
        this.failEnhancement(error);
      }
    }
    if (!this.client) this.runButton.disabled = false;
  }

  private reset() {
    window.clearTimeout(this.runTimer);
    this.files.forEach((file) => {
      file.code = file.initialCode;
      file.state = this.createEditorState(file);
    });
    this.editor?.setState(this.files.get(this.activePath)!.state!);
    this.announcement.textContent = "代码已恢复为文章中的初始版本";
    if (this.hasOutput) void this.run();
    else this.setStatus("idle", "代码已重置");
  }

  private handleClientMessage(message: SandpackMessage) {
    if (message.type === "resize") {
      const height = Math.min(512, Math.max(320, Math.round(message.height)));
      this.previewPanel.style.height = `${height}px`;
      this.previewFrame.style.height = `${height}px`;
      return;
    }

    if (message.type === "status") {
      const labels: Partial<Record<typeof message.status, string>> = {
        initializing: "正在初始化",
        "installing-dependencies": "正在安装依赖",
        transpiling: "正在转译",
        evaluating: "正在运行",
        idle: "已就绪",
        done: "已完成",
      };
      const finished = message.status === "idle" || message.status === "done";
      const preserveDirty = this.sourceDirty && this.runMode === "manual";
      if (!preserveDirty) {
        this.setStatus(finished ? "success" : "loading", labels[message.status] || "正在运行");
      }
      if (finished) this.finishCompilation();
      return;
    }

    if (message.type === "success") {
      if (!(this.sourceDirty && this.runMode === "manual")) {
        this.setStatus("success", "预览已更新");
      }
      this.finishCompilation();
      return;
    }

    if (message.type === "done") {
      if (!(this.sourceDirty && this.runMode === "manual")) {
        this.setStatus(message.compilatonError ? "error" : "success", message.compilatonError ? "编译失败" : "已就绪");
      }
      this.finishCompilation();
      return;
    }

    if (message.type === "action" && message.action === "show-error") {
      this.setStatus("error", "编译失败");
      this.appendConsole("error", [
        message.title,
        `${message.path || this.activePath}${message.line ? `:${message.line}:${message.column}` : ""}`,
        message.message,
      ]);
      this.finishCompilation();
      return;
    }

    if (message.type === "console") {
      message.log.forEach((entry) => {
        if (entry.method === "clear") this.clearConsole();
        else this.appendConsole(entry.method, entry.data);
      });
    }
  }

  private setStatus(status: PlaygroundStatus, text: string) {
    this.status.dataset.status = status;
    this.statusText.textContent = text;
    if (status === "error") this.announcement.textContent = text;
  }

  private setOutputView(view: "preview" | "console") {
    if (view === "preview" && !this.showPreview) return;
    if (view === "console" && !this.showConsole) return;
    this.previewPanel.hidden = view !== "preview" || !this.showPreview;
    this.consolePanel.hidden = view !== "console" || !this.showConsole;
    this.refreshButton.hidden = view !== "preview" || !this.showPreview;
    this.clearButton.hidden = view !== "console" || !this.showConsole;
    (this.shell || this.root)
      .querySelectorAll<HTMLButtonElement>("[data-output-view]")
      .forEach((outputButton) => {
        const selected = outputButton.dataset.outputView === view;
        outputButton.setAttribute("aria-selected", String(selected));
        outputButton.tabIndex = selected ? 0 : -1;
      });
  }

  private appendConsole(method: string, values: unknown[]) {
    const row = document.createElement("div");
    row.className = "moonlit-playground__console-row";
    row.dataset.method = method;
    const methodIcon = method === "warn"
      ? AlertTriangle
      : method === "error" || method === "assert"
        ? AlertCircle
        : null;
    if (methodIcon) {
      const svg = createLucideIcon(methodIcon);
      svg.classList.add("moonlit-playground__console-icon");
      svg.setAttribute("aria-hidden", "true");
      row.append(svg);
    }
    values.forEach((value) => {
      const content = document.createElement("pre");
      content.textContent = truncateConsoleValue(value);
      row.append(content);
    });
    this.consoleOutput.append(row);
    while (this.consoleOutput.childElementCount > MAX_CONSOLE_ROWS) {
      this.consoleOutput.firstElementChild?.remove();
    }
    this.consoleOutput.scrollTop = this.consoleOutput.scrollHeight;
  }

  private clearConsole() {
    this.consoleOutput.replaceChildren();
  }

  private async openInCodeSandbox() {
    const externalWindow = window.open("about:blank", "_blank");
    if (externalWindow) externalWindow.opener = null;
    this.externalButton.disabled = true;
    try {
      await this.initializeClient();
      if (!this.client?.getCodeSandboxURL) {
        throw new Error("CodeSandbox export is not available for this Playground.");
      }
      const { editorUrl } = await this.client.getCodeSandboxURL();
      if (externalWindow) externalWindow.location.replace(editorUrl);
      else throw new Error("浏览器阻止了新窗口，请允许弹出窗口后重试。");
    } catch (error) {
      externalWindow?.close();
      const message = error instanceof Error ? error.message : "暂时无法创建 CodeSandbox。";
      this.appendConsole("error", [message]);
      this.setStatus("error", "无法打开 CodeSandbox");
      this.setOutputView("console");
    } finally {
      this.externalButton.disabled = false;
    }
  }

  async mount() {
    if (shouldAutoStartPlayground(this.runMode, this.hasOutput)) {
      await this.initializeClient();
    } else if (!this.hasOutput) {
      this.setStatus("idle", "仅源码");
    } else {
      this.setStatus("idle", "点击 Run 后启动");
    }
  }

  private failEnhancement(error: unknown) {
    if (this.root.dataset.playgroundEnhancementState === "failed") return;
    this.syncSources();
    this.destroy();
    rollbackPlaygroundRoot(this.root, error);
  }

  private syncSources() {
    this.files.forEach((file) => {
      const code = file.source.querySelector("code");
      if (code) code.textContent = file.code;
      else file.source.textContent = file.code;
    });
  }

  releaseToStatic(syncSources = true) {
    if (syncSources) this.syncSources();
    this.destroy();
    restoreStaticPlaygroundRoot(this.root);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    window.clearTimeout(this.runTimer);
    window.clearTimeout(this.compileFallbackTimer);
    this.unsubscribeClient?.();
    this.client?.destroy();
    this.editor?.destroy();
    this.unsubscribeClient = null;
    this.client = null;
    this.editor = null;
    this.initializePromise = null;
  }

  get isEligible() {
    return this.root.isConnected &&
      isTopLevelPlaygroundRoot(this.root) &&
      isSupportedPlaygroundVersion(this.root);
  }

  get isConnected() {
    return this.root.isConnected;
  }

  get isDestroyed() {
    return this.destroyed;
  }
}

const instances = new Set<MoonlitPlayground>();
const pendingRoots = new Set<HTMLElement>();
let rootObserver: IntersectionObserver | null = null;
let cleanupRegistered = false;

const cleanupDisconnectedPlaygrounds = (force = false) => {
  instances.forEach((instance) => {
    if (instance.isDestroyed) {
      instances.delete(instance);
      return;
    }
    if (instance.isEligible && !force) return;
    // A connected root changed by a morphing theme is authoritative, whether
    // the refresh was explicit or triggered by a marker/version mutation.
    // Only preserve visitor edits when a root was detached for later reuse.
    instance.releaseToStatic(!force && !instance.isConnected);
    instances.delete(instance);
  });
  pendingRoots.forEach((root) => {
    if (
      root.isConnected &&
      isTopLevelPlaygroundRoot(root) &&
      isSupportedPlaygroundVersion(root)
    ) return;
    rootObserver?.unobserve(root);
    pendingRoots.delete(root);
    delete root.dataset.playgroundEnhancementState;
  });
};

const getRootObserver = () => {
  if (rootObserver) return rootObserver;
  rootObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const root = entry.target as HTMLElement;
        if (!pendingRoots.delete(root)) return;
        rootObserver?.unobserve(root);
        if (
          !root.isConnected ||
          !isTopLevelPlaygroundRoot(root) ||
          !isSupportedPlaygroundVersion(root)
        ) {
          delete root.dataset.playgroundEnhancementState;
          return;
        }

        root.dataset.playgroundEnhancementState = "enhancing";
        try {
          const instance = new MoonlitPlayground(root);
          instances.add(instance);
          void instance.mount();
        } catch (error) {
          rollbackPlaygroundRoot(root, error);
          console.error("[Moonlit Playground]", error);
        }
      });
    },
    { rootMargin: "240px 0px", threshold: 0.01 },
  );
  return rootObserver;
};

const registerCleanup = () => {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    rootObserver?.disconnect();
    rootObserver = null;
    pendingRoots.clear();
    instances.forEach((instance) => instance.destroy());
    instances.clear();
  });
};

export const initializeCodePlaygrounds = ({ force = false } = {}) => {
  materializeSentinelPlaygrounds();
  cleanupDisconnectedPlaygrounds(force);
  const roots = Array.from(document.querySelectorAll<HTMLElement>(PLAYGROUND_SELECTOR)).filter(
    (root) =>
      !root.classList.contains("is-enhanced") &&
      root.dataset.playgroundEnhancementState !== "failed" &&
      root.dataset.playgroundEnhancementState !== "pending" &&
      root.dataset.playgroundEnhancementState !== "enhancing" &&
      isTopLevelPlaygroundRoot(root) &&
      isSupportedPlaygroundVersion(root),
  );
  if (!roots.length) return;

  const observer = getRootObserver();
  registerCleanup();
  roots.forEach((root) => {
    root.dataset.playgroundEnhancementState = "pending";
    pendingRoots.add(root);
    observer.observe(root);
  });
};
