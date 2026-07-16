# Moonlit Playground

Moonlit Playground 是一个适用于 Halo 2.25+ 的在线代码示例插件。它在 Halo 默认富文本编辑器中提供可配置的多文件内容块，并在文章前台按需提供源码编辑、Preview 和 Console，无需绑定特定主题。

> **第三方服务提示**
>
> 交互式运行和“在 CodeSandbox 中打开”功能依赖 [CodeSandbox Sandpack](https://sandpack.codesandbox.io/)。运行、预览、刷新或导出示例时，当前 Playground 的源码、文件信息、入口文件、模板类型和 npm 依赖会由访问者的浏览器发送到 CodeSandbox。新建内容默认采用“手动运行”，未运行前不会把源码提交给 CodeSandbox。请勿在示例中放入密码、访问令牌、个人信息、内部接口或私有代码。

![Moonlit Playground 前台运行效果](https://raw.githubusercontent.com/DINGDANGMAOUP/moonlit-playground/main/docs/images/frontend-playground.png)

## 主要功能

- 通过编辑器工具箱或 `/playground` 命令插入内容块
- 提供 React 和原生 HTML / CSS / JavaScript 模板
- 支持多文件、入口文件、npm 依赖、隐藏文件和只读文件
- 使用 CodeMirror 编辑源码，提供 Preview 与 Console 输出
- 支持手动运行、自动运行、刷新、重置和在 CodeSandbox 中打开
- 将配置和源码保存为文章中的版本化 HTML；插件不创建独立数据库表
- 通过 Halo 标准主题扩展点注入前台运行器，不依赖“山月记”或其他指定主题
- 外部服务不可用、JavaScript 被禁用或协议版本不受支持时，保留可阅读的静态源码
- 无 Playground 的页面只加载同源轻量检测器，不下载完整运行器，也不会连接 CodeSandbox

## 环境与兼容性

| 项目 | 要求或说明 |
| --- | --- |
| Halo | `>= 2.25.0` |
| 内容编辑器 | Halo 默认富文本编辑器；ByteMD 不提供新建多文件 Playground 的配置面板 |
| 模板 | React、HTML / CSS / JavaScript |
| 主题 | 遵循 Halo 标准模板渲染流程并原样输出文章 HTML 的主题 |
| 浏览器 | 支持现代 JavaScript、跨域 iframe 和 `postMessage` 的现代浏览器 |
| 交互式运行 | 需要访问 CodeSandbox；仅阅读静态源码不需要 CodeSandbox |
| 全局设置页 | 无；每个 Playground 在文章编辑器中单独配置 |

## 安装、启用与升级

### 从 Halo 应用市场安装

应用上架后，进入 Halo Console 的“插件”页面，在应用市场中搜索 **Moonlit Playground**，安装并启用插件。安装完成后无需创建数据库或填写全局配置。

### 手动安装 JAR

1. 从 [GitHub Releases](https://github.com/DINGDANGMAOUP/moonlit-playground/releases) 获取 JAR，或按“开发与构建”一节从源码构建。
2. 进入 Halo Console → “插件” → “安装插件”。
3. 上传 `moonlit-playground-0.0.1.jar`。
4. 安装完成后点击“启用”。
5. 刷新已打开的文章编辑页，使编辑器加载插件扩展。

已配置 Halo CLI 时，也可以使用：

```bash
halo plugin install \
  --file build/libs/moonlit-playground-0.0.1.jar \
  --yes
halo plugin enable moonlit-playground --force
```

升级时在插件详情页上传新 JAR，或执行：

```bash
halo plugin upgrade moonlit-playground \
  --file build/libs/moonlit-playground-0.0.1.jar \
  --yes
```

### 禁用与卸载

- 禁用插件后，前台不再加载交互式运行器；已发布文章中的结构化源码仍保留为静态内容。
- 插件不创建独立数据库表，禁用或卸载不会主动删除文章中的 Playground 源码和配置。
- 如需从 Halo 删除某个示例，请在编辑器中删除对应内容块并重新保存文章。
- 卸载前建议按站点惯例备份文章。重新编辑包含 Playground 的旧文章时，应先重新安装并启用插件。
- 已通过“在 CodeSandbox 中打开”创建的远程项目不受 Halo 插件生命周期控制；如需删除，必须在 CodeSandbox 侧处理。

## 创建第一个 Playground

1. 确认插件已启用。
2. 进入 Halo Console → “文章”，新建或编辑一篇文章。
3. 确认文章使用的是 **默认编辑器**。
4. 在空白段落输入 `/playground`，选择“代码 Playground”；也可以点击编辑器左侧的 `+`，从工具箱选择“代码 Playground”。
5. 新内容块默认创建一个 **React、手动运行、Preview 输出** 的三文件示例。
6. 在“源码”中切换文件并修改代码；需要时展开“Playground 设置”和“文件与依赖”。
7. 点击“运行”，或切换到 Preview / Console 检查结果。执行这些操作会连接 CodeSandbox，具体数据流见下文。
8. 保存并发布文章。前台访客可查看源码，并在手动模式下自行点击 Run。

![Halo 默认编辑器中的多文件 Playground](https://raw.githubusercontent.com/DINGDANGMAOUP/moonlit-playground/main/docs/images/editor-playground.jpg)

_编辑器中可切换源码、Preview 和 Console；右上角提供运行、重置和在 CodeSandbox 中打开等操作。_

![Playground 的主要配置项](https://raw.githubusercontent.com/DINGDANGMAOUP/moonlit-playground/main/docs/images/playground-settings.jpg)

_每个内容块独立保存标题、运行方式、默认输出和前台可见区域；高级区域用于管理文件、入口和依赖。_

## 配置项

| 配置项 | 新建默认值 | 作用与注意事项 |
| --- | --- | --- |
| 标题 | `Live Code Playground` | 前台界面标题和无障碍名称，最多 120 个字符 |
| 模板 | React | 可切换为 HTML / CSS / JavaScript；切换模板会在确认后替换当前全部文件 |
| 运行方式 | 手动运行 | 手动模式只有在用户操作后连接 CodeSandbox；自动模式会在内容块接近视口时自动连接并运行 |
| 前台默认输出 | Preview | 可选择 Preview 或 Console；对应区域必须已启用 |
| 文件标签 | 显示 | 控制前台是否显示可切换的文件标签 |
| Preview | 显示 | 提供 iframe 预览；在编辑器中切换到 Preview 会启动 CodeSandbox 运行环境 |
| Console | 隐藏 | 显示示例的日志、警告和编译错误 |
| 文件路径 | 由模板生成 | 每个文件路径必须唯一；入口文件必须指向已有文件 |
| 语言 | 按扩展名推断 | 支持 JavaScript、JSX、TypeScript、TSX、HTML 和 CSS 的编辑高亮 |
| 前台隐藏标签 | 关闭 | 仅从文件标签中隐藏；文件仍发布到文章 HTML，也仍会发送到运行环境 |
| 前台只读 | 关闭 | 仅禁止访客在界面中修改；文件仍公开并发送到运行环境 |
| 入口文件 | React 为 `/index.js` | CodeSandbox 运行项目时使用的入口 |
| npm 依赖 | React 与 React DOM | 使用“包名到版本”的 JSON 对象；运行时由 CodeSandbox 环境解析和获取 |

补充操作：

- `⌘/Ctrl + Enter`：运行或更新当前示例。
- “恢复默认代码”：在确认后恢复当前模板的默认文件和源码。
- “刷新预览”：刷新当前运行结果；运行环境尚未启动时会先启动。
- “在 CodeSandbox 中打开”：将当前项目创建为 CodeSandbox 远程项目并打开新页面。
- 前台访客对源码的修改只存在于当前浏览器页面，不会写回 Halo；刷新、重置或离开页面后恢复文章发布时的内容。

## CodeSandbox 外部服务与数据流

### 服务名称与用途

Moonlit Playground 使用 CodeSandbox B.V. 提供的 Sandpack 运行环境，用于安装示例声明的依赖、编译源码、在跨域 iframe 中运行结果，以及按用户操作创建可在 CodeSandbox 打开的远程项目。

当前版本集成 `@codesandbox/sandpack-client` `2.19.8`。运行环境使用 CodeSandbox 的版本化 Sandpack 域名（当前为 `https://2-19-8-sandpack.codesandbox.io/`，升级依赖后可能变化）及相关 `*.codesandbox.io` 服务；导出使用 `https://codesandbox.io/api/v1/sandboxes/define?json=1`。CodeSandbox 运行环境还可能向其运营端点发送运行状态和常规网络元数据；实机验证中可见 `col.csbops.io` 请求。

### 何时发送什么数据

| 阶段或操作 | 接收方 | 发送内容 | 结果 |
| --- | --- | --- | --- |
| 在编辑器中编写并保存，但不运行 | 当前 Halo 站点 | Playground 标题、模板、显示选项、文件路径、完整源码、入口和依赖 | 作为文章内容及版本快照保存在 Halo；不发送给 CodeSandbox |
| 页面没有 Playground | 当前 Halo 站点 | 只加载同源轻量检测器 | 不加载完整运行器，不连接 CodeSandbox |
| 页面有手动 Playground，但尚未操作 | 当前 Halo 站点 | 从插件静态资源加载前台界面 | 不把源码提交给 CodeSandbox |
| 点击 Run、Preview、刷新，或启用自动运行 | CodeSandbox Sandpack 运行环境 | **全部文件的完整源码和路径（包括隐藏、只读文件）**、模板类型、入口文件、当前文件、npm 包名与版本 | 在跨域 iframe 中解析依赖、编译和运行；预览及 Console 消息返回当前页面 |
| 点击“在 CodeSandbox 中打开” | CodeSandbox Sandpack 与 `codesandbox.io` define API | 上述全部项目数据，以及为项目生成的 `package.json` 等运行配置 | CodeSandbox 创建远程项目并返回链接，浏览器在新页面打开 |
| 示例源码自行发起网络请求 | 示例作者指定的任意服务 | 取决于示例代码 | 插件不读取、限制或代理示例自行发起的请求 |

以上请求由作者或访客的浏览器直接访问第三方服务，Halo 后端不会代理源码。跨域预览 iframe 使用 `referrerPolicy="no-referrer"`，但 CodeSandbox 仍可能按其政策处理 IP 地址、浏览器信息、服务日志等常规网络元数据。

插件自身没有广告、推荐、AI 分析、崩溃上报或自建遥测，也不会为了运行 Playground 主动读取或发送 Halo 账户资料、其他文章、附件、数据库、访问日志或站点密钥。CodeSandbox 运行环境自身的日志、遥测、依赖获取、数据保存和子处理方不由本插件控制。

### 保存、删除与第三方规则

- **Halo 内保存：** 源码与配置存放在文章内容及 Halo 生成的版本快照中，保存期限和备份策略由站点管理员控制。
- **本地删除：** 删除内容块并保存文章可删除当前版本中的 Playground；历史版本和备份仍按 Halo 的保留策略存在。
- **临时运行：** CodeSandbox 如何处理或保留运行数据、网络元数据和日志，以其政策为准；本插件无法承诺第三方的保存期限。
- **远程项目：** “在 CodeSandbox 中打开”会创建远程项目。删除 Halo 文章、禁用或卸载插件不会删除该项目，需按 CodeSandbox 提供的能力单独管理。
- **关闭外部处理：** 保持“手动运行”且不点击 Run / Preview / 刷新 / 外部打开，可避免主动提交源码；站点管理员也可禁用插件。当前版本不提供离线运行器或全站 CodeSandbox 开关。

使用前请阅读 CodeSandbox 的 [Privacy Policy](https://codesandbox.io/legal/privacy/) 和 [Terms of Use](https://codesandbox.io/legal/terms)。本插件本身免费，不提供 CodeSandbox 服务账户或 SLA；CodeSandbox 的可用性、地区可达性、账号要求、配额、费用及政策可能独立变化。

## 使用限制与安全说明

| 限制 | 当前值 |
| --- | --- |
| Playground 文件数量 | 最多 24 个 |
| 单文件源码 | 最多 200,000 个字符 |
| 项目源码总量 | 最多 600,000 个字符 |
| npm 依赖 | 最多 32 个 |
| 文件路径 | 最多 180 个字符；禁止 `.`、`..`、控制字符、`?` 和 `#` 路径段 |
| 依赖格式 | 仅接受合法 npm 包名和版本范围；不接受 URL 或 Git 地址 |
| 协议版本 | 当前创作协议为 `1` |

- “隐藏”和“只读”是界面选项，不是保密或访问控制。已发布文章 HTML 中始终包含源码。
- 只应运行可信作者提供的示例。跨域 iframe 降低示例直接访问 Halo 页面上下文的风险，但示例仍可按自身代码访问网络、消耗浏览器资源或展示不可信内容。
- 自动运行会让每位访问到该内容块的访客连接 CodeSandbox。站点管理员和文章作者应根据当地法律、隐私政策和访客预期决定是否启用。
- 第三方服务、依赖源或网络不可用时，交互式运行可能失败；插件会显示错误或超时状态，并尽量保留静态源码。
- JavaScript 被禁用、插件被停用、前台资源加载失败、内容超出安全上限或遇到未来协议版本时，页面不会猜测执行，原始 `<pre><code>` 会保留。
- 严格 CSP 站点至少需要允许实际使用的 CodeSandbox `frame-src` 与 `connect-src`。如果示例本身请求其他 API，还需显式允许对应目标。CodeSandbox 域名可能随 Sandpack 版本变化，升级前应重新核对网络请求。
- 浏览器阻止弹出窗口时，“在 CodeSandbox 中打开”会失败；允许本站弹出窗口后重试。

## 常见问题

| 现象 | 检查方式 |
| --- | --- |
| `/playground` 没有出现 | 确认插件已启用、文章使用默认编辑器，并刷新 Console 页面 |
| 只有源码，没有 Preview / Console | 展开“Playground 设置”，启用对应前台区域并选择有效的默认输出 |
| 点击运行后一直等待或显示超时 | 检查到 `*.codesandbox.io` 的网络、DNS、代理和 CSP；30 秒后可再次点击 Run 重试 |
| npm 依赖安装失败 | 检查依赖 JSON、包名、版本范围和 CodeSandbox 服务状态；URL / Git 依赖不受支持 |
| 前台只显示静态代码 | 检查插件是否启用、主题是否保留 Halo `<head>` 处理流程，以及是否原样输出文章 HTML |
| 无法在 CodeSandbox 中打开 | 允许浏览器弹出窗口，并确认 `codesandbox.io` API 可访问 |
| 访客修改没有保存 | 这是预期行为；前台修改仅用于本次浏览器会话，不会写回文章 |

## 主题接入

第三方主题无需复制插件 JavaScript 或 CSS，只需：

1. 保留 Halo 正常渲染的 `<head>`，不要绕过主题模板处理流程；插件通过 `TemplateHeadProcessor` 注入延迟加载器。
2. 正常输出 Halo 提供的文章 HTML，不移除 `data-code-playground`、`data-playground-*`、`<pre>` 或 `<code>`。
3. 按实际部署为 CodeSandbox 和示例访问的服务配置 CSP。

插件运行器自带明暗配色和布局。主题可通过根元素 CSS 变量做轻量品牌适配：

```css
body [data-code-playground].moonlit-playground {
  --moonlit-playground-accent: var(--theme-accent, #3fa4ff);
  --moonlit-playground-font-sans: inherit;
}
```

常规客户端路由与 PJAX 的节点新增、移除和协议属性变化会自动识别。若主题通过 morph 或节点复用原地替换整个 Playground，可在内容更新完成后触发：

```js
document.dispatchEvent(new Event("moonlit:playground:refresh"));
```

强制刷新会销毁旧实例并重新读取文章 DOM，访客尚未导出或保存到 Halo 的临时编辑会丢失。

## 公开内容协议

新内容使用 `data-playground-version="1"`。根属性使用 `data-playground-*` 命名空间，文件保存为直系 `<pre>` 子节点；Halo 语法高亮生成的单层 `<shiki-code>` 包装也受支持。

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

### 根属性

| 属性 | 值 |
| --- | --- |
| `data-playground-version` | 当前为 `1`；缺失时按旧版无版本协议读取 |
| `data-playground-template` | `react` 或 `vanilla` |
| `data-playground-entry` | 入口文件的绝对项目路径 |
| `data-playground-run` | `auto` 或 `manual` |
| `data-playground-view` | `preview` 或 `console` |
| `data-playground-title` | 无障碍名称和界面标题 |
| `data-playground-show-files` | 是否显示文件标签栏 |
| `data-playground-show-preview` | 是否提供 Preview |
| `data-playground-show-console` | 是否提供 Console |
| `data-playground-dependencies` | npm 依赖名到版本的 JSON 对象 |

### 文件属性

| 属性 | 说明 |
| --- | --- |
| `data-playground-file` | 唯一文件路径，必需 |
| `data-language` | 语法语言标识 |
| `data-label` | 可选显示名称 |
| `data-active-file` | 标记初始打开的文件 |
| `data-hidden-file="true"` | 不显示标签，但仍发布并发送到运行环境 |
| `data-readonly="true"` | 前台只读，但仍发布并发送到运行环境 |

协议版本不是 `1` 时，当前运行器不会猜测或降级解析，前台保留静态 HTML；默认编辑器会将其作为不可编辑的 opaque 内容块保存，并移除可执行标签和事件属性，避免旧插件改写未来协议。

### 兼容旧内容

插件继续只读兼容：

- 缺少 `data-playground-version` 的结构化内容
- `data-template`、`data-entry`、`data-run`、`data-view` 等旧根属性
- 旧代码块第一条非空行中的 `@moonlit-playground` sentinel

sentinel 仅用于读取历史文章，不是新的创作协议。新内容应使用编辑器内容块或结构化 v1 HTML。

## 开发与构建

从源码构建需要 JDK 21。Gradle 会自动准备 Node.js 22.23.1 与 pnpm 11.12.0，用于构建 Halo Console 扩展和前台懒加载资源。

```bash
./gradlew clean build
./gradlew test
```

构建产物位于：

```text
build/libs/moonlit-playground-0.0.1.jar
```

## 支持与反馈

- 问题反馈：[GitHub Issues](https://github.com/DINGDANGMAOUP/moonlit-playground/issues)
- 源代码：[DINGDANGMAOUP/moonlit-playground](https://github.com/DINGDANGMAOUP/moonlit-playground)
- 作者：[dingdangmaoup](https://github.com/dingdangmaoup)

## 授权

[MIT](LICENSE) © 2026 dingdangmaoup。第三方依赖授权见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
