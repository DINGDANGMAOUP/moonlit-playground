# Moonlit Playground

一个自包含的 Halo 2.25+ 代码 Playground 插件。它为 Halo 默认富文本编辑器注册可配置的多文件内容块，并通过 Halo 标准主题扩展点在文章前台按需加载运行器，不依赖指定主题。

作者：[dingdangmaoup](https://github.com/dingdangmaoup)

## 能力

- 通过编辑器工具箱或 `/playground` 插入内容块
- React 与原生 HTML/CSS/JavaScript 模板
- 多文件、入口文件、npm 依赖、隐藏和只读文件
- 自动或手动运行，以及 Preview / Console 默认视图
- CodeMirror 编辑与 CodeSandbox Sandpack 隔离预览
- 交互增强安全上限：24 个文件、单文件 200,000 字符、总计 600,000 字符；超限内容保留为静态源码而不截断
- 版本化的公开 HTML 协议，并只读兼容旧版结构与历史 Markdown sentinel
- 无 Playground 的页面只执行轻量检测，不下载完整运行器

插件不创建数据库表。配置与源码随 Halo 文章内容及快照持久化。

## 主题接入

第三方主题无需复制插件 JavaScript 或 CSS。主题只需遵循 Halo 的标准约定：

1. 保留由 Halo 渲染的正常 HTML `<head>`，不要绕过 Halo 的主题模板处理流程；`TemplateHeadProcessor` 会向其中注入延迟加载器。
2. 正常输出 Halo 提供的文章 HTML，不移除 `data-code-playground`、`data-playground-*`、`<pre>` 或 `<code>`。
3. 如果站点使用严格 CSP，允许 CodeSandbox Sandpack 实际需要的 `frame-src` 与 `connect-src`。

加载器先检测页面内容，只有发现受支持的 Playground 协议才动态加载运行器。插件运行器自带明暗配色和布局；主题可在 Playground 根元素上覆盖 `--moonlit-playground-accent`、`--moonlit-playground-font-sans`、`--moonlit-playground-font-mono` 等 CSS 变量做轻量品牌适配。

```css
body [data-code-playground].moonlit-playground {
  --moonlit-playground-accent: var(--theme-accent, #3fa4ff);
  --moonlit-playground-font-sans: inherit;
}
```

常规客户端路由与 PJAX 的节点新增/移除，以及协议根或版本属性变化，会由 DOM 观察器自动识别。若主题通过 morph/复用节点的方式原地改写整个 Playground，可在批次完成后触发公开的强制刷新事件：

```js
document.dispatchEvent(new Event("moonlit:playground:refresh"));
```

强制刷新会销毁旧前台实例，并以此时文章 DOM 中的属性和源码重新解析；因此只应在主题完成内容替换后触发，访客尚未运行或保存到文章的临时编辑会被丢弃。

这些样式覆盖是可选项，不应在主题中重新实现 Playground 运行时，也无需为插件增加主题配置项。

如果页面绕过 Halo 主题渲染、JavaScript 被禁用、运行器加载失败，或文章声明了插件尚不支持的新协议版本，原始 `<pre><code>` 仍会保留为可读静态内容。`data-hidden-file` 只是交互界面的显示选项，并不是保密机制。

## 公开内容协议

新内容使用 `data-playground-version="1"`。根属性使用 `data-playground-*` 命名空间，文件保留为直系 `<pre>` 子节点；Halo 语法高亮生成的单层 `<shiki-code>` 包装也受支持。

```html
<div
  data-code-playground
  data-playground-version="1"
  data-playground-template="vanilla"
  data-playground-entry="/index.html"
  data-playground-run="manual"
  data-playground-view="preview"
  data-playground-title="多文件示例"
  data-playground-show-files="true"
  data-playground-show-preview="true"
  data-playground-show-console="false"
  data-playground-dependencies="{}"
>
  <pre
    data-playground-file="/index.html"
    data-language="html"
    data-label="index.html"
    data-active-file
  ><code class="language-html">&lt;main id="app"&gt;&lt;/main&gt;
&lt;script type="module" src="/index.js"&gt;&lt;/script&gt;</code></pre>
  <pre
    data-playground-file="/index.js"
    data-language="javascript"
    data-label="index.js"
  ><code class="language-javascript">document.querySelector("#app").textContent = "Hello";</code></pre>
</div>
```

根属性：

| 属性 | 值 |
| --- | --- |
| `data-playground-version` | 当前为 `1`；缺失时按旧版无版本协议读取 |
| `data-playground-template` | `react` 或 `vanilla` |
| `data-playground-entry` | 入口文件的绝对项目路径 |
| `data-playground-run` | `auto` 或 `manual` |
| `data-playground-view` | `preview` 或 `console` |
| `data-playground-title` | 无障碍名称和界面标题 |
| `data-playground-show-files` | 是否显示文件标签栏 |
| `data-playground-show-preview` | 是否提供 Preview 视图 |
| `data-playground-show-console` | 是否提供 Console 视图 |
| `data-playground-dependencies` | npm 依赖名到版本的 JSON 对象 |

文件属性：

| 属性 | 说明 |
| --- | --- |
| `data-playground-file` | 唯一文件路径，必需 |
| `data-language` | 语法语言标识 |
| `data-label` | 可选的显示名称 |
| `data-active-file` | 标记初始打开的文件 |
| `data-hidden-file="true"` | 不显示在文件标签栏，但仍会发送给运行环境 |
| `data-readonly="true"` | 在 Playground 中只读 |

协议版本不是 `1` 时，当前运行器不会猜测或降级解析，前台保留静态 HTML。默认编辑器也会将其作为不可编辑的 opaque 内容块保留（同时移除可执行标签和事件属性），避免旧插件在保存时改写未来协议。

### 兼容旧内容

插件继续读取以下历史格式：

- 缺少 `data-playground-version` 的结构化内容
- `data-template`、`data-entry`、`data-run`、`data-view` 等旧根属性
- 原有代码块第一条非空行中的 `@moonlit-playground` sentinel

sentinel 只用于读取历史文章，不是公开创作协议。新内容必须使用编辑器内容块或结构化 v1 HTML；插件不会识别通用的 `@code-playground` 文本，避免文档示例被意外变成可执行内容。历史格式示例：

```jsx
// @moonlit-playground {"template":"react","view":"preview","run":"auto","title":"React 示例"}
export default function App() {
  return <main>Hello Playground</main>;
}
```

历史 sentinel 必须位于代码块第一条非空行。结构化 v1 是完整多文件能力的唯一标准交换格式。

编辑器新建内容块默认为 `manual`；只有作者显式改为 `auto`，或访客点击 Run、刷新、重置或导出后，才会创建 CodeSandbox 运行客户端。

## 构建与安装

需要 JDK 21。Gradle 会自动准备 Node.js 22.23.1 与 pnpm 11.12.0，用于构建 Halo Console 扩展和独立的前台懒加载资源。

```bash
./gradlew clean build
halo plugin install --file build/libs/moonlit-playground-0.0.1.jar --yes
halo plugin enable moonlit-playground --force
```

升级已安装插件：

```bash
halo plugin upgrade moonlit-playground \
  --file build/libs/moonlit-playground-0.0.1.jar \
  --yes
```

运行验证：

```bash
./gradlew test
./gradlew build
```

## 隐私与安全

Playground 使用 CodeSandbox Sandpack 的跨域运行服务。运行和导出示例时，源码、依赖信息及运行请求会发送给 CodeSandbox；请先确认其服务条款、隐私政策和所在地区要求。

不要在文章源码、隐藏文件、只读文件或依赖配置中放入密码、访问令牌、个人信息或私有代码。跨域 iframe 能降低示例代码直接访问 Halo 页面上下文的风险，但不能把第三方运行服务变成可信的秘密存储。

## 版本与授权

当前版本：`0.0.1`

[MIT](LICENSE) © 2026 dingdangmaoup。第三方依赖授权见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
