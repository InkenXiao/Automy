"""种子数据脚本 · 导入模块 / 阶段 / 进度计划任务

数据来源:
    - 模块/周报结构: 信投AI2.0_项目周报工具.html
    - 阶段/进度任务: 20260710信投AI2.0项目进度计划V2.3 执行图.html

执行方式:
    python -m app.seed            # 仅在空库时插入
    python -m app.seed --force    # 强制同步覆盖已存在数据 (按 task_uid/idx/name 匹配)
"""
import asyncio
import sys
from datetime import date

from sqlalchemy import select

from app.database import AsyncSessionLocal, init_db
from app.models.module import Module
from app.models.phase import Phase
from app.models.progress_task import ProgressTask


# ---------- 模块数据 (与周报工具 HTML 中 MODULES 严格一致) ----------
# (idx, tag, title, owner, color, color_bg, sort_order)
MODULES_DATA = [
    ("01", "底座",   "算力与模型基础底座建设",         "亚信 · 基础设施组", "#2563EB", "#EFF6FF", 1),
    ("02", "数据",   "数据治理与知识库构建",           "数据治理专项组",    "#0D9488", "#F0FDFA", 2),
    ("03", "智能体", "企业智能体平台建设",             "智能体平台组",      "#7C3AED", "#F5F3FF", 3),
    ("04", "应用",   "运营管理系统升级与智能应用建设", "应用产品组",        "#E85D1C", "#FFF7ED", 4),
    ("05", "需求",   "用户需求及技术方案",             "需求与方案组",      "#D97706", "#FFFBEB", 5),
    ("06", "协调",   "其他组织协调工作",               "PMO",              "#E11D48", "#FFF1F2", 6),
]

# ---------- 阶段数据 (与进度计划 HTML 中 phases 严格一致, 2026年) ----------
# (name, subtitle, description, start_date, end_date)
PHASES_DATA = [
    (
        "第一阶段",
        "有得用",
        "本地大模型与工作台搭建，挂载外部知识，全员\"有得用\"",
        date(2026, 7, 1),
        date(2026, 8, 31),
    ),
    (
        "第二阶段",
        "用起来",
        "治理内部数据形成本地知识库，完成运营系统升级，AI进入既有业务",
        date(2026, 9, 1),
        date(2026, 10, 31),
    ),
    (
        "第三阶段",
        "用得好",
        "AI全面融入投资主业，系统数据准确靠谱，全面切换自研智能体",
        date(2026, 11, 1),
        date(2026, 12, 31),
    ),
]

# ---------- 进度计划任务数据 (与进度计划 HTML 中 tasks 严格一致, 2026年) ----------
# 字段: task_uid, name, phase_id, start_date, end_date, status, full_desc, owner, is_milestone
PROGRESS_TASKS_DATA = [
    # === 第一阶段 (7-8月) ===
    ("1-1", "机房线路改造·服务器机位规划·网络配置", 1, date(2026, 7, 1), date(2026, 7, 14), "ongoing",
     "机房线路改造方案确认、服务器机位规划与网络环境诊断施工 | 责任方：智科/能力办 | 配合：服务公司", "智科", False),
    ("1-2", "WorkBuddy+Obsidian 试点安装", 1, date(2026, 7, 1), date(2026, 7, 14), "ongoing",
     "WorkBuddy+Obsidian个人知识库先行版在指定团队中启动试点安装与体验反馈 | 责任方：智科/能力办 | 配合：试点人员", "智科", False),
    ("1-3", "确认首批通用知识与高频Skill清单", 1, date(2026, 7, 1), date(2026, 7, 14), "ongoing",
     "确认首批可外挂的通用知识与高频Skill清单 | 责任方：智科/能力办", "智科", False),
    ("1-4", "历史档案与文献资料分类归集·MinIO存储", 1, date(2026, 7, 1), date(2026, 7, 14), "ongoing",
     "启动本部首批历史档案与文献资料（语料）的分类归集与MinIO存储上架 | 责任方：智科/能力办 | 配合：时源", "智科", False),
    ("M1", "★ M1：L20服务器上架·首批Skill清单确立", 1, date(2026, 7, 14), date(2026, 7, 14), "milestone",
     "完成L20服务器上架，首批通用Skill清单确立 | 责任方：智科 | 配合：能力办", "智科", True),

    ("2-1", "L20/H20算力集群调试·大模型私有化部署", 1, date(2026, 7, 15), date(2026, 7, 31), "planned",
     "L20/H20算力集群联合调试、大模型私有化部署与内网安全访问加固 | 责任方：智科", "智科", False),
    ("2-2", "历史档案PDF高精度OCR·结构化版面解析", 1, date(2026, 7, 15), date(2026, 7, 31), "planned",
     "完成本部历史档案PDF首轮高精度OCR文本提取和结构化版面解析管线开发 | 责任方：库帕思", "库帕思", False),
    ("2-3", "外部投资知识库接口选型方案确定", 1, date(2026, 7, 15), date(2026, 7, 31), "planned",
     "外部专业投资知识库接口选型方案最终确定（如万得、投研派等接口方案评审）| 责任方：智科/能力办 | 配合：战投部/投资部", "智科", False),
    ("2-4", "AI工作台Demo前端·WorkBuddy Skill环境发布", 1, date(2026, 7, 15), date(2026, 7, 31), "planned",
     "AI工作台基础Demo前端页面开发与WorkBuddy通用Skill环境发布上线 | 责任方：智科 | 配合：全员", "智科", False),
    ("M2", "★ M2：投资知识库对接方案审定·解析管线跑通", 1, date(2026, 7, 31), date(2026, 7, 31), "milestone",
     "外部投资知识库对接方案审定，本部历史档案高精度解析管线全面跑通 | 责任方：智科/库帕思 | 配合：能力办", "智科", True),

    ("3-1", "历史PDF深度数据加工·语义切片", 1, date(2026, 8, 1), date(2026, 8, 14), "planned",
     "历史PDF文档深度数据加工：实施目录层级映射、文本清洗、语义切片 | 责任方：库帕思", "库帕思", False),
    ("3-2", "知识库Schema与元数据规范设计", 1, date(2026, 8, 1), date(2026, 8, 14), "planned",
     "知识数据标准设计：建立统一的公司组织级知识库Schema和元数据规范 | 责任方：智科 | 配合：能力办", "智科", False),
    ("3-3", "外部知识库数据接口对接集成", 1, date(2026, 8, 1), date(2026, 8, 14), "planned",
     "对接采购的外部知识库标准数据接口，完成数据初步集成调通 | 责任方：智科 | 配合：能力办", "智科", False),
    ("3-4", "Skill市场基础管理平台开发", 1, date(2026, 8, 1), date(2026, 8, 14), "planned",
     "Skill市场基础管理平台开发（支持登录、搜索、详情展示及基础上传校验）| 责任方：智科 | 配合：研发中心", "智科", False),
    ("M3", "★ M3：三层知识库Schema发布·接口对接", 1, date(2026, 8, 14), date(2026, 8, 14), "milestone",
     "三层组织级知识库Schema设计发布，统一数据规范与接口对接 | 责任方：智科 | 配合：能力办", "智科", True),

    ("4-1", "AI工作台试用版入口·问数API/MCP发布", 1, date(2026, 8, 15), date(2026, 8, 31), "planned",
     "正式推出AI工作台基础试用版入口，运营管理系统发布数据隔离的问数API和MCP | 责任方：智科 | 配合：试点人员", "智科", False),
    ("4-2", "智能问答·多文档比对·文字辅助开放", 1, date(2026, 8, 15), date(2026, 8, 31), "planned",
     "开放基于公开与基础知识库的智能问答、多文档比对与案头文字辅助功能 | 责任方：智科 | 配合：试点人员", "智科", False),
    ("4-3", "产业观察与舆情实时查询入库上线", 1, date(2026, 8, 15), date(2026, 8, 31), "planned",
     "产业观察与舆情自动实时查询、审核及入库功能上线，丰富通用Skill | 责任方：智科 | 配合：能力办/办公室", "智科", False),
    ("M4", "★ M4：AI工作台试用版交付·文字辅助试点", 1, date(2026, 8, 31), date(2026, 8, 31), "milestone",
     "AI工作台基础试用版交付，日常案头智能文字辅助试点 | 责任方：智科 | 配合：试点人员", "智科", True),

    # === 第二阶段 (9-10月) ===
    ("5-1", "企业知识库本地化·多模态RAG引擎·权限管理", 2, date(2026, 9, 1), date(2026, 9, 14), "planned",
     "企业知识库本地化精细构建：研发多模态RAG引擎与细粒度数据权限管理 | 责任方：智科", "智科", False),
    ("5-2", "高质量知识数据集·检索底座平台搭建", 2, date(2026, 9, 1), date(2026, 9, 14), "planned",
     "可检索、可精确溯源的高质量知识数据集与检索底座平台搭建 | 责任方：智科/库帕思 | 配合：能力办抽检", "智科", False),
    ("5-3", "投资风险报告PPT·投后报告Word自动生成", 2, date(2026, 9, 1), date(2026, 9, 14), "planned",
     "AI工作台对接投资风险报告PPT框架、投后管理报告Word大纲自动生成开发 | 责任方：智科 | 配合：两个投资部", "智科", False),
    ("M5", "★ M5：多模态RAG·精确溯源引擎构建完成", 2, date(2026, 9, 14), date(2026, 9, 14), "milestone",
     "多模态RAG与精确溯源引擎构建完成，完成近10年历史语料的语义切片检索能力 | 责任方：智科/库帕思 | 配合：库帕思", "智科", True),

    ("6-1", "企业组织级知识库三层架构完成", 2, date(2026, 9, 15), date(2026, 9, 30), "planned",
     "企业组织级知识库（个人、组织、通识）三层基础架构完成 | 责任方：智科 | 配合：能力办", "智科", False),
    ("6-2", "数据治理Tools/Skill开放·语料纠错", 2, date(2026, 9, 15), date(2026, 9, 30), "planned",
     "开放数据治理相关管理Tools与Skill，允许业务骨干参与持续的语料纠错 | 责任方：智科 | 配合：试点人员", "智科", False),
    ("6-3", "运营系统看板优化·经营者考核看板升级", 2, date(2026, 9, 15), date(2026, 9, 30), "planned",
     "运营管理系统看板优化：完成经营者考核看板升级（涵盖领导班子与下级企业）| 责任方：智科 | 配合：总师室/战投部", "智科", False),
    ("M6", "★ M6：知识库本地化完成·考核看板就绪", 2, date(2026, 9, 30), date(2026, 9, 30), "milestone",
     "组织级知识库本地化构建基本完成，运营管理系统经营者考核看板升级就绪 | 责任方：智科 | 配合：能力办", "智科", True),

    ("7-1", "运营系统升级·财务填报校验·十三期审计", 2, date(2026, 10, 1), date(2026, 10, 14), "planned",
     "信投运营管理系统升级：深度开发财务填报与校验体系，对接计财部十三期审计 | 责任方：智科 | 配合：计财部", "智科", False),
    ("7-2", "报告AI在线编辑·HTML转PPT/Word·润色", 2, date(2026, 10, 1), date(2026, 10, 14), "planned",
     "报告AI在线智能编辑功能开发，支持HTML无缝转化为PPT/Word与智能润色 | 责任方：智科 | 配合：战投部/办公室", "智科", False),
    ("7-3", "考核指标AI一致性检查·异动分析Skill", 2, date(2026, 10, 1), date(2026, 10, 14), "planned",
     "发布考核指标AI一致性检查、异动自动分析与合规生成说明Skill | 责任方：智科 | 配合：能力办", "智科", False),
    ("M7", "★ M7：计财/战投专版完成·一致性核验跑通", 2, date(2026, 10, 14), date(2026, 10, 14), "milestone",
     "计财部与战投部专版功能开发完成，考核指标AI一致性核验Skill跑通 | 责任方：智科 | 配合：战投部/计财部", "智科", True),

    ("8-1", "运营系统2.0领导多维数据聚合首页", 2, date(2026, 10, 15), date(2026, 10, 31), "planned",
     "信投运营管理系统2.0 部署定制化的领导多维数据聚合首页 | 责任方：智科/能力办 | 配合：战投部/计财部", "智科", False),
    ("8-2", "Skill应用市场UAT发布·全员开放", 2, date(2026, 10, 15), date(2026, 10, 31), "planned",
     "Skill应用市场与治理平台UAT正式发布，开放给全员，支持自主加载Tools | 责任方：智科 | 配合：试点人员", "智科", False),
    ("8-3", "投前会议材料智能准备Skill上线", 2, date(2026, 10, 15), date(2026, 10, 31), "planned",
     "投前会议材料智能准备Skill上线（覆盖战投部立项会、风控会等材料生成）| 责任方：智科/能力办 | 配合：战投部/办公室", "智科", False),
    ("M8", "★ M8：运营系统2.0深化交付·UAT试运行", 2, date(2026, 10, 31), date(2026, 10, 31), "milestone",
     "运营管理系统2.0功能深化交付，AI工作台全面提供并启动UAT试运行 | 责任方：智科/能力办 | 配合：试点人员", "智科", True),

    # === 第三阶段 (11-12月) ===
    ("9-1", "全面切换自研企业智能体平台生产版", 3, date(2026, 11, 1), date(2026, 11, 14), "planned",
     "全面切换为自研企业智能体平台生产版本（含AI工作台与高安全Skill市场）| 责任方：智科 | 配合：试点人员", "智科", False),
    ("9-2", "四级权限管控·Token计量·审计追溯", 3, date(2026, 11, 1), date(2026, 11, 14), "planned",
     "上线四级权限管控、Token计量、配额对账、多级审核流程与审计追溯体系 | 责任方：智科 | 配合：能力办", "智科", False),
    ("9-3", "历史PDF人工交叉质检·终审校准", 3, date(2026, 11, 1), date(2026, 11, 14), "planned",
     "历史PDF文档人工交叉质检与终审校准全量完成，确保模型知识基座准确率 | 责任方：智科/库帕思 | 配合：各部门抽样", "智科", False),
    ("9-4", "移动手机端驾驶舱正式上线", 3, date(2026, 11, 1), date(2026, 11, 14), "planned",
     "移动手机端驾驶舱正式上线（支持AI对话、智能经营看板、投后管理信息浏览）| 责任方：智科/能力办 | 配合：试点人员", "智科", False),
    ("M9", "★ M9：自研平台全量上线·移动驾驶舱交付", 3, date(2026, 11, 14), date(2026, 11, 14), "milestone",
     "自研企业智能体平台与权限审计体系全量上线，移动端领导驾驶舱交付试用 | 责任方：智科 | 配合：领导班子", "智科", True),

    ("10-1", "大模型提示词与检索策略深度迭代", 3, date(2026, 11, 15), date(2026, 11, 30), "planned",
     "根据业务部门使用反馈，深度迭代大模型提示词与检索策略 | 责任方：智科 | 配合：试点人员", "智科", False),
    ("10-2", "领导移动端功能优化·界面重构", 3, date(2026, 11, 15), date(2026, 11, 30), "planned",
     "领导手机移动端根据首期试用意见开展功能优化、界面重构与深度习惯闭环 | 责任方：智科/能力办 | 配合：试用反馈", "智科", False),
    ("10-3", "计财/战投现场驻座陪跑·Skill沉淀", 3, date(2026, 11, 15), date(2026, 11, 30), "planned",
     "聚焦计财部与战投部开展现场驻座陪跑服务，将真实场景沉淀为Skill | 责任方：能力办/智科 | 配合：试点人员", "智科", False),

    ("11-1", "全模块集成联调·高可用安全测试·漏扫", 3, date(2026, 12, 1), date(2026, 12, 15), "planned",
     "项目全模块系统集成联调演练、全链路高并发高可用安全性能测试与漏洞扫描 | 责任方：智科 | 配合：能力办", "智科", False),
    ("11-2", "内部预验收·成果合规性审计", 3, date(2026, 12, 1), date(2026, 12, 15), "planned",
     "逐项对照本项目核心交付物进行内部预验收与成果合规性审计 | 责任方：智科/能力办 | 配合：各业务部门", "智科", False),
    ("M10", "★ M10：集成联调通过·项目内部预验收", 3, date(2026, 12, 15), date(2026, 12, 15), "milestone",
     "集成联调与全链路高可用性能测试顺利通过，全面完成项目内部预验收 | 责任方：智科/能力办 | 配合：各业务部门", "智科", True),

    ("12-1", "全面成效评估·全景数据分析·经营归因", 3, date(2026, 12, 16), date(2026, 12, 31), "planned",
     "全面成效评估：协助领导班子完全利用2.0系统开展全景数据分析与经营归因 | 责任方：能力办/智科 | 配合：领导班子/分管领导", "智科", False),
    ("12-2", "项目总结汇报·知识转移手册·运维文档", 3, date(2026, 12, 16), date(2026, 12, 31), "planned",
     "编制完整的信投AI 2.0项目总结汇报材料、持续知识转移手册与运维文档 | 责任方：智科/能力办 | 配合：各业务部门", "智科", False),
    ("12-3", "技术运维交接·下年度演进规划蓝图", 3, date(2026, 12, 16), date(2026, 12, 31), "planned",
     "完成技术运维与算力保障交接，制定下一年度系统演进规划蓝图 | 责任方：能力办/智科 | 配合：各业务部门", "智科", False),
    ("M11", "★ M11：项目完工最终验收·全面交付", 3, date(2026, 12, 31), date(2026, 12, 31), "milestone",
     "信投AI 2.0项目完工最终验收与全面交付 | 责任方：智科/能力办 | 配合：各业务部门", "智科", True),
]


# ---------- 同步逻辑 ----------
async def sync_modules(db) -> int:
    """同步模块数据: 按 idx upsert (存在则更新, 不存在则插入)"""
    result = await db.execute(select(Module))
    existing = {m.idx: m for m in result.scalars().all()}
    inserted = 0
    updated = 0
    for idx, tag, title, owner, color, color_bg, sort_order in MODULES_DATA:
        if idx in existing:
            m = existing[idx]
            m.tag = tag
            m.title = title
            m.owner = owner
            m.color = color
            m.color_bg = color_bg
            m.sort_order = sort_order
            updated += 1
        else:
            db.add(Module(
                idx=idx, tag=tag, title=title, owner=owner,
                color=color, color_bg=color_bg, sort_order=sort_order,
            ))
            inserted += 1
    await db.flush()
    return inserted + updated


async def sync_phases(db) -> int:
    """同步阶段数据: 按 name upsert"""
    result = await db.execute(select(Phase))
    existing = {p.name: p for p in result.scalars().all()}
    inserted = 0
    updated = 0
    for name, subtitle, description, start_date, end_date in PHASES_DATA:
        if name in existing:
            p = existing[name]
            p.subtitle = subtitle
            p.description = description
            p.start_date = start_date
            p.end_date = end_date
            updated += 1
        else:
            db.add(Phase(
                name=name, subtitle=subtitle, description=description,
                start_date=start_date, end_date=end_date,
            ))
            inserted += 1
    await db.flush()
    return inserted + updated


async def sync_progress_tasks(db) -> int:
    """同步进度计划任务: 按 task_uid upsert"""
    result = await db.execute(select(ProgressTask))
    existing = {t.task_uid: t for t in result.scalars().all()}

    # 加载阶段映射 (按 name -> id)
    phase_result = await db.execute(select(Phase))
    phase_by_name = {p.name: p.id for p in phase_result.scalars().all()}
    phase_id_map = {
        1: phase_by_name.get("第一阶段"),
        2: phase_by_name.get("第二阶段"),
        3: phase_by_name.get("第三阶段"),
    }

    inserted = 0
    updated = 0
    for (task_uid, name, phase_id, start_date, end_date,
         status, full_desc, owner, is_milestone) in PROGRESS_TASKS_DATA:
        actual_phase_id = phase_id_map.get(phase_id)
        if task_uid in existing:
            t = existing[task_uid]
            t.name = name
            t.phase_id = actual_phase_id
            t.start_date = start_date
            t.end_date = end_date
            t.status = status
            t.full_desc = full_desc
            t.owner = owner
            t.is_milestone = is_milestone
            updated += 1
        else:
            db.add(ProgressTask(
                task_uid=task_uid, name=name, phase_id=actual_phase_id,
                start_date=start_date, end_date=end_date, status=status,
                full_desc=full_desc, owner=owner, is_milestone=is_milestone,
            ))
            inserted += 1
    await db.flush()
    return inserted + updated


async def seed_all(force: bool = False) -> None:
    """执行全部种子数据导入

    Args:
        force: True 时强制同步覆盖; False 时仅在空库时插入
    """
    await init_db()

    async with AsyncSessionLocal() as db:
        try:
            if force:
                n_modules = await sync_modules(db)
                n_phases = await sync_phases(db)
                n_tasks = await sync_progress_tasks(db)
                mode = "强制同步"
            else:
                # 幂等插入模式 (空库才插入)
                result_m = await db.execute(select(Module).limit(1))
                result_p = await db.execute(select(Phase).limit(1))
                result_t = await db.execute(select(ProgressTask).limit(1))
                if result_m.scalars().first() is None:
                    n_modules = await sync_modules(db)
                else:
                    n_modules = 0
                if result_p.scalars().first() is None:
                    n_phases = await sync_phases(db)
                else:
                    n_phases = 0
                if result_t.scalars().first() is None:
                    n_tasks = await sync_progress_tasks(db)
                else:
                    n_tasks = 0
                mode = "幂等插入"

            await db.commit()
            print(
                f"[{mode}] 种子数据: 模块 {n_modules} 条, "
                f"阶段 {n_phases} 条, 进度任务 {n_tasks} 条"
            )
        except Exception as e:
            await db.rollback()
            print(f"种子数据导入失败: {e}")
            raise


if __name__ == "__main__":
    force_mode = "--force" in sys.argv
    asyncio.run(seed_all(force=force_mode))
