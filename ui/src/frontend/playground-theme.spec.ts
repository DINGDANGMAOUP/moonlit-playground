import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const playgroundCss = readFileSync(new URL("./playground.css", import.meta.url), "utf8");

const ruleBody = (selector: string) => {
  const selectorStart = playgroundCss.indexOf(selector);
  if (selectorStart < 0) throw new Error(`Missing CSS selector: ${selector}`);
  const bodyStart = playgroundCss.indexOf("{", selectorStart);
  const bodyEnd = playgroundCss.indexOf("}", bodyStart);
  return playgroundCss.slice(bodyStart + 1, bodyEnd);
};

describe("Playground frontend color schemes", () => {
  it("uses the light palette by default and preserves explicit dark mode", () => {
    expect(ruleBody(".moonlit-playground")).toContain("color-scheme: light");
    expect(
      ruleBody(
        ':where(.dark, .color-scheme-dark, [data-color-scheme="dark"]) .moonlit-playground',
      ),
    ).toContain("color-scheme: dark");
  });

  it("maps auto mode to the dark palette under the system dark preference", () => {
    const mediaStart = playgroundCss.indexOf("@media (prefers-color-scheme: dark)");
    const autoSelector =
      ':where(.color-scheme-auto, [data-color-scheme="auto"]) .moonlit-playground';
    const autoStart = playgroundCss.indexOf(autoSelector);
    expect(mediaStart).toBeGreaterThanOrEqual(0);
    expect(autoStart).toBeGreaterThan(mediaStart);

    const explicitDark = ruleBody(
      ':where(.dark, .color-scheme-dark, [data-color-scheme="dark"]) .moonlit-playground',
    );
    const autoDark = ruleBody(autoSelector);
    [
      "--moonlit-playground-caret",
      "--moonlit-playground-gutter",
      "--moonlit-playground-active-line",
      "--moonlit-playground-selection",
      "--moonlit-playground-syntax-keyword",
      "--moonlit-playground-surface",
      "color-scheme",
    ].forEach((property) => {
      const declaration = explicitDark
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.startsWith(`${property}:`));
      expect(declaration).toBeDefined();
      expect(autoDark).toContain(declaration);
    });
  });

  it("binds CodeMirror chrome to the live palette variables", () => {
    [
      "caret-color: var(--moonlit-playground-caret)",
      "border-left-color: var(--moonlit-playground-caret)",
      "color: var(--moonlit-playground-gutter-text)",
      "background-color: var(--moonlit-playground-active-line)",
      "background-color: var(--moonlit-playground-selection)",
    ].forEach((declaration) => expect(playgroundCss).toContain(declaration));
  });
});
