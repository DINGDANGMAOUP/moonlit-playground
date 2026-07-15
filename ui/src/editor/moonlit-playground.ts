import {
  Fragment,
  isActive,
  Node,
  ToolboxItem,
  VueNodeViewRenderer,
  type Editor,
  type EditorState,
  type ExtensionOptions,
  type Range,
} from "@halo-dev/richtext-editor";
import { markRaw } from "vue";
import MdiCodeBracesBox from "~icons/mdi/code-braces-box";
import MdiDeleteForeverOutline from "~icons/mdi/delete-forever-outline";
import PlaygroundView from "./PlaygroundView.vue";
import { isSupportedPlaygroundVersion } from "../playground-contract";
import {
  createDefaultConfig,
  parsePlaygroundConfigText,
  parsePlaygroundElement,
  renderOpaquePlaygroundElement,
  renderPlaygroundElement,
  serializeOpaquePlaygroundElement,
} from "../playground-config";

declare module "@halo-dev/richtext-editor" {
  interface Commands<ReturnType> {
    moonlitPlayground: {
      insertMoonlitPlayground: () => ReturnType;
    };
  }
}

const MOONLIT_PLAYGROUND_NODE_NAME = "moonlit_playground";

const MoonlitPlayground = Node.create<ExtensionOptions>({
  name: MOONLIT_PLAYGROUND_NODE_NAME,
  group: "block",
  // Keep accepting the v0 text payload so existing editor documents can be
  // reopened. New and migrated nodes persist the project in attributes only.
  content: "text*",
  atom: true,
  draggable: true,
  selectable: true,
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      config: {
        default: createDefaultConfig("react"),
        rendered: false,
      },
      storageVersion: {
        default: 0,
        rendered: false,
      },
      opaqueHtml: {
        default: null,
        rendered: false,
      },
      collapsed: {
        default: false,
        rendered: false,
      },
    };
  },

  addOptions() {
    return {
      getCommandMenuItems() {
        return {
          priority: 79,
          icon: markRaw(MdiCodeBracesBox),
          title: "代码 Playground",
          keywords: ["playground", "代码", "运行", "预览", "sandbox"],
          command: ({ editor, range }: { editor: Editor; range: Range }) => {
            editor.chain().focus().deleteRange(range).insertMoonlitPlayground().run();
          },
        };
      },
      getToolboxItems({ editor }: { editor: Editor }) {
        return [
          {
            priority: 49,
            component: markRaw(ToolboxItem),
            props: {
              editor,
              icon: markRaw(MdiCodeBracesBox),
              title: "代码 Playground",
              description: "插入可编辑、可运行的多文件代码示例",
              action: () => editor.chain().focus().insertMoonlitPlayground().run(),
            },
          },
        ];
      },
      getBubbleMenu() {
        return {
          pluginKey: "moonlitPlaygroundBubbleMenu",
          shouldShow: ({ state }: { state: EditorState }): boolean =>
            isActive(state, MOONLIT_PLAYGROUND_NODE_NAME),
          items: [
            {
              priority: 100,
              props: {
                icon: markRaw(MdiDeleteForeverOutline),
                title: "删除 Playground",
                action: ({ editor }: { editor: Editor }) => {
                  editor.chain().focus().deleteSelection().run();
                },
              },
            },
          ],
        };
      },
    };
  },

  addCommands() {
    return {
      insertMoonlitPlayground:
        () =>
        ({ commands }) => {
          const config = createDefaultConfig("react");
          return commands.insertContent({
            type: this.name,
            attrs: {
              config,
              storageVersion: 1,
              opaqueHtml: null,
              collapsed: false,
            },
          });
        },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-code-playground]",
        getAttrs: (node) => {
          if (!(node instanceof HTMLElement)) return false;
          if (!isSupportedPlaygroundVersion(node)) {
            return {
              storageVersion: 1,
              opaqueHtml: serializeOpaquePlaygroundElement(node),
              collapsed: false,
            };
          }
          try {
            return {
              config: parsePlaygroundElement(node),
              storageVersion: 1,
              opaqueHtml: null,
              collapsed: false,
            };
          } catch (error) {
            console.warn("[Moonlit Playground] 内容块无法安全解析，已作为静态内容保留", error);
            return {
              storageVersion: 1,
              opaqueHtml: serializeOpaquePlaygroundElement(node),
              collapsed: false,
            };
          }
        },
        getContent: () => Fragment.empty,
      },
    ];
  },

  renderHTML({ node }) {
    if (typeof node.attrs.opaqueHtml === "string") {
      return { dom: renderOpaquePlaygroundElement(node.attrs.opaqueHtml) };
    }
    const config = node.attrs.storageVersion === 1
      ? node.attrs.config
      : parsePlaygroundConfigText(node.textContent, node.attrs.config);
    return { dom: renderPlaygroundElement(config) };
  },

  addNodeView() {
    return VueNodeViewRenderer(PlaygroundView);
  },
});

export default MoonlitPlayground;
