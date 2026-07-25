#!/usr/bin/env bash
# ============================================================
# 三工程统一启动脚本
#   xin-site  : 8087  (Vite 静态站点)
#   pro-site  : 8088  (FastAPI 项目管理工作台)
#   abs-site  : 8089  (FastAPI 艾宾浩斯背单词)
# ============================================================
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${ROOT_DIR}/.logs"
PID_FILE="${LOG_DIR}/services.pid"

mkdir -p "$LOG_DIR"

# ---------- 路径与端口 ----------
XIN_SITE_DIR="${ROOT_DIR}/xin-site"
PRO_SITE_DIR="${ROOT_DIR}/pro-site"
ABS_SITE_DIR="${ROOT_DIR}/abs-site"

PRO_VENV_PY="${PRO_SITE_DIR}/venv/bin/python"

XIN_PORT=8087
PRO_PORT=8088
ABS_PORT=8089

# ---------- 颜色 ----------
RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'
BLUE=$'\033[0;34m'; CYAN=$'\033[0;36m'; NC=$'\033[0m'

log()  { echo -e "[$(date '+%H:%M:%S')] ${CYAN}[$1]${NC} $2"; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
err()  { echo -e "${RED}✗${NC} $1"; }

# ---------- 前置检查 ----------
preflight() {
  command -v npx >/dev/null 2>&1 || { err "未找到 npx，请先安装 Node.js"; exit 1; }
  [ -x "$PRO_VENV_PY" ]          || { err "未找到 pro-site venv: $PRO_VENV_PY"; exit 1; }
  [ -f "${XIN_SITE_DIR}/package.json" ] || { err "未找到 xin-site/package.json"; exit 1; }
  [ -f "${PRO_SITE_DIR}/run.py" ]       || { err "未找到 pro-site/run.py"; exit 1; }
  [ -f "${ABS_SITE_DIR}/run.py" ]       || { err "未找到 abs-site/run.py"; exit 1; }
}

# ---------- 停止占用指定端口的进程 ----------
stop_port() {
  local port=$1 name=$2
  # 从 ss 输出中提取监听该端口的 PID（兼容 ss 不同版本格式）
  local pids
  pids=$(ss -tlnp 2>/dev/null | grep ":${port} " | grep -oE 'pid=[0-9]+' | grep -oE '[0-9]+' | sort -u)
  if [ -n "$pids" ]; then
    warn "${name} 端口 ${port} 已被占用，先停止现有进程..."
    for pid in $pids; do
      kill "$pid" 2>/dev/null          # 先优雅关闭
      pkill -P "$pid" 2>/dev/null      # 杀子进程（如 uvicorn reloader 的子进程）
    done
    sleep 1
    for pid in $pids; do
      kill -9 "$pid" 2>/dev/null       # 仍存活则强杀
      pkill -9 -P "$pid" 2>/dev/null
    done
    ok "${name} 旧进程已停止"
  fi
}

# ---------- 启动单个服务（后台 nohup 托管）----------
start_service() {
  local name=$1 port=$2 dir=$3
  shift 3
  # $@ 为启动命令；先停后启，保证幂等
  stop_port "$port" "$name"
  log "$name" "启动中... (port ${port})"
  # nohup: 忽略 SIGHUP，终端/SSH 关闭后服务继续运行
  # bash -c: $0=_, $1=dir, $2..=命令；先 cd $1 再 shift，最后 exec "$@" 让记录的
  # PID 直接对应服务进程（exec 替换 bash，而非多一层 subshell 包装）
  nohup bash -c 'cd "$1" && shift && exec "$@"' _ "$dir" "$@" \
    >"${LOG_DIR}/${name}.log" 2>&1 &
  local pid=$!
  echo "$pid" >> "$PID_FILE"
  sleep 1.5
  if kill -0 "$pid" 2>/dev/null; then
    ok "${name} 已启动  PID=${pid}  http://localhost:${port}  (日志: .logs/${name}.log)"
  else
    err "${name} 启动失败，查看日志: .logs/${name}.log"
  fi
}

# ---------- 启动全部 ----------
start_all() {
  echo -e "\n${BLUE}══════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}  启动三个工程  (8087 / 8088 / 8089)${NC}"
  echo -e "${BLUE}══════════════════════════════════════════════════${NC}\n"

  : > "$PID_FILE"

  # xin-site : Vite
  start_service "xin-site" "$XIN_PORT" "$XIN_SITE_DIR" \
    npx vite --port "$XIN_PORT" --host 0.0.0.0

  # pro-site : FastAPI (使用自身 venv)
  start_service "pro-site" "$PRO_PORT" "$PRO_SITE_DIR" \
    "$PRO_VENV_PY" run.py

  # abs-site : FastAPI (复用 pro-site venv)
  start_service "abs-site" "$ABS_PORT" "$ABS_SITE_DIR" \
    "$PRO_VENV_PY" run.py

  echo
  log "INFO" "全部已后台启动（nohup 托管，关闭终端不影响运行）"
  echo -e "  ${YELLOW}查看状态:${NC} ./start.sh status"
  echo -e "  ${YELLOW}查看日志:${NC} tail -f .logs/*.log"
  echo -e "  ${YELLOW}停止服务:${NC} ./start.sh stop"
  echo
}

# ---------- 停止全部（基于端口，最可靠）----------
stop_all() {
  log "STOP" "正在停止所有服务..."
  stop_port "$XIN_PORT" "xin-site"
  stop_port "$PRO_PORT" "pro-site"
  stop_port "$ABS_PORT" "abs-site"
  [ -f "$PID_FILE" ] && : > "$PID_FILE"
  ok "所有服务已停止"
}

# ---------- 状态查看 ----------
show_status() {
  echo -e "\n${BLUE}══════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}  服务状态${NC}"
  echo -e "${BLUE}══════════════════════════════════════════════════${NC}"
  local all_running=true
  for svc in "xin-site:$XIN_PORT" "pro-site:$PRO_PORT" "abs-site:$ABS_PORT"; do
    local name="${svc%%:*}" port="${svc##*:}"
    if ss -tln 2>/dev/null | grep -q ":${port} "; then
      ok "${name} (port ${port})  运行中  http://localhost:${port}"
    else
      err "${name} (port ${port})  未运行"
      all_running=false
    fi
  done
  echo
}

# ---------- 用法 ----------
usage() {
  cat <<EOF
${BLUE}用法:${NC} ./start.sh [命令]

${BLUE}命令:${NC}
  start     后台启动三个工程（nohup 托管，先停后启，幂等）  ${YELLOW}[默认]${NC}
  stop      停止三个工程（按端口清理）
  restart   先停止再后台启动
  status    查看各服务运行状态
  help      显示本帮助

${BLUE}示例:${NC}
  ./start.sh            # 后台启动（脚本立即返回，关闭终端不影响服务）
  ./start.sh start      # 同上
  ./start.sh stop       # 停止全部
  ./start.sh restart    # 重启全部
  ./start.sh status     # 查看状态
  tail -f .logs/*.log   # 实时查看日志
EOF
}

# ---------- 主入口：子命令分发 ----------
cmd="${1:-start}"
trap stop_all INT TERM

case "$cmd" in
  start)
    preflight
    start_all          # 后台启动后立即返回，不阻塞终端
    ;;
  stop)
    stop_all
    ;;
  restart)
    stop_all
    preflight
    start_all          # 后台启动后立即返回
    ;;
  status)
    show_status
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    err "未知命令: $cmd"
    usage
    exit 1
    ;;
esac
