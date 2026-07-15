<script setup lang="ts">
import { basicSetup } from "codemirror";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type {
  ClientOptions,
  SandpackClient,
  SandpackMessage,
  SandboxSetup,
} from "@codesandbox/sandpack-client";
import { BlockActionButton, NodeViewWrapper, nodeViewProps } from "@halo-dev/richtext-editor";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import MdiAlertCircleOutline from "~icons/mdi/alert-circle-outline";
import MdiAlertOutline from "~icons/mdi/alert-outline";
import MdiChevronDown from "~icons/mdi/chevron-down";
import MdiDeleteOutline from "~icons/mdi/delete-outline";
import MdiPlus from "~icons/mdi/plus";
import MdiPlay from "~icons/mdi/play";
import MdiRefresh from "~icons/mdi/refresh";
import MdiRestore from "~icons/mdi/restore";
import MdiCancel from "~icons/mdi/cancel";
import MdiCodeBracesBox from "~icons/mdi/code-braces-box";
import MdiShareVariant from "~icons/mdi/share-variant";
import {
  createDefaultConfig,
  MAX_PLAYGROUND_FILE_CODE_LENGTH,
  MAX_PLAYGROUND_FILES,
  MAX_PLAYGROUND_TOTAL_SOURCE_LENGTH,
  normalizeFilePath,
  normalizePlaygroundConfig,
  parsePlaygroundConfigText,
  type PlaygroundConfig,
  type PlaygroundFile,
  type PlaygroundKind,
} from "../playground-config";

const props = defineProps(nodeViewProps);

type RuntimeClient = SandpackClient & {
  getCodeSandboxURL?: () => Promise<{ editorUrl: string }>;
};

const editorHost = ref<HTMLElement>();
const previewFrame = ref<HTMLIFrameElement>();
const isOpaquePlayground = computed(
  () => typeof props.node.attrs.opaqueHtml === "string",
);
const config = ref<PlaygroundConfig>(
  props.node.attrs.storageVersion === 1
    ? normalizePlaygroundConfig(props.node.attrs.config)
    : parsePlaygroundConfigText(props.node.textContent, props.node.attrs.config),
);
const titleDraft = ref(config.value.title);
const titleInputFocused = ref(false);
const activeFilePath = ref(config.value.activeFile);
const dependenciesText = ref(JSON.stringify(config.value.dependencies, null, 2));
const collapsed = ref(Boolean(props.node.attrs.collapsed));
const formError = ref("");
const runtimeStatus = ref("等待预览");
const runtimeState = ref<"idle" | "loading" | "success" | "error" | "dirty">("idle");
const outputView = ref<"preview" | "console">(config.value.view);
const editorSurface = ref<"code" | "preview" | "console">("code");
const previewHeight = ref(320);
const compileInFlight = ref(false);
const consoleEntries = ref<Array<{
  id: string;
  method: string;
  values: string[];
}>>([]);

let editor: EditorView | null = null;
let client: RuntimeClient | null = null;
let unsubscribeClient: (() => void) | null = null;
let initializePromise: Promise<void> | null = null;
let persistTimer = 0;
let previewTimer = 0;
let compileFallbackTimer = 0;
let runtimeGeneration = 0;
let consoleEntrySequence = 0;
let runQueued = false;
let sourceDirty = false;
let destroyed = false;

const playgroundHighlightStyle = HighlightStyle.define([
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "#6e7781" },
  { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword, tags.operatorKeyword], color: "#cf222e" },
  { tag: [tags.tagName, tags.deleted], color: "#116329" },
  { tag: [tags.punctuation, tags.bracket], color: "#57606a" },
  { tag: [tags.definition(tags.variableName), tags.function(tags.variableName)], color: "#8250df" },
  { tag: [tags.propertyName, tags.attributeName], color: "#0550ae" },
  { tag: [tags.string, tags.special(tags.string)], color: "#0a3069" },
  { tag: [tags.number, tags.bool, tags.null], color: "#0550ae" },
  { tag: [tags.typeName, tags.className], color: "#953800" },
  { tag: [tags.operator, tags.special(tags.variableName)], color: "#cf222e" },
  { tag: tags.invalid, color: "#82071e", textDecoration: "underline" },
]);

const activeFile = computed(() =>
  config.value.files.find((file) => file.path === activeFilePath.value) || config.value.files[0],
);
const hasOutput = computed(() => config.value.showPreview || config.value.showConsole);
const shouldStartAutomatically = computed(
  () => hasOutput.value && config.value.run === "auto",
);
const displayTitle = computed(() => config.value.title.trim() || "未命名 Playground");
const editorSummary = computed(() => {
  const template = config.value.template === "react" ? "React" : "HTML / CSS / JavaScript";
  const runMode = config.value.run === "auto" ? "自动运行" : "手动运行";
  return `${template} · ${config.value.files.length} 个文件 · ${runMode}`;
});

const resolveOutputView = (value: PlaygroundConfig) => {
  if (value.view === "console" && value.showConsole) return "console" as const;
  if (value.showPreview) return "preview" as const;
  if (value.showConsole) return "console" as const;
  return value.view;
};

outputView.value = resolveOutputView(config.value);

const cloneConfig = () =>
  normalizePlaygroundConfig(JSON.parse(JSON.stringify(config.value)) as PlaygroundConfig);

const writeConfigToNode = (value: PlaygroundConfig) => {
  if (isOpaquePlayground.value) return;
  const current = normalizePlaygroundConfig(props.node.attrs.config);
  if (
    props.node.attrs.storageVersion === 1 &&
    JSON.stringify(current) === JSON.stringify(value)
  ) return;
  props.updateAttributes({ config: value, storageVersion: 1 });
};

const commitConfig = () => {
  window.clearTimeout(persistTimer);
  persistTimer = 0;
  if (destroyed) return;
  const normalized = cloneConfig();
  config.value = normalized;
  writeConfigToNode(normalized);
};

const persistConfig = () => {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(commitConfig, 120);
};

const languageExtension = (file: PlaygroundFile): Extension => {
  const language = file.language.toLowerCase();
  if (language === "html" || /\.html?$/.test(file.path)) return html();
  if (language === "css" || /\.css$/.test(file.path)) return css();
  return javascript({
    jsx: language === "jsx" || language === "tsx" || /\.[jt]sx$/.test(file.path),
    typescript: language === "typescript" || language === "ts" || language === "tsx" || /\.tsx?$/.test(file.path),
  });
};

const destroyEditor = () => {
  editor?.destroy();
  editor = null;
};

const createEditor = () => {
  destroyEditor();
  const file = activeFile.value;
  if (!editorHost.value || !file) return;
  editor = new EditorView({
    state: EditorState.create({
      doc: file.code,
      extensions: [
        basicSetup,
        languageExtension(file),
        syntaxHighlighting(playgroundHighlightStyle),
        keymap.of([
          {
            key: "Mod-Enter",
            preventDefault: true,
            run: () => {
              void runPreview();
              return true;
            },
          },
        ]),
        EditorState.changeFilter.of((transaction) => {
          if (!transaction.docChanged) return true;
          const nextLength = transaction.newDoc.length;
          const nextTotal = config.value.files.reduce(
            (total, candidate) => total + (candidate === file ? nextLength : candidate.code.length),
            0,
          );
          if (nextLength > MAX_PLAYGROUND_FILE_CODE_LENGTH) {
            formError.value = `源码大小限制：单个文件不能超过 ${MAX_PLAYGROUND_FILE_CODE_LENGTH} 个字符`;
            return false;
          }
          if (nextTotal > MAX_PLAYGROUND_TOTAL_SOURCE_LENGTH) {
            formError.value = `源码大小限制：项目总量不能超过 ${MAX_PLAYGROUND_TOTAL_SOURCE_LENGTH} 个字符`;
            return false;
          }
          if (formError.value.startsWith("源码大小限制：")) formError.value = "";
          return true;
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || destroyed) return;
          const current = activeFile.value;
          if (!current) return;
          current.code = update.state.doc.toString();
          persistConfig();
          schedulePreview();
        }),
        EditorView.domEventHandlers({
          blur: () => {
            commitConfig();
            return false;
          },
        }),
        EditorView.theme({
          "&": { height: "100%", backgroundColor: "#ffffff", color: "#24292f" },
          ".cm-scroller": { overflow: "auto", fontFamily: "inherit" },
          ".cm-content": { caretColor: "#24292f" },
          ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#24292f" },
          ".cm-gutters": {
            backgroundColor: "#f6f8fa",
            borderRight: "1px solid #e5e7eb",
            color: "#8c959f",
          },
          ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "#ddf4ff" },
          ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "#add6ff" },
        }),
      ],
    }),
    parent: editorHost.value,
  });
};

const createSetup = (): SandboxSetup => {
  const normalized = cloneConfig();
  return {
    template: normalized.template === "react" ? "create-react-app" : "parcel",
    entry: normalized.entry,
    dependencies: normalized.dependencies,
    files: Object.fromEntries(
      normalized.files.map((file) => [
        file.path,
        {
          code: file.code,
          active: file.path === normalized.activeFile,
          readOnly: file.readOnly,
        },
      ]),
    ),
  };
};

const formatConsoleValue = (value: unknown) => {
  let output: string;
  if (typeof value === "string") output = value;
  else {
    try {
      const serialized = JSON.stringify(value);
      output = serialized === undefined ? String(value) : serialized;
    } catch {
      output = String(value);
    }
  }
  return output.length > 8_000 ? `${output.slice(0, 8_000)}\n…输出已截断` : output;
};

const appendConsole = (method: string, values: unknown[], id?: string) => {
  const formattedValues = values
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map(formatConsoleValue);
  if (!formattedValues.length) return;
  consoleEntrySequence += 1;
  consoleEntries.value.push({
    id: id || `moonlit-console-${consoleEntrySequence}`,
    method,
    values: formattedValues,
  });
  if (consoleEntries.value.length > 200) {
    consoleEntries.value = consoleEntries.value.slice(-200);
  }
};

const startCompilation = (text: string) => {
  compileInFlight.value = true;
  runtimeState.value = "loading";
  runtimeStatus.value = text;
  window.clearTimeout(compileFallbackTimer);
  compileFallbackTimer = window.setTimeout(() => {
    if (!compileInFlight.value || destroyed) return;
    compileInFlight.value = false;
    runtimeState.value = "error";
    runtimeStatus.value = "运行超时";
    appendConsole("error", ["运行服务响应超时，请检查网络后重试。"]);
    if (config.value.showConsole) outputView.value = "console";
  }, 30_000);
};

const finishCompilation = () => {
  if (!compileInFlight.value) return;
  compileInFlight.value = false;
  window.clearTimeout(compileFallbackTimer);
  compileFallbackTimer = 0;
  if (runQueued && !destroyed) {
    runQueued = false;
    void runPreview();
  }
};

const handleRuntimeMessage = (message: SandpackMessage) => {
  if (message.type === "console") {
    message.log.forEach((entry) => {
      if (entry.method === "clear") {
        consoleEntries.value = [];
        return;
      }
      appendConsole(entry.method, entry.data, entry.id);
    });
    return;
  }
  if (message.type === "resize") {
    previewHeight.value = Math.max(320, Math.min(512, Math.round(message.height)));
    return;
  }
  if (message.type === "status") {
    const labels: Partial<Record<typeof message.status, string>> = {
      initializing: "正在初始化",
      "installing-dependencies": "正在安装依赖",
      transpiling: "正在转译",
      evaluating: "正在运行",
      idle: "已就绪",
      done: "已就绪",
    };
    const finished = message.status === "idle" || message.status === "done";
    const preserveDirty = sourceDirty && config.value.run === "manual";
    if (!preserveDirty) {
      runtimeState.value = finished ? "success" : "loading";
      runtimeStatus.value = labels[message.status] || "正在运行";
    }
    if (finished) finishCompilation();
    return;
  }
  if (message.type === "success") {
    if (!(sourceDirty && config.value.run === "manual")) {
      runtimeState.value = "success";
      runtimeStatus.value = "预览已更新";
    }
    finishCompilation();
    return;
  }
  if (message.type === "done") {
    if (!(sourceDirty && config.value.run === "manual")) {
      runtimeState.value = message.compilatonError ? "error" : "success";
      runtimeStatus.value = message.compilatonError ? "编译失败" : "已就绪";
    }
    finishCompilation();
    return;
  }
  if (message.type === "action" && message.action === "show-error") {
    runtimeState.value = "error";
    runtimeStatus.value = "编译失败";
    const location = `${message.path || activeFilePath.value}${
      message.line ? `:${message.line}${message.column ? `:${message.column}` : ""}` : ""
    }`;
    appendConsole("error", [message.title, location, message.message]);
    if (config.value.showConsole) outputView.value = "console";
    finishCompilation();
  }
};

const initializeRuntime = async () => {
  if (client || destroyed || !previewFrame.value) return;
  if (initializePromise) return initializePromise;
  const generation = runtimeGeneration;
  const frame = previewFrame.value;
  const task = (async () => {
    runtimeState.value = "loading";
    runtimeStatus.value = "正在准备";
    try {
      const { loadSandpackClient } = await import("@codesandbox/sandpack-client");
      const options: ClientOptions = {
        width: "100%",
        height: "100%",
        showLoadingScreen: true,
        showErrorScreen: true,
        showOpenInCodeSandbox: false,
        clearConsoleOnFirstCompile: true,
      };
      const nextClient = await loadSandpackClient(
        frame,
        createSetup(),
        options,
      ) as RuntimeClient;
      if (destroyed || generation !== runtimeGeneration || previewFrame.value !== frame) {
        nextClient.destroy();
        return;
      }
      client = nextClient;
      unsubscribeClient = nextClient.listen((message) => {
        if (generation === runtimeGeneration) handleRuntimeMessage(message);
      });
      startCompilation("正在编译");
      nextClient.updateSandbox(createSetup());
    } catch (error) {
      if (destroyed || generation !== runtimeGeneration) return;
      window.clearTimeout(compileFallbackTimer);
      compileFallbackTimer = 0;
      compileInFlight.value = false;
      unsubscribeClient?.();
      client?.destroy();
      unsubscribeClient = null;
      client = null;
      runtimeState.value = "error";
      runtimeStatus.value = error instanceof Error ? error.message : "预览服务加载失败";
    }
  })();
  initializePromise = task;
  try {
    await task;
  } finally {
    if (initializePromise === task) initializePromise = null;
  }
};

const runPreview = async () => {
  window.clearTimeout(previewTimer);
  previewTimer = 0;
  if (compileInFlight.value && client) {
    runQueued = true;
    runtimeState.value = "dirty";
    runtimeStatus.value = "等待更新";
    return;
  }
  sourceDirty = false;
  runQueued = false;
  consoleEntries.value = [];
  if (!client) {
    await initializeRuntime();
    return;
  }
  startCompilation("正在编译");
  client.updateSandbox(createSetup());
};

const refreshPreview = async () => {
  if (!client) {
    await initializeRuntime();
    return;
  }
  client.dispatch({ type: "refresh" });
};

const openInCodeSandbox = async () => {
  const externalWindow = window.open("about:blank", "_blank");
  if (externalWindow) externalWindow.opener = null;
  try {
    await initializeRuntime();
    if (!client?.getCodeSandboxURL) {
      throw new Error("CodeSandbox export is not available for this Playground.");
    }
    const { editorUrl } = await client.getCodeSandboxURL();
    if (externalWindow) externalWindow.location.replace(editorUrl);
    else throw new Error("浏览器阻止了新窗口，请允许弹出窗口后重试。");
  } catch (error) {
    externalWindow?.close();
    runtimeState.value = "error";
    runtimeStatus.value = error instanceof Error ? error.message : "无法打开 CodeSandbox";
  }
};

const schedulePreview = () => {
  window.clearTimeout(previewTimer);
  sourceDirty = true;
  if (config.value.run === "manual") {
    runtimeState.value = "dirty";
    runtimeStatus.value = "等待运行";
    return;
  }
  runtimeState.value = "dirty";
  runtimeStatus.value = "正在更新";
  previewTimer = window.setTimeout(() => void runPreview(), 650);
};

const destroyRuntime = () => {
  window.clearTimeout(previewTimer);
  window.clearTimeout(compileFallbackTimer);
  runtimeGeneration += 1;
  initializePromise = null;
  compileFallbackTimer = 0;
  compileInFlight.value = false;
  runQueued = false;
  unsubscribeClient?.();
  client?.destroy();
  unsubscribeClient = null;
  client = null;
};

const restartRuntime = async () => {
  destroyRuntime();
  sourceDirty = false;
  consoleEntries.value = [];
  previewHeight.value = 320;
  if (previewFrame.value) previewFrame.value.removeAttribute("src");
  await nextTick();
  if (shouldStartAutomatically.value) {
    await initializeRuntime();
  } else {
    runtimeState.value = "idle";
    runtimeStatus.value = "点击运行后启动";
  }
};

const selectFile = async (path: string) => {
  if (path === activeFilePath.value) return;
  activeFilePath.value = path;
  config.value.activeFile = path;
  commitConfig();
  await nextTick();
  createEditor();
};

const addFile = async () => {
  if (config.value.files.length >= MAX_PLAYGROUND_FILES) {
    formError.value = `Playground 最多支持 ${MAX_PLAYGROUND_FILES} 个文件`;
    return;
  }
  let index = config.value.files.length + 1;
  let path = `/file-${index}.js`;
  while (config.value.files.some((file) => file.path === path)) {
    index += 1;
    path = `/file-${index}.js`;
  }
  config.value.files.push({
    path,
    label: path.slice(1),
    language: "javascript",
    code: "",
    hidden: false,
    readOnly: false,
  });
  config.value.activeFile = path;
  activeFilePath.value = path;
  commitConfig();
  schedulePreview();
  await nextTick();
  createEditor();
};

const removeActiveFile = async () => {
  if (config.value.files.length <= 1) {
    formError.value = "Playground 至少需要一个文件";
    return;
  }
  const current = activeFile.value;
  if (!current) return;
  const nextFiles = config.value.files.filter((file) => file.path !== current.path);
  const nextFile = nextFiles[0]!;
  config.value.files = nextFiles;
  if (config.value.entry === current.path) config.value.entry = nextFile.path;
  config.value.activeFile = nextFile.path;
  activeFilePath.value = nextFile.path;
  formError.value = "";
  commitConfig();
  schedulePreview();
  await nextTick();
  createEditor();
};

const renameActiveFile = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const current = activeFile.value;
  if (!current) return;
  const oldPath = current.path;
  const nextPath = normalizeFilePath(target.value, "");
  if (!nextPath) {
    formError.value = "文件路径无效：不能包含 ..、控制字符、? 或 #，且长度不能超过 180 个字符";
    target.value = oldPath;
    return;
  }
  if (config.value.files.some((file) => file !== current && file.path === nextPath)) {
    formError.value = `文件路径已存在：${nextPath}`;
    target.value = oldPath;
    return;
  }
  current.path = nextPath;
  if (current.label === oldPath.split("/").at(-1)) current.label = nextPath.split("/").at(-1) || nextPath;
  if (config.value.entry === oldPath) config.value.entry = nextPath;
  config.value.activeFile = nextPath;
  activeFilePath.value = nextPath;
  formError.value = "";
  commitConfig();
  schedulePreview();
  await nextTick();
  createEditor();
};

const updateFileMeta = async () => {
  commitConfig();
  schedulePreview();
  await nextTick();
  createEditor();
};

const updateGeneralConfig = () => {
  const resolvedOutput = resolveOutputView(config.value);
  config.value.view = resolvedOutput;
  if (
    (outputView.value === "preview" && !config.value.showPreview) ||
    (outputView.value === "console" && !config.value.showConsole)
  ) {
    outputView.value = resolvedOutput;
  }
  if (
    (editorSurface.value === "preview" && !config.value.showPreview) ||
    (editorSurface.value === "console" && !config.value.showConsole)
  ) {
    editorSurface.value = "code";
  }
  persistConfig();
  if (shouldStartAutomatically.value) {
    void nextTick(initializeRuntime);
  } else {
    if (!hasOutput.value) destroyRuntime();
    runtimeState.value = "idle";
    runtimeStatus.value = hasOutput.value ? "点击运行后启动" : "未启用输出";
  }
};

const updateRunMode = () => {
  persistConfig();
  if (shouldStartAutomatically.value) {
    void nextTick(initializeRuntime);
    return;
  }
  destroyRuntime();
  if (previewFrame.value) previewFrame.value.removeAttribute("src");
  runtimeState.value = "idle";
  runtimeStatus.value = hasOutput.value ? "点击运行后启动" : "未启用输出";
};

const updateTitleDraft = () => {
  config.value.title = titleDraft.value;
  persistConfig();
};

const commitTitleDraft = () => {
  titleInputFocused.value = false;
  titleDraft.value = titleDraft.value.trim().slice(0, 120);
  config.value.title = titleDraft.value;
  commitConfig();
};

const updateSandboxConfig = () => {
  commitConfig();
  schedulePreview();
};

const selectEditorSurface = (view: "code" | "preview" | "console") => {
  if (view === "code") {
    editorSurface.value = view;
    return;
  }
  if (view === "preview" && !config.value.showPreview) return;
  if (view === "console" && !config.value.showConsole) return;
  outputView.value = view;
  editorSurface.value = view;
  if (!client) void nextTick(initializeRuntime);
};

const handleEditorSurfaceKeydown = (event: KeyboardEvent) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tablist = (event.currentTarget as HTMLElement).parentElement;
  const surfaces: Array<"code" | "preview" | "console"> = ["code"];
  if (config.value.showPreview) surfaces.push("preview");
  if (config.value.showConsole) surfaces.push("console");
  const currentIndex = surfaces.indexOf(editorSurface.value);
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? surfaces.length - 1
      : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + surfaces.length) % surfaces.length;
  event.preventDefault();
  selectEditorSurface(surfaces[nextIndex]!);
  void nextTick(() => {
    tablist?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  });
};

const handleFileTabKeydown = (event: KeyboardEvent, path: string) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tablist = (event.currentTarget as HTMLElement).parentElement;
  const currentIndex = config.value.files.findIndex((file) => file.path === path);
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? config.value.files.length - 1
      : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + config.value.files.length)
        % config.value.files.length;
  event.preventDefault();
  void selectFile(config.value.files[nextIndex]!.path).then(() => {
    tablist?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  });
};

const clearConsole = () => {
  consoleEntries.value = [];
};

const updateDependencies = () => {
  try {
    const parsed = JSON.parse(dependenciesText.value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("依赖必须是 JSON 对象");
    }
    const normalized = normalizePlaygroundConfig({ ...config.value, dependencies: parsed });
    config.value.dependencies = normalized.dependencies;
    dependenciesText.value = JSON.stringify(normalized.dependencies, null, 2);
    formError.value = "";
    updateSandboxConfig();
  } catch (error) {
    formError.value = error instanceof Error ? error.message : "依赖 JSON 无效";
  }
};

const changeTemplate = async (event: Event) => {
  const target = event.target as HTMLSelectElement;
  const nextKind = target.value === "vanilla" ? "vanilla" : "react";
  if (nextKind === config.value.template) return;
  if (!window.confirm("切换模板会用新模板替换当前全部文件，是否继续？")) {
    target.value = config.value.template;
    return;
  }
  const next = createDefaultConfig(nextKind);
  next.title = config.value.title;
  next.run = config.value.run;
  next.showFiles = config.value.showFiles;
  next.showPreview = config.value.showPreview;
  next.showConsole = config.value.showConsole;
  next.view = resolveOutputView(config.value);
  config.value = next;
  outputView.value = resolveOutputView(next);
  activeFilePath.value = next.activeFile;
  dependenciesText.value = JSON.stringify(next.dependencies, null, 2);
  formError.value = "";
  commitConfig();
  await nextTick();
  createEditor();
  await restartRuntime();
};

const resetTemplate = async () => {
  if (!window.confirm("确认恢复当前模板的默认文件和代码？")) return;
  const next = createDefaultConfig(config.value.template as PlaygroundKind);
  next.title = config.value.title;
  next.run = config.value.run;
  next.view = config.value.view;
  next.showFiles = config.value.showFiles;
  next.showPreview = config.value.showPreview;
  next.showConsole = config.value.showConsole;
  config.value = next;
  outputView.value = resolveOutputView(next);
  activeFilePath.value = next.activeFile;
  dependenciesText.value = JSON.stringify(next.dependencies, null, 2);
  formError.value = "";
  commitConfig();
  await nextTick();
  createEditor();
  await restartRuntime();
};

const toggleCollapsed = () => {
  collapsed.value = !collapsed.value;
  props.updateAttributes({ collapsed: collapsed.value });
};

watch(
  () => props.node.attrs.config,
  (value) => {
    if (isOpaquePlayground.value) return;
    const next = normalizePlaygroundConfig(value);
    if (!titleInputFocused.value) titleDraft.value = next.title;
    if (JSON.stringify(next) === JSON.stringify(config.value)) return;
    config.value = next;
    outputView.value = resolveOutputView(next);
    activeFilePath.value = next.activeFile;
    dependenciesText.value = JSON.stringify(next.dependencies, null, 2);
    void nextTick(() => {
      createEditor();
      if (next.run === "auto" && (next.showPreview || next.showConsole)) {
        void initializeRuntime();
      } else {
        destroyRuntime();
        runtimeState.value = "idle";
        runtimeStatus.value = next.showPreview || next.showConsole
          ? "点击运行后启动"
          : "未启用输出";
      }
    });
  },
  { deep: true },
);

watch(
  () => props.node.attrs.collapsed,
  (value) => {
    collapsed.value = Boolean(value);
  },
);

onMounted(async () => {
  if (isOpaquePlayground.value) return;
  createEditor();
  writeConfigToNode(config.value);
  if (shouldStartAutomatically.value) {
    await initializeRuntime();
  } else if (hasOutput.value) {
    runtimeStatus.value = "点击运行后启动";
  } else {
    runtimeStatus.value = "仅源码";
  }
});

onBeforeUnmount(() => {
  if (!isOpaquePlayground.value) commitConfig();
  destroyed = true;
  destroyEditor();
  destroyRuntime();
});
</script>

<template>
  <node-view-wrapper
    v-if="isOpaquePlayground"
    class="moonlit-playground-editor is-opaque"
    :class="{ 'is-selected': props.selected }"
    contenteditable="false"
  >
    <header class="moonlit-playground-editor__header">
      <MdiAlertOutline class="moonlit-playground-editor__brand-icon" />
      <div class="moonlit-playground-editor__heading">
        <strong>Playground 内容已静态保留</strong>
        <span>协议版本较新或配置无法安全解析；当前编辑器不会改写它。</span>
      </div>
      <BlockActionButton
        class="moonlit-playground-editor__icon-button is-danger"
        tooltip="删除 Playground"
        aria-label="删除 Playground"
        @click.stop="props.deleteNode"
      >
        <template #icon><MdiDeleteOutline /></template>
      </BlockActionButton>
    </header>
  </node-view-wrapper>
  <node-view-wrapper
    v-else
    class="moonlit-playground-editor"
    :class="{ 'is-selected': props.selected }"
    contenteditable="false"
  >
    <header class="moonlit-playground-editor__header">
      <BlockActionButton
        class="moonlit-playground-editor__collapse"
        tooltip="折叠或展开 Playground"
        :aria-expanded="!collapsed"
        aria-label="折叠或展开 Playground"
        @click.stop="toggleCollapsed"
      >
        <template #icon>
          <MdiChevronDown :class="{ 'is-collapsed': collapsed }" />
        </template>
      </BlockActionButton>
      <MdiCodeBracesBox class="moonlit-playground-editor__brand-icon" />
      <div class="moonlit-playground-editor__heading">
        <strong :class="{ 'is-placeholder': !config.title.trim() }">{{ displayTitle }}</strong>
        <span>{{ editorSummary }}</span>
      </div>
      <span class="moonlit-playground-editor__runtime" :data-state="runtimeState">
        {{ runtimeStatus }}
      </span>
      <button
        v-if="config.run === 'manual'"
        type="button"
        class="moonlit-playground-editor__run"
        :disabled="compileInFlight"
        @click="runPreview"
      >
        <MdiPlay />
        运行
      </button>
      <BlockActionButton
        class="moonlit-playground-editor__icon-button is-danger"
        tooltip="删除 Playground"
        aria-label="删除 Playground"
        @click.stop="props.deleteNode"
      >
        <template #icon><MdiDeleteOutline /></template>
      </BlockActionButton>
    </header>

    <div v-show="!collapsed" class="moonlit-playground-editor__body">
      <div class="moonlit-playground-editor__workspace">
        <div class="moonlit-playground-editor__viewbar">
          <div class="moonlit-playground-editor__view-tabs" role="tablist" aria-label="编辑器视图">
            <button
              type="button"
              role="tab"
              :aria-selected="editorSurface === 'code'"
              :tabindex="editorSurface === 'code' ? 0 : -1"
              @click="selectEditorSurface('code')"
              @keydown="handleEditorSurfaceKeydown"
            >
              源码
            </button>
            <button
              v-if="config.showPreview"
              type="button"
              role="tab"
              :aria-selected="editorSurface === 'preview'"
              :tabindex="editorSurface === 'preview' ? 0 : -1"
              @click="selectEditorSurface('preview')"
              @keydown="handleEditorSurfaceKeydown"
            >
              预览
            </button>
            <button
              v-if="config.showConsole"
              type="button"
              role="tab"
              :aria-selected="editorSurface === 'console'"
              :tabindex="editorSurface === 'console' ? 0 : -1"
              @click="selectEditorSurface('console')"
              @keydown="handleEditorSurfaceKeydown"
            >
              Console
            </button>
          </div>
          <span class="moonlit-playground-editor__active-file">{{ activeFile?.path }}</span>
        </div>

        <section
          v-show="editorSurface === 'code'"
          class="moonlit-playground-editor__source"
          aria-label="Playground 源码"
        >
          <div class="moonlit-playground-editor__filebar">
            <div class="moonlit-playground-editor__tabs" role="tablist" aria-label="代码文件">
              <button
                v-for="file in config.files"
                :key="file.path"
                type="button"
                role="tab"
                :aria-selected="file.path === activeFilePath"
                :tabindex="file.path === activeFilePath ? 0 : -1"
                :title="file.path"
                @click="selectFile(file.path)"
                @keydown="handleFileTabKeydown($event, file.path)"
              >
                {{ file.label }}<small v-if="file.hidden">隐藏</small>
              </button>
            </div>
            <div class="moonlit-playground-editor__toolbar-actions">
              <BlockActionButton
                tooltip="添加文件"
                aria-label="添加文件"
                class="moonlit-playground-editor__source-action"
                @click="addFile"
              >
                <template #icon><MdiPlus /></template>
              </BlockActionButton>
              <BlockActionButton
                tooltip="恢复默认代码"
                aria-label="Reset code"
                class="moonlit-playground-editor__source-action"
                @click="resetTemplate"
              >
                <template #icon><MdiRestore /></template>
              </BlockActionButton>
              <BlockActionButton
                tooltip="在 CodeSandbox 中打开"
                class="moonlit-playground-editor__source-action"
                aria-label="Open in Code Sandbox"
                @click="openInCodeSandbox"
              >
                <template #icon><MdiShareVariant /></template>
              </BlockActionButton>
            </div>
          </div>

          <div class="moonlit-playground-editor__code-frame">
            <div ref="editorHost" class="moonlit-playground-editor__code"></div>
          </div>
        </section>

        <section
          v-show="hasOutput && editorSurface !== 'code'"
          class="moonlit-playground-editor__output"
          aria-label="运行输出"
        >
          <div class="moonlit-playground-editor__outputbar">
            <strong>{{ outputView === "preview" ? "预览结果" : "Console 输出" }}</strong>
            <BlockActionButton
              v-if="outputView === 'preview'"
              tooltip="刷新预览"
              class="moonlit-playground-editor__source-action"
              aria-label="Refresh preview"
              @click="refreshPreview"
            >
              <template #icon><MdiRefresh /></template>
            </BlockActionButton>
            <BlockActionButton
              v-else
              tooltip="清空 Console"
              class="moonlit-playground-editor__source-action"
              aria-label="Clear console"
              @click="clearConsole"
            >
              <template #icon><MdiCancel /></template>
            </BlockActionButton>
          </div>
          <div
            class="moonlit-playground-editor__output-body"
            :style="{ height: `${outputView === 'preview' ? Math.min(previewHeight, 420) : 320}px` }"
          >
            <iframe
              ref="previewFrame"
              :class="{ 'is-hidden-output': outputView !== 'preview' }"
              :title="`${displayTitle} 后台预览`"
              sandbox="allow-scripts allow-same-origin"
              referrerpolicy="no-referrer"
            ></iframe>
            <div
              class="moonlit-playground-editor__console"
              :class="{ 'is-hidden-output': outputView !== 'console' }"
              role="log"
              aria-live="polite"
            >
              <p v-if="!consoleEntries.length" class="moonlit-playground-editor__console-empty">
                Console output will appear here.
              </p>
              <p
                v-for="entry in consoleEntries"
                :key="`${entry.id}-${entry.method}`"
                :data-method="entry.method"
              >
                <MdiAlertOutline
                  v-if="entry.method === 'warn'"
                  class="moonlit-playground-editor__console-icon"
                  aria-hidden="true"
                />
                <MdiAlertCircleOutline
                  v-else-if="entry.method === 'error' || entry.method === 'assert'"
                  class="moonlit-playground-editor__console-icon"
                  aria-hidden="true"
                />
                <span v-for="(value, index) in entry.values" :key="`${entry.id}-${index}`">
                  {{ value }}
                </span>
              </p>
            </div>
          </div>
        </section>
      </div>

      <details class="moonlit-playground-editor__configuration">
        <summary>Playground 设置</summary>
        <div class="moonlit-playground-editor__settings">
          <label class="is-wide">
            <span>标题</span>
            <input
              v-model="titleDraft"
              type="text"
              maxlength="120"
              autocomplete="off"
              placeholder="例如：React 卡片示例"
              @focus="titleInputFocused = true"
              @input="updateTitleDraft"
              @blur="commitTitleDraft"
            />
            <small class="moonlit-playground-editor__field-help">
              清空后可直接重新输入，不会自动恢复默认标题。
            </small>
          </label>
          <label>
            <span>运行方式</span>
            <select v-model="config.run" @change="updateRunMode">
              <option value="auto">自动运行</option>
              <option value="manual">手动运行</option>
            </select>
            <small class="moonlit-playground-editor__field-help">
              运行、预览或导出时，源码与依赖会发送到 CodeSandbox；请勿放入密钥或私密数据。
            </small>
          </label>
          <label>
            <span>前台默认输出</span>
            <select v-model="config.view" @change="updateGeneralConfig">
              <option value="preview" :disabled="!config.showPreview">Preview</option>
              <option value="console" :disabled="!config.showConsole">Console</option>
            </select>
          </label>
          <fieldset class="moonlit-playground-editor__visibility">
            <legend>前台显示</legend>
            <label class="is-check">
              <input v-model="config.showFiles" type="checkbox" @change="updateGeneralConfig" />
              <span>文件标签</span>
            </label>
            <label class="is-check">
              <input v-model="config.showPreview" type="checkbox" @change="updateGeneralConfig" />
              <span>Preview</span>
            </label>
            <label class="is-check">
              <input v-model="config.showConsole" type="checkbox" @change="updateGeneralConfig" />
              <span>Console</span>
            </label>
          </fieldset>
        </div>
      </details>

      <details class="moonlit-playground-editor__advanced">
        <summary>文件与依赖</summary>
        <div class="moonlit-playground-editor__advanced-grid">
          <div v-if="activeFile" class="moonlit-playground-editor__file-settings">
            <div class="moonlit-playground-editor__file-actions">
              <button
                type="button"
                class="moonlit-playground-editor__text-button is-danger"
                @click="removeActiveFile"
              >
                <MdiDeleteOutline /> 删除文件
              </button>
            </div>
            <label>
              <span>路径</span>
              <input :value="activeFile.path" @change="renameActiveFile" />
            </label>
            <label>
              <span>语言</span>
              <select v-model="activeFile.language" @change="updateFileMeta">
                <option value="javascript">JavaScript</option>
                <option value="jsx">JSX</option>
                <option value="typescript">TypeScript</option>
                <option value="tsx">TSX</option>
                <option value="html">HTML</option>
                <option value="css">CSS</option>
              </select>
            </label>
            <label class="is-check">
              <input v-model="activeFile.hidden" type="checkbox" @change="updateGeneralConfig" />
              <span>前台隐藏标签</span>
            </label>
            <label class="is-check">
              <input v-model="activeFile.readOnly" type="checkbox" @change="updateGeneralConfig" />
              <span>前台只读</span>
            </label>
            <small class="moonlit-playground-editor__field-help">
              “隐藏”和“只读”只影响前台交互，发布页面的 HTML 中仍包含源码。
            </small>
          </div>
          <div class="moonlit-playground-editor__advanced-fields">
          <label>
            <span>模板</span>
            <select :value="config.template" @change="changeTemplate">
              <option value="react">React</option>
              <option value="vanilla">HTML / CSS / JavaScript</option>
            </select>
          </label>
          <label>
            <span>入口文件</span>
            <select v-model="config.entry" @change="updateSandboxConfig">
              <option v-for="file in config.files" :key="file.path" :value="file.path">
                {{ file.path }}
              </option>
            </select>
          </label>
          <label>
            <span>npm 依赖（JSON）</span>
            <textarea v-model="dependenciesText" rows="4" spellcheck="false" @change="updateDependencies"></textarea>
          </label>
          </div>
        </div>
      </details>

      <p v-if="formError" class="moonlit-playground-editor__error" role="alert">{{ formError }}</p>
    </div>
  </node-view-wrapper>
</template>

<style scoped>
.moonlit-playground-editor__header,
.moonlit-playground-editor__filebar,
.moonlit-playground-editor__outputbar,
.moonlit-playground-editor__file-actions,
.moonlit-playground-editor__toolbar-actions {
  display: flex;
  align-items: center;
}

.moonlit-playground-editor__collapse,
.moonlit-playground-editor__icon-button,
.moonlit-playground-editor__text-button,
.moonlit-playground-editor__source-action,
.moonlit-playground-editor__run {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.moonlit-playground-editor__collapse svg {
  transition: transform 180ms ease;
}

.moonlit-playground-editor__collapse svg.is-collapsed {
  transform: rotate(-90deg);
}

.moonlit-playground-editor__runtime {
  display: inline-flex;
  align-items: center;
}

.moonlit-playground-editor__runtime::before {
  border-radius: 50%;
  background: currentColor;
  content: "";
}

.moonlit-playground-editor__settings,
.moonlit-playground-editor__advanced-grid,
.moonlit-playground-editor__file-settings,
.moonlit-playground-editor__advanced-fields,
.moonlit-playground-editor label {
  display: grid;
  min-width: 0;
}

.moonlit-playground-editor__heading strong.is-placeholder {
  color: #6b7280;
  font-weight: 500;
}

.moonlit-playground-editor__field-help {
  color: #6b7280;
  font-size: 11px;
  font-weight: 400;
  line-height: 16px;
}

.moonlit-playground-editor input::placeholder {
  color: #9ca3af;
  opacity: 1;
}

.moonlit-playground-editor input,
.moonlit-playground-editor select,
.moonlit-playground-editor textarea {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  font: inherit;
  outline: none;
}

.moonlit-playground-editor textarea {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  resize: vertical;
}

.moonlit-playground-editor__visibility {
  display: flex;
  min-width: 0;
  grid-column: 1 / -1;
  align-items: center;
}

.moonlit-playground-editor label.is-check {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.moonlit-playground-editor__workspace {
  position: relative;
  isolation: isolate;
}

.moonlit-playground-editor__source,
.moonlit-playground-editor__output {
  position: relative;
  z-index: 1;
  min-width: 0;
}

.moonlit-playground-editor__filebar,
.moonlit-playground-editor__outputbar {
  box-sizing: border-box;
  justify-content: space-between;
}

.moonlit-playground-editor__tabs {
  display: flex;
  min-width: 0;
  overflow-x: auto;
}

.moonlit-playground-editor__tabs button {
  position: relative;
  border: 0;
  cursor: pointer;
  white-space: nowrap;
}

.moonlit-playground-editor__code-frame {
  position: relative;
  overflow: hidden;
}

.moonlit-playground-editor__code {
  position: relative;
  z-index: 1;
  overflow: hidden;
}

.moonlit-playground-editor__output-body {
  position: relative;
  overflow: hidden;
}

.moonlit-playground-editor__output iframe,
.moonlit-playground-editor__console {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}

.moonlit-playground-editor__output iframe {
  border: 0;
}

.moonlit-playground-editor__output .is-hidden-output {
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
}

.moonlit-playground-editor__console {
  overflow: auto;
}

.moonlit-playground-editor__console p {
  position: relative;
  z-index: 1;
  display: flex;
  min-width: 0;
  align-items: flex-start;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.moonlit-playground-editor__console p:last-child {
  margin-bottom: 0;
}

.moonlit-playground-editor__console p > span {
  min-width: 0;
  max-width: 100%;
  flex: 0 1 auto;
}

.moonlit-playground-editor__console-icon {
  flex: none;
}

.moonlit-playground-editor__file-settings,
.moonlit-playground-editor__advanced-fields {
  align-content: start;
}

.moonlit-playground-editor__file-actions {
  grid-column: 1 / -1;
}

/* Halo Console native editor treatment. The published theme keeps its own visual language. */
.moonlit-playground-editor {
  --moonlit-playground-accent: rgb(var(--colors-primary, 76 203 160) / 1);
  display: block;
  overflow: hidden;
  margin: 16px 0;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  color: #24292f;
  background: #fff;
  box-shadow: none;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}

.moonlit-playground-editor.is-selected {
  border-color: #2f8ef4;
  box-shadow: 0 0 0 1px #2f8ef4;
}

.moonlit-playground-editor.is-opaque .moonlit-playground-editor__header {
  border-bottom: 0;
}

.moonlit-playground-editor__header {
  min-height: 42px;
  gap: 6px;
  padding: 4px 8px;
  border: 0;
  border-bottom: 1px solid #e5e7eb;
  border-radius: 0;
  color: #24292f;
  background: #f5f5f5;
  box-shadow: none;
}

.moonlit-playground-editor__collapse,
.moonlit-playground-editor__icon-button,
.moonlit-playground-editor__source-action {
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: 4px;
  color: #4b5563;
  background: transparent;
}

.moonlit-playground-editor__collapse:hover,
.moonlit-playground-editor__icon-button:hover,
.moonlit-playground-editor__source-action:hover {
  color: #111827;
  background: #e5e7eb;
}

.moonlit-playground-editor__collapse:active,
.moonlit-playground-editor__icon-button:active,
.moonlit-playground-editor__source-action:active {
  background: #d1d5db;
}

.moonlit-playground-editor__icon-button.is-danger {
  color: #6b7280;
}

.moonlit-playground-editor__icon-button.is-danger:hover {
  color: #b91c1c;
  background: #fef2f2;
}

.moonlit-playground-editor__collapse svg,
.moonlit-playground-editor__icon-button svg,
.moonlit-playground-editor__source-action svg {
  width: 18px;
  height: 18px;
}

.moonlit-playground-editor__brand-icon {
  width: 18px;
  height: 18px;
  flex: none;
  margin: 0 2px;
  color: #4b5563;
}

.moonlit-playground-editor__heading {
  display: grid;
  min-width: 0;
  flex: 1;
  line-height: 1.2;
}

.moonlit-playground-editor__heading strong {
  overflow: hidden;
  color: #111827;
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.moonlit-playground-editor__heading span {
  overflow: hidden;
  color: #6b7280;
  font-size: 11px;
  line-height: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.moonlit-playground-editor__runtime {
  min-height: 24px;
  gap: 6px;
  padding: 0 8px;
  border: 1px solid #e5e7eb;
  border-radius: 999px;
  color: #6b7280;
  background: rgb(255 255 255 / 75%);
  font-size: 11px;
  line-height: 16px;
}

.moonlit-playground-editor__runtime::before {
  width: 6px;
  height: 6px;
}

.moonlit-playground-editor__runtime[data-state="loading"],
.moonlit-playground-editor__runtime[data-state="dirty"] {
  color: #9a6700;
}

.moonlit-playground-editor__runtime[data-state="success"] {
  color: #1a7f37;
}

.moonlit-playground-editor__runtime[data-state="error"] {
  color: #cf222e;
}

.moonlit-playground-editor__run {
  position: static;
  right: auto;
  bottom: auto;
  height: 28px;
  gap: 5px;
  padding: 0 10px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  color: #111827;
  background: #fff;
  box-shadow: none;
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
  transition: background-color 150ms ease, border-color 150ms ease;
}

.moonlit-playground-editor__run:hover {
  border-color: #9ca3af;
  background: #f3f4f6;
  transform: none;
}

.moonlit-playground-editor__run:active {
  background: #e5e7eb;
}

.moonlit-playground-editor__run:disabled {
  cursor: wait;
  opacity: .55;
  transform: none;
}

.moonlit-playground-editor__run svg {
  width: 14px;
  height: 14px;
}

.moonlit-playground-editor__body {
  padding: 0;
}

.moonlit-playground-editor__workspace {
  overflow: hidden;
  border-radius: 0;
  color: #24292f;
  background: #fff;
  box-shadow: none;
}

.moonlit-playground-editor__viewbar {
  display: flex;
  height: 40px;
  box-sizing: border-box;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 4px 8px;
  border-bottom: 1px solid #e5e7eb;
  background: #fff;
}

.moonlit-playground-editor__view-tabs {
  display: inline-flex;
  min-width: 0;
  height: 32px;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 4px;
  background: #f3f4f6;
}

.moonlit-playground-editor__view-tabs button {
  height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: 3px;
  color: #6b7280;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
  white-space: nowrap;
}

.moonlit-playground-editor__view-tabs button:hover {
  color: #111827;
}

.moonlit-playground-editor__view-tabs button[aria-selected="true"] {
  color: #111827;
  background: #fff;
  box-shadow: 0 1px 2px rgb(0 0 0 / 8%);
}

.moonlit-playground-editor__view-tabs button:focus-visible,
.moonlit-playground-editor__tabs button:focus-visible {
  outline: 2px solid rgb(var(--colors-primary, 76 203 160) / 35%);
  outline-offset: 1px;
}

.moonlit-playground-editor__active-file {
  overflow: hidden;
  color: #8c959f;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.moonlit-playground-editor__filebar,
.moonlit-playground-editor__outputbar {
  height: 40px;
  padding: 0 8px;
  border: 0;
  border-bottom: 1px solid #e5e7eb;
  border-radius: 0;
  background: #f9fafb;
  box-shadow: none;
  letter-spacing: 0;
}

.moonlit-playground-editor__outputbar strong {
  color: #374151;
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
}

.moonlit-playground-editor__tabs {
  height: 100%;
  gap: 2px;
  padding: 5px 0;
}

.moonlit-playground-editor__tabs button {
  height: 30px;
  padding: 0 9px;
  border: 1px solid transparent;
  border-radius: 4px;
  color: #4b5563;
  background: transparent;
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
}

.moonlit-playground-editor__tabs button::after {
  display: none;
}

.moonlit-playground-editor__tabs button:hover {
  color: #111827;
  background: #f3f4f6;
}

.moonlit-playground-editor__tabs button[aria-selected="true"] {
  border-color: #d1d5db;
  color: #111827;
  background: #fff;
  box-shadow: 0 1px 2px rgb(0 0 0 / 6%);
}

.moonlit-playground-editor__tabs small {
  margin-left: 5px;
  padding: 1px 4px;
  border-radius: 999px;
  color: #6b7280;
  background: #e5e7eb;
  font-size: 9px;
  font-weight: 500;
}

.moonlit-playground-editor__toolbar-actions {
  gap: 2px;
}

.moonlit-playground-editor__code-frame,
.moonlit-playground-editor__code {
  height: 420px;
  background: #fff;
}

.moonlit-playground-editor__code-frame::before {
  display: none;
}

.moonlit-playground-editor__code {
  color: #24292f;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  font-weight: 400;
  line-height: 21px;
}

.moonlit-playground-editor__output-body {
  min-height: 280px;
  max-height: 420px;
  background: #fff;
  transition: height 180ms ease;
}

.moonlit-playground-editor__output iframe {
  background: #fff;
}

.moonlit-playground-editor__console {
  padding: 16px;
  color: #24292f;
  background: #f8fafc;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
}

.moonlit-playground-editor__console::before {
  display: none;
}

.moonlit-playground-editor__console p {
  gap: 7px;
  margin: 0 0 8px;
}

.moonlit-playground-editor__console-icon {
  width: 15px;
  height: 15px;
  margin-top: 2px;
}

.moonlit-playground-editor__console p[data-method="error"] {
  color: #cf222e;
}

.moonlit-playground-editor__console p[data-method="warn"] {
  color: #9a6700;
}

.moonlit-playground-editor__console-empty {
  color: #6e7781;
}

.moonlit-playground-editor__configuration,
.moonlit-playground-editor__advanced {
  margin: 0;
  border: 0;
  border-top: 1px solid #e5e7eb;
  border-radius: 0;
  color: #24292f;
  background: #fff;
}

.moonlit-playground-editor__configuration summary,
.moonlit-playground-editor__advanced summary {
  min-height: 40px;
  box-sizing: border-box;
  padding: 10px 12px;
  color: #57606a;
  background: #f9fafb;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
}

.moonlit-playground-editor__configuration summary:hover,
.moonlit-playground-editor__advanced summary:hover {
  color: #24292f;
  background: #f3f4f6;
}

.moonlit-playground-editor__configuration[open] summary,
.moonlit-playground-editor__advanced[open] summary {
  border-bottom: 1px solid #e5e7eb;
}

.moonlit-playground-editor__settings {
  grid-template-columns: minmax(180px, 2fr) repeat(2, minmax(120px, 1fr));
  gap: 12px;
  padding: 16px;
}

.moonlit-playground-editor label {
  gap: 6px;
  color: #374151;
  font-size: 12px;
  font-weight: 500;
}

.moonlit-playground-editor input,
.moonlit-playground-editor select,
.moonlit-playground-editor textarea {
  border: 1px solid #d1d5db;
  border-radius: 4px;
  color: #111827;
  background: #fff;
  font-size: 12px;
  font-weight: 400;
}

.moonlit-playground-editor input,
.moonlit-playground-editor select {
  height: 32px;
  padding: 0 9px;
}

.moonlit-playground-editor textarea {
  padding: 9px;
  color: #24292f;
  background: #f8fafc;
}

.moonlit-playground-editor input:focus,
.moonlit-playground-editor select:focus,
.moonlit-playground-editor textarea:focus {
  border-color: var(--moonlit-playground-accent);
  box-shadow: 0 0 0 3px rgb(var(--colors-primary, 76 203 160) / 16%);
}

.moonlit-playground-editor__visibility {
  gap: 16px;
  margin: 0;
  padding: 8px 10px;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  background: #f9fafb;
}

.moonlit-playground-editor__visibility legend {
  padding: 0 4px;
  color: #6b7280;
  font-size: 11px;
  font-weight: 500;
}

.moonlit-playground-editor label.is-check {
  min-height: 28px;
  color: #4b5563;
  font-weight: 400;
}

.moonlit-playground-editor label.is-check input {
  width: 15px;
  height: 15px;
  padding: 0;
  appearance: none;
  border: 1px solid #d1d5db;
  border-radius: 3px;
  background-color: #fff;
  background-position: center;
  background-repeat: no-repeat;
  background-size: 10px 10px;
  accent-color: var(--moonlit-playground-accent);
}

.moonlit-playground-editor label.is-check input:checked {
  border-color: var(--moonlit-playground-accent);
  background-color: var(--moonlit-playground-accent);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='m2.2 6.2 2.3 2.3 5.3-5.3' fill='none' stroke='white' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.8'/%3E%3C/svg%3E");
}

.moonlit-playground-editor label.is-check input:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgb(var(--colors-primary, 76 203 160) / 16%);
}

.moonlit-playground-editor__advanced {
  margin-top: 0;
}

.moonlit-playground-editor__advanced-grid {
  grid-template-columns: minmax(0, 1.35fr) minmax(220px, 1fr);
  gap: 16px;
  padding: 16px;
}

.moonlit-playground-editor__file-settings,
.moonlit-playground-editor__advanced-fields {
  gap: 12px;
}

.moonlit-playground-editor__file-actions {
  gap: 6px;
}

.moonlit-playground-editor__text-button {
  min-height: 28px;
  gap: 5px;
  padding: 0 9px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  color: #4b5563;
  background: #fff;
  font-size: 11px;
}

.moonlit-playground-editor__text-button:hover {
  color: #111827;
  background: #f3f4f6;
}

.moonlit-playground-editor__text-button.is-danger {
  color: #b91c1c;
}

.moonlit-playground-editor__text-button.is-danger:hover {
  background: #fef2f2;
}

.moonlit-playground-editor__error {
  margin: 0;
  padding: 10px 12px;
  border-top: 1px solid #fecaca;
  color: #b91c1c;
  background: #fef2f2;
  font-size: 12px;
}

.moonlit-playground-editor :deep(.cm-editor) {
  height: 100%;
  color: #24292f;
  background: #fff;
}

.moonlit-playground-editor :deep(.cm-editor.cm-focused) {
  outline: none;
}

.moonlit-playground-editor :deep(.cm-scroller) {
  height: 420px;
  padding: 0;
  font-family: inherit;
  line-height: 21px;
}

.moonlit-playground-editor :deep(.cm-content) {
  min-width: max-content;
  padding: 12px 16px;
  caret-color: #24292f;
  line-height: 21px;
}

.moonlit-playground-editor :deep(.cm-line) {
  padding: 0 2px 0 0;
}

.moonlit-playground-editor :deep(.cm-gutters) {
  margin: 0;
  padding: 12px 0;
  border: 0;
  border-right: 1px solid #e5e7eb;
  color: #8c959f;
  background: #f6f8fa;
  font-size: 11px;
  line-height: 21px;
}

.moonlit-playground-editor :deep(.cm-lineNumbers) {
  position: relative;
  margin: 0;
  padding: 0 12px 0 10px;
  overflow: visible;
  color: #8c959f;
  background: #f6f8fa;
  font-size: 11px;
  line-height: 21px;
}

.moonlit-playground-editor :deep(.cm-lineNumbers::before) {
  display: none;
}

.moonlit-playground-editor :deep(.cm-lineNumbers .cm-gutterElement) {
  min-width: 24px;
  padding: 0;
  font-size: 11px;
  line-height: 21px;
  text-align: right;
}

.moonlit-playground-editor :deep(.cm-foldGutter) {
  display: none !important;
}

.moonlit-playground-editor :deep(.cm-activeLine),
.moonlit-playground-editor :deep(.cm-activeLineGutter) {
  border-radius: 0;
  background: #ddf4ff;
}

@media (max-width: 760px) {
  .moonlit-playground-editor__settings,
  .moonlit-playground-editor__advanced-grid {
    grid-template-columns: 1fr 1fr;
  }

  .moonlit-playground-editor__visibility {
    grid-column: 1 / -1;
    flex-wrap: wrap;
  }

  .moonlit-playground-editor__advanced-fields {
    grid-column: 1 / -1;
  }

  .moonlit-playground-editor__filebar,
  .moonlit-playground-editor__outputbar {
    padding-inline: 8px;
  }

  .moonlit-playground-editor__tabs {
    gap: 2px;
  }
}

@media (max-width: 520px) {
  .moonlit-playground-editor__heading span,
  .moonlit-playground-editor__active-file {
    display: none;
  }

  .moonlit-playground-editor__runtime {
    width: 24px;
    box-sizing: border-box;
    justify-content: center;
    overflow: hidden;
    padding: 0;
    color: transparent;
    font-size: 0;
  }

  .moonlit-playground-editor__runtime::before {
    color: #6b7280;
  }

  .moonlit-playground-editor__settings,
  .moonlit-playground-editor__advanced-grid,
  .moonlit-playground-editor__file-settings {
    grid-template-columns: 1fr;
  }

  .moonlit-playground-editor__visibility,
  .moonlit-playground-editor__file-actions,
  .moonlit-playground-editor__advanced-fields {
    grid-column: 1;
  }

  .moonlit-playground-editor__view-tabs button {
    padding-inline: 8px;
  }

  .moonlit-playground-editor__code-frame,
  .moonlit-playground-editor__code,
  .moonlit-playground-editor :deep(.cm-scroller) {
    height: 360px;
  }
}
</style>
