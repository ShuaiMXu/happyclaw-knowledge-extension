# HappyClaw 知识收藏 - Chrome 扩展

将网页内容保存到 HappyClaw 知识库的 Chrome 浏览器扩展。

## 功能

- **快速保存**: 一键保存当前页面 URL、标题和选中的文本
- **分类管理**: 创建、删除分类，保存时选择分类
- **右键菜单**: 右键点击页面或选中文本，通过菜单保存到 HappyClaw
- **快捷键**: `Ctrl+Shift+S`（Mac: `Cmd+Shift+S`）快速保存选中内容
- **标签支持**: 保存时添加自定义标签
- **深色模式**: 自动跟随系统主题
- **连接状态**: 实时显示与 HappyClaw 服务器的连接状态

## 安装

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角的「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本仓库根目录（包含 `manifest.json` 的目录）

## 配置（3 步完事）

### 1. 在 HappyClaw 生成 Token

登录你的 HappyClaw → **设置 → 浏览器扩展** → 点「生成」按钮 → 自动复制到剪贴板。

> Token 只显示一次，生成后立刻回到扩展粘贴。忘了再点一次「重新生成」，旧的会自动失效。

### 2. 在扩展填两个字段

点击扩展图标 → 齿轮图标进入设置：

- **服务器地址**：HappyClaw 的完整 URL，例如 `https://claw.shakaka.xyz`
- **API Token**：上一步复制的 `hc_xxx...`

### 3. 测试连接 → 保存

点「测试连接」看到成功提示，再点「保存设置」即可。

## 使用

### 通过弹窗保存

1. 在网页上选中需要保存的文本（可选）
2. 点击扩展图标打开弹窗
3. 选择分类和添加标签
4. 点击「保存」

### 通过右键菜单保存

1. 在网页上选中文本（或直接右键点击页面）
2. 右键 -> 「保存到 HappyClaw」 -> 选择分类

### 通过快捷键保存

1. 选中文本（可选）
2. 按 `Ctrl+Shift+S`（Mac: `Cmd+Shift+S`）

## 鉴权

扩展通过 `Authorization: Bearer hc_xxx...` 调用 HappyClaw API。Token 是**作用域受限**的（scope=`knowledge`），只能访问 `/api/knowledge/*` 接口，拿不到其它账号权限。Token 可以在 HappyClaw 设置页随时吊销。

## API 端点

扩展调用以下 HappyClaw API（均需 Bearer Token）：

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/knowledge/categories` | 获取分类列表 |
| POST | `/api/knowledge/categories` | 创建分类 |
| DELETE | `/api/knowledge/categories/:id` | 删除分类 |
| POST | `/api/knowledge/clips` | 保存内容片段 |
| GET | `/api/health` | 连通性测试（无需鉴权）|

## 文件结构

```
chrome-extension/
  manifest.json            # 扩展配置（Manifest V3）
  popup/
    popup.html             # 弹窗页面
    popup.js               # 弹窗逻辑
    popup.css              # 样式（含深色模式）
  background/
    service-worker.js      # 后台服务（右键菜单、快捷键、API 调用）
  content/
    content.js             # 内容脚本（页面内 Toast 通知）
  icons/
    icon16.png             # 16x16 图标
    icon48.png             # 48x48 图标
    icon128.png            # 128x128 图标
```

## 技术栈

- Chrome Extension Manifest V3
- 原生 JavaScript（无框架依赖）
- CSS 自定义属性 + 媒体查询深色模式
- Chrome Storage API（设置持久化）
- Chrome Context Menus API（右键菜单）
- Chrome Commands API（快捷键）
