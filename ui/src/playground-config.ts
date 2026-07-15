import {
  PLAYGROUND_CONTRACT_VERSION,
  PLAYGROUND_FILE_SELECTOR,
  readPlaygroundRootField,
  writePlaygroundRootField,
} from "./playground-contract";

export type PlaygroundKind = "react" | "vanilla";
export type PlaygroundRunMode = "auto" | "manual";
export type PlaygroundView = "preview" | "console";

export type PlaygroundFile = {
  path: string;
  label: string;
  language: string;
  code: string;
  hidden: boolean;
  readOnly: boolean;
};

export type PlaygroundConfig = {
  version: 1;
  title: string;
  template: PlaygroundKind;
  run: PlaygroundRunMode;
  view: PlaygroundView;
  showFiles: boolean;
  showPreview: boolean;
  showConsole: boolean;
  entry: string;
  activeFile: string;
  dependencies: Record<string, string>;
  files: PlaygroundFile[];
};

export const MAX_PLAYGROUND_FILES = 24;
export const MAX_PLAYGROUND_FILE_CODE_LENGTH = 200_000;
export const MAX_PLAYGROUND_TOTAL_SOURCE_LENGTH = 600_000;
export const MAX_PLAYGROUND_DEPENDENCIES = 32;
const PACKAGE_NAME = /^(?:@[-\w.]+\/)?[-\w.]+$/;
const PACKAGE_VERSION = /^(?:[v~^<>=*xX0-9.\s|-]+(?:-[0-9A-Za-z.-]+)?|latest|next|beta|alpha|canary|rc)$/;

const inferLanguage = (path: string) => {
  if (/\.html?$/.test(path)) return "html";
  if (/\.css$/.test(path)) return "css";
  if (/\.tsx?$/.test(path)) return path.endsWith("x") ? "tsx" : "typescript";
  if (/\.jsx$/.test(path)) return "jsx";
  return "javascript";
};

const parseFilePath = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const raw = value.trim().replace(/\\/g, "/");
  const segments = raw.split("/").filter(Boolean);
  if (
    !segments.length ||
    segments.some((segment) => segment === "." || segment === ".." || /[\u0000-\u001f\u007f?#]/.test(segment))
  ) {
    return undefined;
  }
  const path = `/${segments.join("/")}`;
  return path.length <= 180 ? path : undefined;
};

export const normalizeFilePath = (value: unknown, fallback = "/index.js") =>
  parseFilePath(value) ?? fallback;

export class PlaygroundConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaygroundConfigError";
  }
}

const requireFilePath = (value: unknown, label: string) => {
  const path = parseFilePath(value);
  if (!path) throw new PlaygroundConfigError(`${label}路径无效`);
  return path;
};

const normalizeDependencies = (value: unknown) => {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new PlaygroundConfigError("npm 依赖必须是 JSON 对象");
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_PLAYGROUND_DEPENDENCIES) {
    throw new PlaygroundConfigError(`npm 依赖不能超过 ${MAX_PLAYGROUND_DEPENDENCIES} 个`);
  }
  for (const [name, version] of entries) {
    if (
      !PACKAGE_NAME.test(name) ||
      name.length > 214 ||
      typeof version !== "string" ||
      version.length > 100 ||
      !PACKAGE_VERSION.test(version)
    ) {
      throw new PlaygroundConfigError(`无效的 npm 依赖：${name}`);
    }
  }
  return Object.fromEntries(entries) as Record<string, string>;
};

export const createDefaultConfig = (template: PlaygroundKind = "react"): PlaygroundConfig => {
  if (template === "vanilla") {
    return {
      version: 1,
      title: "Live Code Playground",
      template,
      run: "manual",
      view: "preview",
      showFiles: true,
      showPreview: true,
      showConsole: false,
      entry: "/index.html",
      activeFile: "/index.html",
      dependencies: {},
      files: [
        {
          path: "/index.html",
          label: "index.html",
          language: "html",
          hidden: false,
          readOnly: false,
          code: '<main id="app"></main>\n<link rel="stylesheet" href="/styles.css" />\n<script type="module" src="/index.js"></script>',
        },
        {
          path: "/index.js",
          label: "index.js",
          language: "javascript",
          hidden: false,
          readOnly: false,
          code: 'const app = document.querySelector("#app");\napp.innerHTML = "<h1>Playground 已就绪</h1><p>修改源码后点击运行。</p>";\nconsole.log("Playground ready");',
        },
        {
          path: "/styles.css",
          label: "styles.css",
          language: "css",
          hidden: false,
          readOnly: false,
          code: 'body { margin: 0; min-height: 100vh; display: grid; place-items: center; color: #f4f4f5; background: #09090b; font-family: system-ui; }\nmain { width: min(420px, calc(100% - 32px)); padding: 32px; border: 1px solid #3f3f46; border-radius: 18px; background: #18181b; }',
        },
      ],
    };
  }

  return {
    version: 1,
    title: "Live Code Playground",
    template,
    run: "manual",
    view: "preview",
    showFiles: true,
    showPreview: true,
    showConsole: false,
    entry: "/index.js",
    activeFile: "/App.jsx",
    dependencies: { react: "18.3.1", "react-dom": "18.3.1" },
    files: [
      {
        path: "/App.jsx",
        label: "App.jsx",
        language: "jsx",
        hidden: false,
        readOnly: false,
        code: 'import React, { useState } from "react";\n\nexport default function App() {\n  const [count, setCount] = useState(0);\n  return (\n    <main>\n      <p className="eyebrow">LIVE PLAYGROUND</p>\n      <h1>从这里开始编写</h1>\n      <p>修改源码后点击运行。</p>\n      <button onClick={() => setCount((value) => value + 1)}>点击 {count} 次</button>\n    </main>\n  );\n}',
      },
      {
        path: "/index.js",
        label: "index.js",
        language: "jsx",
        hidden: true,
        readOnly: true,
        code: 'import React from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./styles.css";\n\ncreateRoot(document.getElementById("root")).render(<App />);',
      },
      {
        path: "/styles.css",
        label: "styles.css",
        language: "css",
        hidden: false,
        readOnly: false,
        code: 'html, body, #root { min-height: 100%; margin: 0; }\nbody { display: grid; place-items: center; color: #f4f4f5; background: #09090b; font-family: system-ui; }\nmain { width: min(420px, calc(100% - 32px)); padding: 32px; border: 1px solid #3f3f46; border-radius: 18px; background: #18181b; box-shadow: 0 24px 60px #0008; }\n.eyebrow { color: #34d399; font-size: 12px; font-weight: 700; letter-spacing: .14em; }\nbutton { border: 0; border-radius: 999px; padding: 11px 18px; color: #09090b; background: linear-gradient(90deg, #d6ed55, #34d399, #38bdf8); font: inherit; font-weight: 700; cursor: pointer; }',
      },
    ],
  };
};

export const normalizePlaygroundConfig = (value: unknown): PlaygroundConfig => {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Partial<PlaygroundConfig>)
    : {};
  const template: PlaygroundKind = input.template === "vanilla" ? "vanilla" : "react";
  const fallback = createDefaultConfig(template);
  const seen = new Set<string>();
  if (Array.isArray(input.files) && input.files.length > MAX_PLAYGROUND_FILES) {
    throw new PlaygroundConfigError(`Playground 文件不能超过 ${MAX_PLAYGROUND_FILES} 个`);
  }
  let totalSourceLength = 0;
  const files = Array.isArray(input.files)
    ? input.files.map((candidate, index) => {
        if (!candidate || typeof candidate !== "object") {
          throw new PlaygroundConfigError(`第 ${index + 1} 个文件配置无效`);
        }
        const raw = candidate as Partial<PlaygroundFile>;
        const path = normalizeFilePath(raw.path, `/file-${index + 1}.js`);
        if (seen.has(path)) {
          throw new PlaygroundConfigError(`文件路径重复：${path}`);
        }
        seen.add(path);
        const code = typeof raw.code === "string" ? raw.code : "";
        if (code.length > MAX_PLAYGROUND_FILE_CODE_LENGTH) {
          throw new PlaygroundConfigError(
            `文件 ${path} 不能超过 ${MAX_PLAYGROUND_FILE_CODE_LENGTH} 个字符`,
          );
        }
        totalSourceLength += code.length;
        if (totalSourceLength > MAX_PLAYGROUND_TOTAL_SOURCE_LENGTH) {
          throw new PlaygroundConfigError(
            `Playground 源码总量不能超过 ${MAX_PLAYGROUND_TOTAL_SOURCE_LENGTH} 个字符`,
          );
        }
        return {
          path,
          label: typeof raw.label === "string" && raw.label.trim()
            ? raw.label.trim()
            : path.split("/").at(-1) || path,
          language: typeof raw.language === "string" && raw.language.trim()
            ? raw.language.trim()
            : inferLanguage(path),
          code,
          hidden: raw.hidden === true,
          readOnly: raw.readOnly === true,
        };
      })
    : [];
  const safeFiles = files.length ? files : fallback.files;
  const firstPath = safeFiles[0]!.path;
  const firstVisiblePath = safeFiles.find((file) => !file.hidden)?.path || firstPath;
  const entryCandidate = normalizeFilePath(input.entry, fallback.entry);
  const activeCandidate = normalizeFilePath(input.activeFile, fallback.activeFile);
  const activeCandidateFile = safeFiles.find((file) => file.path === activeCandidate);
  const view: PlaygroundView = input.view === "console" ? "console" : "preview";
  const showFiles = typeof input.showFiles === "boolean" ? input.showFiles : true;
  const showPreview = typeof input.showPreview === "boolean" ? input.showPreview : view !== "console";
  const showConsole = typeof input.showConsole === "boolean" ? input.showConsole : view === "console";
  const visibleView: PlaygroundView = view === "console" && showConsole
    ? "console"
    : showPreview
      ? "preview"
      : showConsole
        ? "console"
        : view;

  return {
    version: 1,
    title: typeof input.title === "string"
      ? input.title.trim()
      : fallback.title,
    template,
    run: input.run === "auto" ? "auto" : "manual",
    view: visibleView,
    showFiles,
    showPreview,
    showConsole,
    entry: safeFiles.some((file) => file.path === entryCandidate) ? entryCandidate : firstPath,
    activeFile: activeCandidateFile && !activeCandidateFile.hidden
      ? activeCandidateFile.path
      : firstVisiblePath,
    dependencies: normalizeDependencies(input.dependencies),
    files: safeFiles,
  };
};

export const serializePlaygroundConfig = (value: unknown) =>
  JSON.stringify(normalizePlaygroundConfig(value));

export const parsePlaygroundConfigText = (value: unknown, fallback?: unknown) => {
  if (typeof value === "string" && value.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      // Malformed v0 text never represented a valid project. Fall through to
      // the parsed HTML attribute or default, but do not swallow validation
      // errors from a valid JSON project.
      return normalizePlaygroundConfig(fallback);
    }
    return normalizePlaygroundConfig(parsed);
  }
  return normalizePlaygroundConfig(fallback);
};

export const renderPlaygroundElement = (value: unknown) => {
  const config = normalizePlaygroundConfig(value);
  const root = document.createElement("div");
  root.setAttribute("data-code-playground", "");
  root.dataset.playgroundVersion = String(PLAYGROUND_CONTRACT_VERSION);
  writePlaygroundRootField(
    root,
    "template",
    config.template,
    config.template === "react" ? "create-react-app" : "parcel",
  );
  writePlaygroundRootField(root, "entry", config.entry);
  writePlaygroundRootField(root, "run", config.run);
  writePlaygroundRootField(root, "view", config.view);
  writePlaygroundRootField(root, "title", config.title);
  writePlaygroundRootField(root, "showFiles", String(config.showFiles));
  writePlaygroundRootField(root, "showPreview", String(config.showPreview));
  writePlaygroundRootField(root, "showConsole", String(config.showConsole));
  writePlaygroundRootField(root, "dependencies", JSON.stringify(config.dependencies));

  config.files.forEach((file) => {
    const pre = document.createElement("pre");
    pre.dataset.playgroundFile = file.path;
    pre.dataset.language = file.language;
    pre.dataset.label = file.label;
    if (file.path === config.activeFile) pre.setAttribute("data-active-file", "");
    if (file.hidden) pre.dataset.hiddenFile = "true";
    if (file.readOnly) pre.dataset.readonly = "true";
    const code = document.createElement("code");
    code.className = `language-${file.language}`;
    code.textContent = file.code;
    pre.append(code);
    root.append(pre);
  });
  return root;
};

export const parsePlaygroundElement = (element: HTMLElement) => {
  let dependencies: Record<string, string> = {};
  try {
    dependencies = JSON.parse(
      readPlaygroundRootField(element, "dependencies") || "{}",
    ) as Record<string, string>;
  } catch {
    throw new PlaygroundConfigError("Playground 依赖 JSON 无法解析");
  }
  const fileElements = Array.from(
    element.querySelectorAll<HTMLElement>(PLAYGROUND_FILE_SELECTOR),
  );
  if (!fileElements.length) {
    throw new PlaygroundConfigError("Playground 至少需要一个 data-playground-file 文件");
  }
  const files = fileElements.map((child, index) => {
    const path = requireFilePath(
      child.dataset.playgroundFile || `/file-${index + 1}.js`,
      `第 ${index + 1} 个文件`,
    );
    return {
      path,
      label: child.dataset.label || path.split("/").at(-1) || path,
      language: child.dataset.language || inferLanguage(path),
      code: child.querySelector("code")?.textContent || "",
      hidden: child.dataset.hiddenFile === "true",
      readOnly: child.dataset.readonly === "true",
    };
  });
  const activeIndex = fileElements.findIndex((child) => child.hasAttribute("data-active-file"));
  const entry = requireFilePath(
    readPlaygroundRootField(element, "entry") || files[0]!.path,
    "入口文件",
  );
  const templateValue = readPlaygroundRootField(element, "template");
  let template: PlaygroundKind;
  if (templateValue === "react" || templateValue === "create-react-app") {
    template = "react";
  } else if (templateValue === "vanilla" || templateValue === "parcel" || !templateValue) {
    template = "vanilla";
  } else {
    throw new PlaygroundConfigError(
      `默认编辑器不支持 Playground 模板：${templateValue}`,
    );
  }

  return normalizePlaygroundConfig({
    version: 1,
    title: readPlaygroundRootField(element, "title"),
    template,
    run: readPlaygroundRootField(element, "run"),
    view: readPlaygroundRootField(element, "view"),
    showFiles: readPlaygroundRootField(element, "showFiles") === undefined
      ? undefined
      : readPlaygroundRootField(element, "showFiles") === "true",
    showPreview: readPlaygroundRootField(element, "showPreview") === undefined
      ? undefined
      : readPlaygroundRootField(element, "showPreview") === "true",
    showConsole: readPlaygroundRootField(element, "showConsole") === undefined
      ? undefined
      : readPlaygroundRootField(element, "showConsole") === "true",
    entry,
    activeFile: activeIndex >= 0 ? files[activeIndex]!.path : undefined,
    dependencies,
    files,
  });
};

const sanitizeOpaquePlaygroundElement = (element: HTMLElement) => {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(
    "script, style, iframe, object, embed, base, link, meta, form, input, button, textarea, select, option, video, audio, source, track, canvas, svg, math",
  ).forEach((node) => node.remove());
  const urlAttributes = new Set(["href", "src", "xlink:href", "action", "formaction", "poster"]);
  [clone, ...Array.from(clone.querySelectorAll<HTMLElement>("*"))].forEach((node) => {
    Array.from(node.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      const normalizedUrl = value.replace(/[\u0000-\u0020\u007f]+/g, "");
      if (
        name.startsWith("on") ||
        ["srcdoc", "srcset", "style"].includes(name) ||
        (urlAttributes.has(name) && /^(?:javascript|vbscript|data):/i.test(normalizedUrl))
      ) {
        node.removeAttribute(attribute.name);
      }
    });
    if (node.getAttribute("target") === "_blank") {
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
  return clone;
};

/**
 * Preserve a future or malformed Playground as an opaque editor atom. Active
 * content is stripped, while unknown protocol attributes and static source
 * remain available for a newer plugin version to understand later.
 */
export const serializeOpaquePlaygroundElement = (element: HTMLElement) => {
  if (!element.matches("div[data-code-playground]")) {
    throw new PlaygroundConfigError("不是可保留的 Playground 根元素");
  }
  return sanitizeOpaquePlaygroundElement(element).outerHTML;
};

export const renderOpaquePlaygroundElement = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new PlaygroundConfigError("Playground 原始 HTML 为空");
  }
  const template = document.createElement("template");
  template.innerHTML = value;
  const element = template.content.firstElementChild;
  if (!(element instanceof HTMLElement) || !element.matches("div[data-code-playground]")) {
    throw new PlaygroundConfigError("Playground 原始 HTML 无法还原");
  }
  return sanitizeOpaquePlaygroundElement(element);
};
