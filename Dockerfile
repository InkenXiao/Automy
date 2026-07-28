# ============================================================
# XIN-AI 三合一容器镜像 (开发模式: 源码挂载, 改代码无需 rebuild)
#   xin-site  : 8087  (Vite dev 热更新)
#   pro-site  : 8088  (FastAPI + uvicorn --reload)
#   abs-site  : 8089  (FastAPI + uvicorn --reload)
#
# 镜像只安装运行时和依赖, 源码通过 docker-compose 卷挂载
# 仅当依赖变更 (requirements.txt / package.json) 时才需重新 build
# ============================================================

FROM python:3.12-slim

# ---------- 国内镜像加速 ----------
RUN sed -i 's|http://deb.debian.org|https://mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null \
    || sed -i 's|http://deb.debian.org|https://mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list 2>/dev/null \
    || true

RUN mkdir -p /etc/pip \
    && printf '[global]\nindex-url = https://pypi.tuna.tsinghua.edu.cn/simple\ntrusted-host = pypi.tuna.tsinghua.edu.cn\n' > /etc/pip/pip.conf

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# ---------- 系统依赖 ----------
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates xz-utils \
    && rm -rf /var/lib/apt/lists/*

# ---------- Node.js 20 LTS ----------
ARG NODE_VERSION=20.20.2
RUN ARCH=$(dpkg --print-architecture) \
    && case "$ARCH" in \
        amd64) NODE_ARCH=x64 ;; \
        arm64) NODE_ARCH=arm64 ;; \
        *) echo "Unsupported arch: $ARCH" && exit 1 ;; \
    esac \
    && curl -fsSL "https://npmmirror.com/mirrors/node/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" \
        -o /tmp/node.tar.xz \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
    && rm /tmp/node.tar.xz \
    && node --version && npm --version

RUN npm config set registry https://registry.npmmirror.com

WORKDIR /app

# ---------- 1. 安装 Python 依赖 (只 COPY requirements.txt, 源码运行时挂载) ----------
# abs-site 共用 pro-site 的依赖 (均为 FastAPI + SQLAlchemy + Pydantic)
# 显式指定清华镜像, 避免 pip.conf 在某些版本不生效
COPY pro-site/requirements.txt /tmp/requirements.txt
RUN python -m venv /app/venv \
    && /app/venv/bin/pip install -i https://pypi.tuna.tsinghua.edu.cn/simple --upgrade pip \
    && /app/venv/bin/pip install -i https://pypi.tuna.tsinghua.edu.cn/simple -r /tmp/requirements.txt \
    && rm /tmp/requirements.txt

ENV PATH="/app/venv/bin:$PATH"

# ---------- 2. 安装 Node 依赖 (只 COPY package.json, 源码运行时挂载) ----------
# node_modules 由 docker-compose 命名卷保护, 不被源码挂载覆盖
COPY xin-site/package.json xin-site/package-lock.json* /app/xin-site/
RUN cd /app/xin-site && npm install

# ---------- 3. 入口脚本 ----------
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 8087 8088 8089
RUN mkdir -p /app/logs

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:8088/ >/dev/null || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
