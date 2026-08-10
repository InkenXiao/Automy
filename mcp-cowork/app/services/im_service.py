"""个人 IM 通道发送服务 · 飞书/企微/钉钉/邮箱/OA/Obsidian

各通道 config 字段约定 (前端表单按 CHANNEL_TYPES 渲染):
- feishu:   {webhook, secret?}             自定义机器人, secret 存在则加签
- wecom:    {webhook}                      群机器人
- dingtalk: {webhook, secret?}             群机器人, secret 存在则 URL 加签
- email:    {smtp_host, smtp_port, username, password, to, ssl?}  SMTP 发信
- oa:       {webhook, headers?}            通用 Webhook, POST {"text","from"}
- obsidian: {host, api_key, folder?}       Local REST API, 在 folder 下建笔记
"""
import base64
import hashlib
import hmac
import smtplib
import time
from datetime import datetime
from email.header import Header
from email.mime.text import MIMEText
from typing import Any, Dict, List
from urllib.parse import quote

import httpx

# 通道类型元数据: 前端表单动态渲染依据
CHANNEL_TYPES: List[Dict[str, Any]] = [
    {
        "type": "feishu", "name": "飞书",
        "hint": "群聊 → 设置 → 群机器人 → 自定义机器人, 复制 Webhook 地址",
        "fields": [
            {"key": "webhook", "label": "Webhook 地址", "required": True,
             "placeholder": "https://open.feishu.cn/open-apis/bot/v2/hook/xxx"},
            {"key": "secret", "label": "加签密钥 (可选)", "required": False, "placeholder": "机器人安全设置的加签 secret"},
        ],
    },
    {
        "type": "wecom", "name": "企业微信",
        "hint": "群聊 → 群机器人 → 添加机器人, 复制 Webhook 地址",
        "fields": [
            {"key": "webhook", "label": "Webhook 地址", "required": True,
             "placeholder": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx"},
        ],
    },
    {
        "type": "dingtalk", "name": "钉钉",
        "hint": "群设置 → 机器人 → 自定义, 复制 Webhook; 安全设置建议选加签",
        "fields": [
            {"key": "webhook", "label": "Webhook 地址", "required": True,
             "placeholder": "https://oapi.dingtalk.com/robot/send?access_token=xxx"},
            {"key": "secret", "label": "加签密钥 (可选)", "required": False, "placeholder": "SEC 开头的加签密钥"},
        ],
    },
    {
        "type": "email", "name": "个人邮箱",
        "hint": "通过 SMTP 发信到自己邮箱 (如 QQ/163 需开启 SMTP 并取授权码)",
        "fields": [
            {"key": "smtp_host", "label": "SMTP 服务器", "required": True, "placeholder": "smtp.qq.com"},
            {"key": "smtp_port", "label": "端口", "required": True, "placeholder": "465 (SSL) 或 587"},
            {"key": "username", "label": "发信账号", "required": True, "placeholder": "you@qq.com"},
            {"key": "password", "label": "密码/授权码", "required": True, "password": True},
            {"key": "to", "label": "收件地址", "required": True, "placeholder": "me@example.com"},
        ],
    },
    {
        "type": "oa", "name": "OA / 通用 Webhook",
        "hint": "向内部 OA 系统推送: POST JSON {\"text\", \"from\"}",
        "fields": [
            {"key": "webhook", "label": "接口地址", "required": True, "placeholder": "https://oa.example.com/api/notify"},
            {"key": "token", "label": "鉴权 Token (可选, Bearer)", "required": False},
        ],
    },
    {
        "type": "obsidian", "name": "Obsidian",
        "hint": "经 Local REST API 插件在指定目录创建笔记 (收件箱式)",
        "fields": [
            {"key": "host", "label": "REST API 地址", "required": True, "placeholder": "https://host.docker.internal:27124"},
            {"key": "api_key", "label": "API Key", "required": True, "password": True},
            {"key": "folder", "label": "收件目录 (可选)", "required": False, "placeholder": "inbox"},
        ],
    },
]

_TYPE_NAMES = {t["type"]: t["name"] for t in CHANNEL_TYPES}


def type_name(channel_type: str) -> str:
    return _TYPE_NAMES.get(channel_type, channel_type)


async def _post_json(url: str, payload: dict, headers: Dict[str, str] | None = None,
                     timeout: float = 10.0) -> str:
    async with httpx.AsyncClient(timeout=timeout, verify=False) as client:
        resp = await client.post(url, json=payload, headers=headers or {})
    if resp.status_code >= 400:
        raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:200]}")
    return resp.text[:200]


async def _send_feishu(config: dict, text: str) -> str:
    webhook = (config.get("webhook") or "").strip()
    secret = (config.get("secret") or "").strip()
    if not webhook:
        raise RuntimeError("缺少 webhook")
    payload: Dict[str, Any] = {"msg_type": "text", "content": {"text": text}}
    if secret:
        ts = str(int(time.time()))
        sign = base64.b64encode(
            hmac.new(f"{ts}\n{secret}".encode(), b"", hashlib.sha256).digest()
        ).decode()
        payload["timestamp"] = ts
        payload["sign"] = sign
    body = await _post_json(webhook, payload)
    if '"code":0' not in body.replace(" ", "") and '"StatusCode":0' not in body:
        raise RuntimeError(f"飞书返回异常: {body}")
    return body


async def _send_wecom(config: dict, text: str) -> str:
    webhook = (config.get("webhook") or "").strip()
    if not webhook:
        raise RuntimeError("缺少 webhook")
    body = await _post_json(webhook, {"msgtype": "text", "text": {"content": text}})
    if '"errcode":0' not in body.replace(" ", ""):
        raise RuntimeError(f"企微返回异常: {body}")
    return body


async def _send_dingtalk(config: dict, text: str) -> str:
    webhook = (config.get("webhook") or "").strip()
    secret = (config.get("secret") or "").strip()
    if not webhook:
        raise RuntimeError("缺少 webhook")
    if secret:
        ts = str(round(time.time() * 1000))
        sign = quote(base64.b64encode(
            hmac.new(secret.encode(), f"{ts}\n{secret}".encode(), hashlib.sha256).digest()
        ).decode())
        sep = "&" if "?" in webhook else "?"
        webhook = f"{webhook}{sep}timestamp={ts}&sign={sign}"
    body = await _post_json(webhook, {"msgtype": "text", "text": {"content": text}})
    if '"errcode":0' not in body.replace(" ", ""):
        raise RuntimeError(f"钉钉返回异常: {body}")
    return body


async def _send_email(config: dict, text: str) -> str:
    host = (config.get("smtp_host") or "").strip()
    port = int(config.get("smtp_port") or 465)
    username = (config.get("username") or "").strip()
    password = config.get("password") or ""
    to_addr = (config.get("to") or "").strip()
    if not all([host, username, password, to_addr]):
        raise RuntimeError("邮箱配置不完整 (smtp_host/username/password/to 必填)")
    msg = MIMEText(text, "plain", "utf-8")
    msg["From"] = username
    msg["To"] = to_addr
    msg["Subject"] = Header("玄圃·智链 消息通知", "utf-8")

    import asyncio

    def _do() -> str:
        if port == 465:
            server: smtplib.SMTP = smtplib.SMTP_SSL(host, port, timeout=15)
        else:
            server = smtplib.SMTP(host, port, timeout=15)
            server.starttls()
        try:
            server.login(username, password)
            server.sendmail(username, [to_addr], msg.as_string())
        finally:
            server.quit()
        return f"已投递 {to_addr}"

    return await asyncio.to_thread(_do)


async def _send_oa(config: dict, text: str) -> str:
    webhook = (config.get("webhook") or "").strip()
    if not webhook:
        raise RuntimeError("缺少 webhook")
    headers = {}
    if config.get("token"):
        headers["Authorization"] = f"Bearer {config['token']}"
    return await _post_json(webhook, {"text": text, "from": "玄圃·智链"}, headers=headers)


async def _send_obsidian(config: dict, text: str) -> str:
    host = (config.get("host") or "").strip().rstrip("/")
    api_key = (config.get("api_key") or "").strip()
    folder = (config.get("folder") or "inbox").strip().strip("/")
    if not host or not api_key:
        raise RuntimeError("缺少 host 或 api_key")
    path = f"{folder}/玄圃消息-{datetime.now().strftime('%Y%m%d-%H%M%S')}.md"
    async with httpx.AsyncClient(timeout=10.0, verify=False) as client:
        resp = await client.put(
            f"{host}/vault/{quote(path)}",
            content=f"# 玄圃·智链 消息\n\n> {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n{text}\n",
            headers={"Authorization": f"Bearer {api_key}",
                     "Content-Type": "text/markdown"},
        )
    if resp.status_code >= 400:
        raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:200]}")
    return f"已创建笔记 {path}"


_SENDERS = {
    "feishu": _send_feishu,
    "wecom": _send_wecom,
    "dingtalk": _send_dingtalk,
    "email": _send_email,
    "oa": _send_oa,
    "obsidian": _send_obsidian,
}


async def send(channel_type: str, config: dict, text: str) -> str:
    """按通道类型发送文本消息, 返回平台响应摘要; 失败抛异常"""
    sender = _SENDERS.get(channel_type)
    if not sender:
        raise RuntimeError(f"不支持的通道类型: {channel_type}")
    return await sender(config or {}, text)
