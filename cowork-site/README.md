# 玄圃 · 智创 CoWork 统一入口 (cowork-site)

> 「玄圃 · 智创」统一入口静态页，运行在 **8090** 端口。深色科技风单页，三张发光卡片分别跳转三大 CoWork 子系统：
>
> | 卡片 | 子系统 | 端口 | 说明 |
> |------|--------|------|------|
> | 项目 Project Agent | pro-cowork | 8091 | 项目管理智能体工作平台 |
> | 知识 Knowledge Base | rag-cowork | 8092 | 知识库平台（玄圃 · 知识工坊） |
> | 连接 MCP Gateway | mcp-cowork | 8094 | MCP 接口平台（玄圃 · 技链工坊） |
>
> 卡片点击后按当前访问主机名 + 对应端口跳转（`location.hostname:port`），无需配置。

---

## 一、工程说明

本工程为**纯静态单页**（`index.html`，无构建工具、无外部依赖），由原 `xin-site/cowork.html` 独立而来，自 8090 端口单独发布。

```text
cowork-site/
├── index.html      # 统一入口页 (星空背景 + 三卡片跳转 + 鼠标光斑跟随)
├── README.md       # 本文件
└── 操作手册.md      # 面向最终用户的 CoWork 三系统操作手册
```

## 二、启动方式

### Docker 容器（推荐）

由仓库根目录 `docker-compose.yml` 统一编排，容器内以 Python 内置静态服务器发布：

```bash
cd /mnt/data0/ai_deployment/proj/src/xin-ai
docker compose up -d        # 启动 (entrypoint 内: python -m http.server 8090)
```

修改 `index.html` 后**刷新浏览器即可生效**（源码卷挂载，无需重启容器、无需 rebuild）。

### 本地调试

```bash
cd cowork-site
python3 -m http.server 8090 --bind 0.0.0.0
# 访问 http://localhost:8090/
```

## 三、访问地址

| 环境 | 地址 |
|------|------|
| 本机 | http://localhost:8090/ |
| 服务器 | http://<服务器IP>:8090/ |

> 三大子系统的登录账号体系统一：使用**姓名**登录（首次未设密码直接进入，登录后可在页面右上角设置密码）。详见 [操作手册](操作手册.md)。
