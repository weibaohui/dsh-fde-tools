# @weibaohui/dsh-fde-tools

dsh 插件 · **FDE 工具箱全家桶**：安装一个插件，带上一批插件。

它本身是个引导器（bootstrap）：装进 profile 后，在侧栏出现「🧰 FDE 工具箱」面板，
列出全家桶成员的安装状态，缺什么点「安装」，宿主侧用 pnpm 补装并把成员追加进
`dsh.profile.bundles`，装完提示重启 dsh 生效。

## 全家桶成员

| 成员 | 说明 |
| --- | --- |
| 📦 [dsh-git-server](https://www.npmjs.com/package/@weibaohui/dsh-git-server) | Git 服务器（内嵌 ts-gogs）：HTTP clone/push、网页端、issue/PR |
| 📁 [dsh-webdav-server](https://www.npmjs.com/package/@weibaohui/dsh-webdav-server) | 共享目录变挂载盘：WebDAV，三平台可挂，令牌认证 |
| 📚 [dsh-kb](https://www.npmjs.com/package/@weibaohui/dsh-kb) | 团队知识库：浏览 / 全文检索 / raw 入料自动蒸馏成文 |
| ⏰ [dsh-tasks](https://www.npmjs.com/package/@weibaohui/dsh-tasks) | 定时任务：cron 到点自动开新 agent 会话干活 |
| 🔁 [dsh-continue](https://www.npmjs.com/package/@weibaohui/dsh-continue) | 自动续跑：会话中断自动退避重试 / 换模型 / 压缩上下文 |
| 🎨 [dsh-settings-ui](https://www.npmjs.com/package/@weibaohui/dsh-settings-ui) | 界面微调：设置窗口大小 / 透明度 / 背景 |
| 🪞 [hermes-loop](https://www.npmjs.com/package/@weibaohui/hermes-loop) | 自动复盘：对话收尾蒸馏经验成可复用技能 |

成员清单在 `src/installer.js` 的 `PACK`，加一行即扩包（`range` 取 npm latest 加 `^`）。

## 安装

```sh
dsh plugin --profile web add @weibaohui/dsh-fde-tools
```

然后重启 dsh，侧栏出现「🧰 FDE 工具箱」，进去补装缺失成员，再重启一次即可。
面板顶部会给可直接复制的重启命令（launchd 守护的机器自动生成 `launchctl kickstart -k …`）。

## 工作原理

- dsh 的插件 = profile `package.json` 的依赖 + `dsh.profile.bundles` 里的加载层；
  纯 npm 依赖聚合带不动子插件（reconcile 只认 profile 直接依赖），
  所以引导器在宿主侧替你执行 `pnpm add <member>@<range>` 并追加 bundles。
- **快照还原**：pnpm 在 profile 里跑 add 有清掉 `link:`/`file:` 依赖的前科，
  安装前把依赖和 bundles 快照到 `<profile>/.fde-tools-install-snapshot.json`，
  装完 diff，丢了就按快照补回再 `pnpm install`（≤2 轮），仍失败则报错并给出快照路径。
- 已在 profile 依赖里的成员（无论 npm / link / github spec）一律跳过，不会覆盖现有安装方式。

### 环境变量

| 变量 | 作用 |
| --- | --- |
| `DSH_FDE_TOOLS_PROFILE` | 手动指名所属 profile（名或绝对路径）；缺省自动扫描 `~/.dsh/profiles` |
| `DSH_FDE_TOOLS_PNPM` | 手动指名 pnpm 可执行文件；缺省按 PATH → `~/.local/bin/pnpm` → 宿主同前缀的 pnpm.cjs 顺序探测 |
| `DSH_HOME` | dsh 主目录（缺省 `~/.dsh`） |

## 开发

```sh
npm run check          # 语法检查
npm test               # node --test（fake pnpm，不碰真 profile）
npm run build:client   # 改了 client/index.js 后必须重建 client/bundle.js
```

真机联调：`dsh plugin --profile web add link:<本仓路径>`，重启 dsh web。

### 发版

GitHub Release（tag 与 package.json version 一致）触发 `.github/workflows/publish.yml`，
走 npm Trusted Publishing（OIDC），无需 token。

## License

MIT
