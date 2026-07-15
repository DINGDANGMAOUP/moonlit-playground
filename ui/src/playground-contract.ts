export const PLAYGROUND_CONTRACT_VERSION = 1 as const;

export const isSupportedPlaygroundVersion = (element: HTMLElement) => {
  const value = element.dataset.playgroundVersion;
  // Missing means the original unversioned HTML contract.
  return value === undefined || value === String(PLAYGROUND_CONTRACT_VERSION);
};

export const PLAYGROUND_SELECTOR = "[data-code-playground]";

/**
 * Nested Playground roots belong to their nearest outer protocol container.
 * In particular, an unsupported future-version root must stay opaque even if
 * its preserved payload contains markup that resembles today's contract.
 */
export const isTopLevelPlaygroundRoot = (element: HTMLElement) =>
  element.matches(PLAYGROUND_SELECTOR) &&
  !element.parentElement?.closest(PLAYGROUND_SELECTOR);

export const PLAYGROUND_FILE_SELECTOR = [
  ":scope > pre[data-playground-file]",
  ":scope > shiki-code > pre[data-playground-file]",
].join(", ");

/**
 * Read-only compatibility for posts authored before the structured contract.
 * New content must use a versioned `[data-code-playground]` root; deliberately
 * avoid a generic sentinel that could turn documentation examples into a live
 * runtime by accident.
 */
export const PLAYGROUND_SENTINEL_PATTERN =
  /^\s*\/\/\s*@moonlit-playground(?:\s+(\{.*\}))?\s*$/;

export const firstContentLine = (value: string) =>
  value.split("\n").find((line) => line.trim()) || "";

const elementsIncludingRoot = (root: ParentNode, selector: string) => {
  const elements = Array.from(root.querySelectorAll<HTMLElement>(selector));
  if (root instanceof HTMLElement && root.matches(selector)) elements.unshift(root);
  return elements;
};

export const hasPlaygroundSentinel = (root: ParentNode = document) =>
  elementsIncludingRoot(root, "pre code, shiki-code code").some(
    (code) =>
      !code.closest(PLAYGROUND_SELECTOR) &&
      PLAYGROUND_SENTINEL_PATTERN.test(firstContentLine(code.textContent || "")),
  );

export const hasPlaygroundContent = (root: ParentNode = document) =>
  elementsIncludingRoot(root, PLAYGROUND_SELECTOR).some(
    (element) =>
      isTopLevelPlaygroundRoot(element) && isSupportedPlaygroundVersion(element),
  ) || hasPlaygroundSentinel(root);

export type PlaygroundRootField =
  | "template"
  | "entry"
  | "run"
  | "view"
  | "title"
  | "showFiles"
  | "showPreview"
  | "showConsole"
  | "dependencies";

const ROOT_ATTRIBUTES: Record<PlaygroundRootField, readonly [string, string]> = {
  template: ["data-playground-template", "data-template"],
  entry: ["data-playground-entry", "data-entry"],
  run: ["data-playground-run", "data-run"],
  view: ["data-playground-view", "data-view"],
  title: ["data-playground-title", "data-title"],
  showFiles: ["data-playground-show-files", "data-show-files"],
  showPreview: ["data-playground-show-preview", "data-show-preview"],
  showConsole: ["data-playground-show-console", "data-show-console"],
  dependencies: ["data-playground-dependencies", "data-dependencies"],
};

export const readPlaygroundRootField = (element: HTMLElement, field: PlaygroundRootField) => {
  const [attribute, legacyAttribute] = ROOT_ATTRIBUTES[field];
  return element.getAttribute(attribute) ?? element.getAttribute(legacyAttribute) ?? undefined;
};

export const readPlaygroundRunMode = (element: HTMLElement): "auto" | "manual" =>
  readPlaygroundRootField(element, "run") === "auto" ? "auto" : "manual";

export const shouldAutoStartPlayground = (
  runMode: "auto" | "manual",
  hasOutput: boolean,
) => runMode === "auto" && hasOutput;

export const writePlaygroundRootField = (
  element: HTMLElement,
  field: PlaygroundRootField,
  value: string,
  legacyValue = value,
) => {
  const [attribute, legacyAttribute] = ROOT_ATTRIBUTES[field];
  element.setAttribute(attribute, value);
  // v1 emits the old attributes as a compatibility bridge for themes that
  // consumed the original Moonlit contract directly.
  element.setAttribute(legacyAttribute, legacyValue);
};
