# WebLoom 环境搭建说明

## 1. 目的

本文说明如何为 WebLoom 搭建开发环境，并明确区分：

- 哪些环境是**全局安装**的
- 哪些环境是**构建在当前项目文件夹中的**
- 如何验证环境已经搭建完成

当前项目的技术路径已确定为：

- Chrome 插件
- Manifest V3
- `WXT + React + TypeScript`
- `Dexie + Zustand + Zod + @mozilla/readability`

因此，环境搭建将围绕这个技术栈展开。

## 2. 环境划分总览

## 2.1 全局环境

以下工具建议安装在你的系统中，属于**全局环境**：

- `Git`
- `Node.js`
- `pnpm`
- `Chrome`

说明：

- 这些工具不是只给 WebLoom 用的，而是整个系统都可以复用
- 安装后不放在当前项目文件夹里

## 2.2 项目级环境

以下内容属于**当前项目目录内的环境**，会创建在仓库根目录 `D:\Workspace\WebLoom\webloom` 中：

- `package.json`
- `node_modules/`
- `wxt.config.ts`
- `entrypoints/`
- `src/`
- `tsconfig.json`

说明：

- 这些内容是 WebLoom 项目自己的
- 换一个项目，通常会重新生成一套

## 3. 全局环境安装

## 3.1 Git

用途：

- 拉取代码
- 查看和提交改动

是否全局：

- **全局**

安装建议：

- Windows 直接安装 Git for Windows

验证命令：

```powershell
git --version
```

通过标准：

- 能输出 Git 版本号，例如 `git version 2.x.x`

## 3.2 Node.js

用途：

- 运行前端构建工具
- 安装依赖
- 启动 WXT 开发环境

是否全局：

- **全局**

版本建议：

- 推荐 Node.js `20 LTS`
- 不建议低于 `18`

安装建议：

- Windows 下直接安装 Node.js LTS
- 如果你会频繁切换项目，也可以使用 `nvm-windows`

验证命令：

```powershell
node -v
```

通过标准：

- `node -v` 能输出版本号
- 版本不低于 `18`，推荐 `20 LTS`

示例：

```text
v20.18.0
```

备注：

- `npm` 会随 Node.js 一起安装，但本文后续默认使用 `pnpm` 管理项目

## 3.3 pnpm

用途：

- 安装项目依赖
- 执行项目脚本
- 调用 WXT 初始化命令

是否全局：

- **全局**

安装建议：

优先使用 `corepack`：

```powershell
corepack enable
corepack prepare pnpm@latest --activate
```

如果上面不可用，也可以使用：

```powershell
npm install -g pnpm
```

验证命令：

```powershell
pnpm -v
```

通过标准：

- `pnpm -v` 能输出版本号

## 3.4 Chrome

用途：

- 加载和调试浏览器插件

是否全局：

- **全局**

验证方式：

1. 本机已安装 Chrome
2. 可以打开 `chrome://extensions`

通过标准：

- 能进入扩展管理页面
- 能看到“开发者模式”开关

## 3.5 可选工具

以下不是必须，但强烈建议安装：

- `VS Code / Cursor`

当前建议：

- 第一版统一用 `pnpm`

## 4. 项目目录内环境搭建

## 4.1 目标目录

所有项目级操作都在以下目录中执行：

```text
D:\Workspace\WebLoom\webloom
```

这部分不是全局环境，而是**当前项目目录内环境**。

## 4.2 初始化 WXT 工程

只有在当前仓库**还没有**前端工程骨架时，才需要在仓库根目录初始化。

如果项目目录中**还没有** WXT 工程骨架，建议在项目根目录执行：

```powershell
pnpm dlx wxt@latest init
```

执行时建议选择：

- Framework: `React`
- Language: `TypeScript`

说明：

- 这一步会在当前项目目录中创建插件工程骨架
- 生成内容属于**项目级环境**
- 如果命令提示当前目录非空，WXT 可能直接中止初始化
- 之所以不用 `npm create wxt@latest .`，是因为 npm 会尝试查找 `create-wxt` 包，而该包并不存在

额外说明：

- 如果当前仓库里已经有 `package.json`、`wxt.config.ts`、`entrypoints/`、`src/`，说明工程骨架已经存在，可以**跳过初始化步骤**
- 你当前遇到的 `The directory ... is not empty. Aborted.` 就属于“在非空目录重新初始化”导致的中止

初始化完成后，预期会出现类似文件：

```text
package.json
wxt.config.ts
entrypoints/
src/
public/
tsconfig.json
```

验证方式：

在项目根目录检查是否出现上述文件和目录。

通过标准：

- `package.json` 已生成
- `wxt.config.ts` 已生成
- `entrypoints/` 与 `src/` 已生成

## 4.3 安装项目依赖

如果工程骨架已经存在，下一步就是在项目根目录安装业务依赖：

```powershell
pnpm add dexie zustand zod @mozilla/readability
```

这些依赖属于：

- **项目级环境**

安装后会写入：

- `package.json`
- `pnpm-lock.yaml`
- `node_modules/`

验证命令：

```powershell
pnpm ls dexie zustand zod @mozilla/readability
```

通过标准：

- 命令能正常返回依赖树
- 没有 `missing` 或 `invalid` 报错

## 4.4 安装完成后的目录预期

完成项目初始化后，仓库根目录预计应包含：

```text
docs/
entrypoints/
src/
node_modules/
package.json
pnpm-lock.yaml
wxt.config.ts
tsconfig.json
README.md
LICENSE
```

其中：

- `node_modules/` 是项目级依赖目录
- 它只对当前项目生效，不属于全局安装

## 5. 启动开发环境

## 5.1 启动开发模式

在项目根目录执行：

```powershell
pnpm dev
```

这条命令的作用：

- 启动 WXT 开发模式
- 生成可供 Chrome 加载的开发构建结果

是否全局：

- **不是全局**
- 它依赖当前项目里的 `package.json` 和 `node_modules`

验证标准：

- 命令成功启动，没有依赖缺失错误
- 终端中出现 WXT dev server / build 成功的信息
- 生成开发输出目录

注意：

- 输出目录名称取决于 WXT 版本和配置，常见会在 `.output/` 下

## 5.2 在 Chrome 中加载插件

操作步骤：

1. 打开 `chrome://extensions`
2. 打开右上角“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择 WXT 生成的开发构建目录

说明：

- 这一步不是全局安装
- 只是把当前项目的构建结果临时加载进 Chrome

验证标准：

- Chrome 扩展列表中出现 WebLoom
- 插件没有立即报错或崩溃
- 能看到插件图标或对应入口

## 6. 构建验证

## 6.1 类型检查

在项目根目录执行：

```powershell
pnpm exec tsc --noEmit
```

用途：

- 检查 TypeScript 环境是否正常

验证标准：

- 无类型错误

备注：

- 这是项目级验证，不是全局验证

## 6.2 生产构建

在项目根目录执行：

```powershell
pnpm build
```

用途：

- 验证项目是否能正常打包

验证标准：

- 构建成功
- 输出生产构建目录

## 6.3 扩展加载验证

构建后在 Chrome 中重新加载插件，验证以下项目：

- 插件能被正常识别
- 插件页面能打开
- 没有明显的初始化报错

## 7. 最终验收清单

如果以下项目全部满足，可以认为“环境已搭建完成”。

### 全局环境验收

- `git --version` 成功
- `node -v` 成功
- `pnpm -v` 成功
- Chrome 可正常打开 `chrome://extensions`

### 项目环境验收

- 仓库根目录存在 `package.json`
- 仓库根目录存在 `node_modules/`
- 仓库根目录存在 `wxt.config.ts`
- 仓库根目录存在 `entrypoints/`
- 仓库根目录存在 `src/`

### 构建验收

- `pnpm dev` 能启动
- `pnpm build` 能成功
- Chrome 能加载插件构建目录

## 8. 常见问题

## 8.1 `node` 或 `pnpm` 不能识别

原因通常是：

- Node.js 未安装
- 安装后终端未重启
- 系统 PATH 未更新
- `pnpm` 尚未通过 `corepack` 或全局安装启用

处理方式：

1. 关闭并重新打开终端
2. 重新执行 `node -v`
3. 重新执行 `pnpm -v`
4. 如仍失败，重新安装 Node.js 或重新启用 `pnpm`

## 8.2 `pnpm dlx wxt@latest init` 初始化失败

常见原因：

- 当前目录非空导致脚手架要求确认
- 网络问题导致拉取失败
- 把命令误写成 `npm create wxt@latest .`
- 当前项目已经有工程骨架，却重复执行初始化

处理方式：

1. 确认使用的是 `pnpm dlx wxt@latest init`
2. 如果目录非空且已经存在工程骨架，直接跳过初始化
3. 如网络不稳定，可切换镜像后重试
4. 如果看到 `create-wxt` 相关 `404`，说明是命令写法不对，不是项目目录损坏
5. 如果看到 `The directory ... is not empty. Aborted.`，说明是目录非空触发了初始化中止，不是 `pnpm` 本身的问题

## 8.3 Chrome 无法加载扩展

常见原因：

- 选择了错误目录
- 开发构建尚未生成
- Manifest 配置不完整

处理方式：

1. 确认 `pnpm dev` 或 `pnpm build` 已成功
2. 确认选择的是 WXT 的输出目录，而不是仓库根目录

## 9. 推荐的实际执行顺序

建议你按这个顺序操作：

1. 安装 Git
2. 安装 Node.js 20 LTS
3. 启用并验证 `pnpm`
4. 安装 Chrome
5. 检查 `D:\Workspace\WebLoom\webloom` 是否已经存在 WXT 工程骨架
6. 如果未初始化，则执行 `pnpm dlx wxt@latest init`
7. 安装业务依赖
8. 运行 `pnpm dev`
9. 在 Chrome 中加载开发构建目录
10. 运行 `pnpm build` 做最终验证

## 10. 一句话区分

为了避免混淆，可以这样理解：

- `Git / Node.js / pnpm / Chrome` 是**全局环境**
- `package.json / node_modules / pnpm-lock.yaml / WXT 工程文件 / 业务依赖` 是**当前项目文件夹内环境**

