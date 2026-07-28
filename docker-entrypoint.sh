#!/usr/bin/env bash
# ============================================================
# XIN-AI 容器入口脚本 (开发模式: 代码改动实时生效)
#   xin-site  : 8087  vite dev (HMR 热更新)
#   pro-site  : 8088  uvicorn --reload (Python 代码自动重载)
#   abs-site  : 8089  uvicorn --reload (Python 代码自动重载)
#
# 源码通过 docker-compose 卷挂载, 修改宿主机代码后:
#   - xin-site: 浏览器自动刷新 (HMR)
#   - pro-site / abs-site: uvicorn 自动重载 (无需重启容器)
# ============================================================
set -u

APP_ROOT=/app
LOG_DIR="${APP_ROOT}/logs"
mkdir -p "$LOG_DIR"

# ---------- 颜色与日志 ----------
log()  { echo -e "[$(date '+%H:%M:%S')] $*"; }
ok()   { echo -e "[\033[0;32m✓\033[0m] $*"; }
warn() { echo -e "[\033[0;33m!\033[0m] $*"; }
err()  { echo -e "[\033[0;31m✗\033[0m] $*" >&2; }

# ---------- 信号处理: 优雅退出 ----------
CHILD_PIDS=()
cleanup() {
    log "收到退出信号, 停止全部服务..."
    for pid in "${CHILD_PIDS[@]:-}"; do
        kill "$pid" 2>/dev/null || true
    done
    sleep 3
    for pid in "${CHILD_PIDS[@]:-}"; do
        kill -9 "$pid" 2>/dev/null || true
    done
    exit 0
}
trap cleanup INT TERM EXIT

# ---------- 启动单个服务 ----------
start_service() {
    local name=$1
    local port=$2
    local dir=$3
    shift 3
    log "[$name] 启动中... (port ${port})"
    cd "$dir"
    nohup "$@" >"${LOG_DIR}/${name}.log" 2>&1 &
    local pid=$!
    CHILD_PIDS+=("$pid")
    sleep 1.5
    if kill -0 "$pid" 2>/dev/null; then
        ok "[$name] 已启动  PID=${pid}  http://0.0.0.0:${port}"
    else
        err "[$name] 启动失败, 查看日志: ${LOG_DIR}/${name}.log"
        tail -n 20 "${LOG_DIR}/${name}.log" 2>/dev/null || true
        exit 1
    fi
}

# ---------- 等待 PostgreSQL 就绪 ----------
wait_for_postgres() {
    local pg_host="${POSTGRES_HOST:-}"
    local pg_port="${POSTGRES_PORT:-5432}"
    if [ -z "$pg_host" ]; then
        warn "未设置 POSTGRES_HOST, 跳过数据库就绪检查"
        return 0
    fi
    log "等待 PostgreSQL ${pg_host}:${pg_port} 就绪..."
    local retries=30
    while ! python -c "
import socket, sys
s = socket.socket()
s.settimeout(2)
try:
    s.connect(('$pg_host', $pg_port))
    s.close()
except Exception as e:
    sys.exit(1)
" 2>/dev/null; do
        retries=$((retries - 1))
        if [ "$retries" -le 0 ]; then
            warn "PostgreSQL 未就绪, 超时退出等待 (服务仍会启动)"
            return 0
        fi
        sleep 1
    done
    ok "PostgreSQL 已就绪"
}

# ---------- 确保 node_modules 存在 ----------
ensure_node_modules() {
    if [ ! -d "/app/xin-site/node_modules" ]; then
        warn "xin-site/node_modules 不存在, 执行 npm install..."
        cd /app/xin-site && npm install
        ok "npm install 完成"
    fi
}

echo ""
echo "============================================================"
echo "  XIN-AI 三合一容器启动 (开发模式, 代码改动实时生效)"
echo "    xin-site : 8087  (Vite dev 热更新 HMR)"
echo "    pro-site : 8088  (FastAPI + uvicorn --reload)"
echo "    abs-site : 8089  (FastAPI + uvicorn --reload)"
echo "============================================================"
echo ""

# ---------- 前置检查 ----------
ensure_node_modules
wait_for_postgres

# ---------- 启动 pro-site (uvicorn --reload, 代码改动自动重载) ----------
start_service "pro-site" 8088 "${APP_ROOT}/pro-site" \
    python -m uvicorn app.main:app --host 0.0.0.0 --port 8088 --reload --reload-dir app

# ---------- 启动 abs-site (uvicorn --reload) ----------
start_service "abs-site" 8089 "${APP_ROOT}/abs-site" \
    python -m uvicorn app.main:app --host 0.0.0.0 --port 8089 --reload --reload-dir app

# ---------- 启动 xin-site (vite dev 热更新) ----------
# vite.config.js 已配置 server.port=8087, host=0.0.0.0
start_service "xin-site" 8087 "${APP_ROOT}/xin-site" \
    npx vite --port 8087 --host 0.0.0.0 --strictPort

echo ""
ok "全部服务已启动. 日志目录: ${LOG_DIR}/"
echo "  xin-site: ${LOG_DIR}/xin-site.log"
echo "  pro-site: ${LOG_DIR}/pro-site.log"
echo "  abs-site: ${LOG_DIR}/abs-site.log"
echo ""
log "提示: 修改宿主机源码后, 容器内服务会自动重载/热更新, 无需重启容器"

# ---------- 主进程等待: 任一子进程退出则全部停止 ----------
if [ "${#CHILD_PIDS[@]}" -gt 0 ]; then
    wait -n "${CHILD_PIDS[@]}" 2>/dev/null || wait "${CHILD_PIDS[0]}"
    EXIT_CODE=$?
    warn "有服务退出 (exit=$EXIT_CODE), 即将停止全部服务..."
    exit "$EXIT_CODE"
fi
