# Storage Scraper

Chrome 扩展：一键查看当前网站的 **localStorage / sessionStorage / Cookies / IndexedDB**，并快速定位 `session_id`、token 等登录相关键值。

类似 [Storage Explorer](https://chromewebstore.google.com/detail/storage-explorer) / Storage Master 的轻量替代。

## 功能

- 分栏查看全部存储，或按 Local / Session / Cookies / IndexedDB 过滤
- 实时搜索 key 与 value
- 「登录相关」一键筛选（匹配 `session_id`、`token`、`jwt`、`auth`、`sid` 等）
- 一键复制键、值、KV 对，或导出当前列表为 JSON
- 登录相关项高亮置顶

## 安装（开发者模式）

1. 打开 Chrome，地址栏进入 `chrome://extensions/`
2. 右上角打开 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择本仓库目录：`storagescraper`
5. 打开任意网站，点击工具栏图标即可使用

## 使用提示

- 在搜索框输入 `session`、`token`、`sid` 等关键词
- 勾选 **登录相关** 可只看可能与登录态有关的项
- 受限页面（`chrome://`、Chrome Web Store、扩展页等）无法注入读取

## 权限说明

| 权限 | 用途 |
|------|------|
| `activeTab` + `scripting` | 在当前页读取 localStorage / sessionStorage / IndexedDB |
| `cookies` | 读取当前站点 Cookie |
| `host_permissions: <all_urls>` | 按当前 URL 查询 Cookie |

数据仅在本地弹窗中展示，不会上传。

## 目录结构

```
storagescraper/
├── manifest.json
├── popup.html
├── popup.css
├── popup.js
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```
