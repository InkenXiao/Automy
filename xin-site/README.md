# Automy 奥托迈 · 静态文档与原型站点

> 企业级自主智能体平台 · 让 AI 成为每位员工的长期伙伴

本仓库为「Automy 奥托迈」企业级智能体平台的需求文档、技术架构设计文档与高保真产品原型静态网站,面向投资公司内部使用。

## 技术栈

- **构建**: Vite 5 (仅做静态打包,无框架运行时)
- **页面**: 纯 HTML5 + CSS3 + 原生 JavaScript (ES6+)
- **图表**: Mermaid.js (CDN 引入)
- **部署**: Cloudflare Pages

## 目录结构

```
automy-site/
  index.html                # 首页
  404.html                  # 404 页面
  vite.config.js
  package.json
  wrangler.toml             # Cloudflare Pages 配置
  README.md
  /assets
    /css                    # style.css / components.css / prototype.css
    /js                     # app.js / router.js / theme.js / search.js / prototype.js
    /img
    /data                   # mock JSON 数据 (技能/专家/MCP/记忆/审计/文档/模型/路线图/术语/搜索索引)
  /docs
    /requirements           # 12 个需求模块
    /architecture           # 10 个架构章节
  /prototype
    /auth /workspace /skill-market /expert-market /mcp /knowledge /profile /admin
  /shared
    /components.html        # 通用组件示例页
```

## 本地预览

```bash
# 安装依赖
npm install

# 启动开发服务器 (默认端口 5173)
npm run dev

# 构建生产版本
npm run build

# 预览构建产物
npm run preview
```

浏览器访问 `http://localhost:5173` 即可查看首页。

## 页面路由

通过 Hash 路由访问各模块,例如:

- 首页: `http://localhost:5173/`
- 需求文档: `http://localhost:5173/#/docs/requirements/overview`
- 技术架构: `http://localhost:5173/#/docs/architecture/overview`
- 产品原型: `http://localhost:5173/#/prototype/workspace`
- 通用组件: `http://localhost:5173/shared/components.html`

## 主题切换

- 通过顶栏右上角按钮切换深色/浅色模式
- 默认浅色模式
- 主题选择存储于 `localStorage`,键名 `automy-theme`

## 部署到 Cloudflare Pages

1. 构建项目: `npm run build`
2. 安装 Wrangler CLI: `npm install -g wrangler`
3. 登录: `npx wrangler login`
4. 部署: `npx wrangler pages deploy dist`

或在 Cloudflare Pages 控制台配置:

- 构建命令: `npm run build`
- 输出目录: `dist`
- Node 版本: 18+

## 浏览器支持

- Chrome / Edge / Firefox / Safari 最新版
- 需要支持 ES2020+ 的浏览器
