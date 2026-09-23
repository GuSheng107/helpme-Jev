# HelpMe JEV · 设计方案（v3）

> **项目定位**：JEV（TypeSafe System One）决策工作台 ——
> 以「聊天副驾」为第一个场景，向上提供**通用 JEV 决策能力**与**可自定义的细分场景**。
>
> **基座**：新建干净项目（不在 `AI-Relationship-Copilot` 上改造）。
> **参考**：`human-llm-gateway`（认证/加密/日志/DB 基建）、`jev-chat-jarvis`（JEV 题目集与工程做法）。
>
> 编写：2026-09-23　状态：**方案已定稿**
> 项目名：`helpme-jev`（皇上 2026-09-23 定名）

---

## 1. 需求定稿

| # | 需求 | 落地要点 |
|---|---|---|
| 1 | **必须有 LLM** | **未配置 LLM 时聊天场景不可用，直接报错并引导去配置**；不做任何降级、不做本地合成器 |
| 2 | **JEV 与 LLM 全走自定义配置** | 用户自填完整 URL + Key + 模型；**不做任何官方 provider 预设**；**必须提供一键连通性测试** |
| 3 | **题目集基于 Jarvis** | 7 道判断题 + 情绪 + 强度；候选排序 **3~5 条**（不锁死 3 条） |
| 4 | **多场景** | 预设场景（恋爱助手 / 职场助手 / 通用决策）+ 用户**自定义场景** |
| 5 | **登录体系 + 用户隔离** | 参考 `human-llm-gateway`；聊天记录、配置、记忆、日志**全部按用户隔离** |
| 6 | **每个用户自配密钥** | JEV/LLM 的 URL 与 Key 由各用户自己填，调用与数据彻底隔离 |
| 7 | **日志** | 记录 JEV/LLM 的**原始请求与响应上下文**；**apiKey 等凭据绝不入日志**；凭据在配置表中**加密存储** |
| 8 | **不提供 OCR，纯文本能力** | 不做任何本地识别；图片交给用户自配的**多模态 LLM** 处理 |
| 9 | **形态用 Web** | 单端口部署，跨平台 |
| 10 | **复合项目** | 聊天场景之外，另设「通用决策工作台」 |
| 11 | **LLM 提问收集信息** | 信息不足时由 LLM 反问用户补全上下文（交互式，非一次性） |
| 12 | **人设建模** | 用 JEV 给**「用户本人」与「聊天对象」**建模；**维度对齐主流人格框架**（大五人格 / 依恋类型 / 爱的五种语言 / MBTI 等，见 §8.6） |
| 13 | **核心分工（定调）** | **LLM 分析 → JEV 输出决策 → 用户自己选择方案或自拟方案**；决策必须由 JEV 出，LLM 不得直接给建议 |
| 14 | **上下文管理** | 显式的上下文装配与预算管理（短期消息 / 摘要 / 人设 / 记忆 / 情绪轨迹） |
| 15 | **建模素材来源** | 支持**导入聊天记录**分析建模；允许用户提交 **QA 对 JSON**；多模态模型下允许用**聊天记录截图**建模（见 §8.7） |
| 16 | **记忆治理** | 用 **LLM 自我复盘与总结**治理记忆（参考 Mem0 / Zep / Letta 等开源方案），**不用正则抽取**；记忆条目化 + 时序（见 §8.8） |
| 17 | **输入润色** | 用户输入（聊天文本 / 自拟回复 / 决策题目 / 选项）均可交 **LLM 润色**；**润色后直接替换用户输入**，全场景适用（见 §10.1） |
| 18 | **移动端适配** | 前端必须**响应式适配手机** —— 聊天副驾是高频移动场景（见 §12） |

---

## 2. 技术栈

与 `human-llm-gateway` 同构，最大化复用其基建：

| 层 | 选型 |
|---|---|
| 后端 | Python 3.12+ / **FastAPI** / SQLAlchemy 2.x / **SQLite**(WAL) / `uv` 管理依赖 |
| 前端 | **React 19 + Vite + Tailwind 4** |
| 密码 | **Argon2id**（PHC 编码，m=19456KiB, t=2, p=1） |
| 加密 | `cryptography`：**HKDF-SHA256 → AES-256-GCM**（96-bit nonce，AAD 用途绑定） |
| 认证 | 服务端 session 表 + `Authorization: Bearer`（库中只存 token 的 SHA256） |

---

## 3. 项目结构

```text
helpme-jev/
├── app/
│   ├── main.py                     # FastAPI 入口
│   ├── core/
│   │   ├── config.py               # Settings（APP_SECRET 等，pydantic-settings）
│   │   ├── constants.py            # 信封前缀、key_version、SCHEMA_VERSION
│   │   ├── security.py             # 密码哈希 + encrypt_secret/decrypt_secret
│   │   ├── logging.py              # 脱敏（sanitize_log_value / _is_sensitive_key）
│   │   ├── db.py                   # 引擎/会话（WAL、foreign_keys=ON）
│   │   └── login_throttle.py       # 登录限流
│   ├── domain/
│   │   ├── enums.py                # UserRole / ScenarioKind / CallKind / MemoryOp ...
│   │   └── schemas/                # pydantic 模型（请求/响应/错误模型）
│   ├── repositories/               # SQLAlchemy 模型 + 仓储（owner_user_id 隔离）
│   │   ├── models/{auth,user,provider,scenario,conversation,memory,persona,qapair,material,call_log,audit}.py
│   │   └── {users,sessions,providers,scenarios,conversations,memories,personas,call_logs}.py
│   ├── services/
│   │   ├── auth_service.py         # 登录 / 登出 / 校验 token / 强制改密
│   │   ├── user_service.py
│   │   ├── provider_service.py     # JEV / LLM 配置 CRUD + 连通性测试
│   │   ├── scenario_service.py     # 场景（预设 + 自定义）
│   │   ├── context_service.py      # 【新】上下文装配器（双预算裁剪）
│   │   ├── memory_service.py       # 【新】记忆治理：复盘管线 + 写入决策 + 冲突仲裁
│   │   ├── chat_service.py         # 聊天编排（JEV 决策 → LLM 起草 → JEV 排序）
│   │   ├── decision_service.py     # 通用决策编排
│   │   ├── import_service.py       # 【新】素材导入：聊天记录解析 / QA 对 / 截图
│   │   ├── export_service.py       # 【新】数据导出与账号注销
│   │   └── log_service.py          # 调用日志落库（已脱敏）+ 保留期清理
│   ├── clients/
│   │   ├── jev_client.py           # JEV 客户端（协议校验 + 防御性重试 + 错误映射）
│   │   ├── llm_client.py           # OpenAI 兼容客户端（vision + 可配窗口）
│   │   ├── translation.py          # 【新】翻译桥：中文 → 英文（供 JEV）、结果回译
│   │   └── redaction.py            # 请求 / 响应体脱敏
│   ├── scenarios/
│   │   ├── builders.py             # noul / choice / score 构造器 + BACKGROUND_NOTE
│   │   ├── questions_romance.py    # 恋爱场景判断题集（Jarvis 移植 + 情绪）
│   │   ├── questions_workplace.py  # 职场场景判断题集
│   │   └── persona_questions.py    # 【新】人设题集（大五 / 依恋 / 五种语言 / 冲突 / MBTI / DISC）
│   └── api/
│       ├── deps.py                 # require_current_user（含强制改密闸门）
│       ├── auth.py / users.py / account.py
│       ├── providers.py            # 配置 CRUD + 测试连通
│       ├── scenarios.py            # 场景 CRUD
│       ├── chat.py                 # /analyze /reply /clarify /evaluate
│       ├── decision.py             # /decide
│       ├── polish.py               # 【新】/polish 输入润色
│       ├── personas.py             # 【新】/personas 人设档案
│       ├── imports.py              # 【新】/import/chat /import/qa /materials/screenshot
│       ├── memories.py             # 【新】/memories（含 reflect / apply）
│       ├── export.py               # 【新】/export 数据导出 + 账号注销
│       └── logs.py                 # 调用日志查询（按 traceId 拉链路）
├── web/  (前端 React19 + Vite + Tailwind4)
│   └── src/
│       ├── api/client.ts           # Bearer + 401 处理
│       ├── pages/{Login,ChangePassword}.tsx
│       ├── pages/ChatCopilot/      # 聊天副驾
│       ├── pages/Workbench/        # 通用决策工作台
│       ├── pages/Personas/         # 人设档案
│       ├── pages/Memories/         # 记忆管理（含复盘变更集撤销）
│       ├── pages/Settings/         # 配置（JEV / LLM + 连通性测试 + 上下文窗口）
│       ├── pages/Scenarios/        # 场景管理
│       └── pages/Logs/             # 调用日志
├── migrations/                     # Alembic 迁移（**schema 唯一来源**）
│   ├── env.py                      # 从 app.core.config 注入 DB 地址；开启 render_as_batch（SQLite 改表必需）
│   └── versions/                   # 迁移脚本
├── alembic.ini                     # 刻意不写 DB 地址（由 env.py 注入），且**必须保持 ASCII**（alembic 按系统 locale 读取）
├── data/                           # SQLite 文件（gitignore）
├── tests/                          # pytest（见 §16 测试策略）
└── pyproject.toml
```

---

## 4. 数据模型

所有业务表都带 **`owner_user_id`**（外键→users.id），查询层强制拼 scope。

| 表 | 关键字段 | 说明 |
|---|---|---|
| `users` | id, username, display_name, password_hash, role, must_change_password, is_active, created_at | 角色 `admin` / `user` |
| `auth_sessions` | id, user_id, **token_hash**(SHA256), token_prefix, expires_at, revoked_at, client_ip, user_agent | 不存明文 token；8h 固定过期、无滑动续期 |
| `provider_configs` | id, owner_user_id, **kind**(jev\|llm), name, endpoint_url, **api_key_enc**, model, supports_vision, is_default, created_at, updated_at | `api_key_enc` 用信封加密 |
| `scenarios` | id, owner_user_id(**NULL=系统预设**), slug, name, kind, description, judge_questions(JSON), **persona_questions(JSON)**, system_prompt, rank_min, rank_max, is_builtin | 场景 = **判断题目集 + 人设题目集** + 提示词 |
| `conversations` | id, owner_user_id, scenario_id, title, counterpart_name, relationship, created_at, updated_at | |
| `messages` | id, conversation_id, role(me\|other), content, attachments(JSON), created_at, seq | |
| `memories` | id, owner_user_id, **subject**(me\|other\|relation), **counterpart_key**, category, content, valid_from, valid_to, confidence, source(auto\|qa\|import\|reflection), evidence(JSON), created_at, updated_at | **记忆条目（用户级）**：LLM 复盘产出，条目化 + 时序。**对象归属**：`me`/`relation` 类 `counterpart_key` 留空＝全局共享；`other` 类**必带对象标识**，装配时按当前对象过滤 —— 否则"她喜欢可颂"会串到别的对象会话 |
| `memory_reflections` | id, owner_user_id, trace_id, scope(会话范围 / upto_seq), changes(JSON), model, created_at | **复盘记录**：每次 LLM 复盘产出的记忆变更集，可回溯、可撤销 |
| `personas` | id, owner_user_id, **counterpart_key**, **subject**(me\|other), traits(JSON), evidence(JSON), confidence(JSON), version, updated_at | **人设档案**：与记忆相反，人设**按聊天对象区分** —— 每个对象 × 主体（我/对方）各一份；`counterpart_key` 标识对象，同一对象跨会话共用 |
| `session_summaries` | id, conversation_id, **upto_seq**, summary, created_at | 滚动摘要：上下文预算超限时压缩历史 |
| `clarifications` | id, conversation_id, trace_id, questions(JSON), answers(JSON), created_at | LLM 提问收集信息的记录（可回溯"当时补了什么料"） |
| `qa_pairs` | id, owner_user_id, conversation_id, question, answer, tags(JSON), source, created_at | **用户提交的 QA 对**（JSON 批量导入）：作为背景知识参与装配与建模 |
| `materials` | id, owner_user_id, conversation_id, **kind**(screenshot\|chat_import), file_path, mime, bytes, parsed_count, created_at | **建模素材**：聊天截图（原文交多模态 LLM，系统不做 OCR）/ 聊天记录导入（解析成 `messages` 后即弃） |
| `call_logs` | id, owner_user_id, **trace_id**, request_id, kind(jev\|llm), endpoint_url, model, **request_body**(脱敏后 JSON), **response_body**(脱敏后), status_code, latency_ms, error, created_at | 见 §7；trace_id 贯穿一次业务操作全部调用；**索引** `(owner_user_id, created_at)` / `(trace_id)`；**单条 body 上限 64KB**（超出截断并标注）；**保留期默认 15 天滚动清除**（可配） |
| `audit_logs` | id, owner_user_id, action, resource, result, request_id, metadata, created_at | 登录、改密、配置变更等 |

> **不引入知识库**（笔记/联系人），记忆体系承担全部"背景上下文"职责。

---

## 5. 认证与安全（移植 human-llm-gateway）

1. **登录**：`POST /api/auth/login` → 校验 Argon2id 密码 → 新建 session → 返回明文 token（**仅此一次**）
2. **携带**：前端存 localStorage，后续请求带 `Authorization: Bearer <token>`
3. **校验**：`deps.require_current_user` 查 `token_hash`，检查 `revoked_at` / `expires_at` / `is_active`
4. **过期**：`_SESSION_TTL = 8h` 固定，**无滑动续期**
5. **登出**：置 `revoked_at`（软撤销）
6. **强制改密**：`must_change_password=true` 时，会话只放行 4 个白名单端点，其余 403
7. **登录限流**：内存 dict + 锁，key = `client_ip|username`，60s 窗口上限 10 次

> **已知取舍：token 存 localStorage**。前端把 token 放在 localStorage，因此**存在 XSS 读取面**。
> 对本项目的定位（自部署、小圈子、单机）可接受；若要加固，改为 **httpOnly cookie + CSRF token**
> —— 代价是跨域与移动端调试变复杂。此处**明确记录该取舍**，避免日后被当成疏漏。

---

## 6. 加密与脱敏

### 6.1 凭据加密（`core/security.py`）

```text
APP_SECRET (32B CSPRNG, base64url 43 字, 存 .env)
  └─ HKDF-SHA256(salt=None, info="helpme-jev/secret/v1")
       └─ AES-256-GCM  (nonce = os.urandom(12), AAD = "helpme-jev/<purpose>/v1")
信封：hmj1.<key_version>.<nonce_b64url>.<ciphertext_and_tag_b64url>
```

- 版本号在第 2 段；解密失败抛 `SecretCryptoError`，**拒绝该资源、不猜测降级**
- 用途绑定：不同 purpose（如 `provider_apikey`）的 AAD 不同，防止跨用途搬运密文

### 6.2 日志脱敏（`core/logging.py` + `clients/redaction.py`）

| 规则 | 内容 |
|---|---|
| 键名黑名单 | 后缀 `_password` / `_token` / `_secret` / `_cookie`，或含 `api_key` / `apikey` / `authorization` → `[REDACTED]` |
| 请求头 | `Authorization` 整条剔除 |
| 递归 | 对嵌套 JSON 深度遍历（含 list） |
| 双重保险 | 写入前再过一遍 `redact_text()` 正则，兜住自由文本里误粘贴的 key 形态串 |

> **原则：apiKey 明文绝不出现在日志、响应、异常栈中。**

---

## 7. 日志体系（已定稿）

**记录内容**：JEV 与 LLM 的**完整请求上下文与响应**（model、state、questions / messages、answers / choices、usage、耗时、状态码、错误）。

**落库形式**：**明文入库，不做整条加密**（皇上 2026-09-23 定）。写入前必经脱敏管线 ——
凭据类字段替换为 `[REDACTED]`，`Authorization` 整条不入库。

**链路追踪（traceId）**：请求中间件为每次业务操作注入 `trace_id`（可外部透传），响应头回 `X-Trace-Id`；
**同一业务操作内的每一次 JEV / LLM 调用都带同一个 trace_id**，因此能凭一个 traceId 拉出完整链路。

链路示例（一次 `/api/chat/reply`）：

| 序 | kind | 调用 | 说明 |
|---|---|---|---|
| 1 | jev | `{endpoint}` | 场景题目集一次判断 |
| 2 | llm | `{endpoint}` | 起草 3~5 条候选 |
| 3 | jev | `{endpoint}` | 候选排序 |

**表**：`call_logs`（调用级，含 `trace_id` / `request_id`）+ `audit_logs`（动作级）。
前端日志页支持：**按 traceId 拉完整链路**，以及按 kind / 时间 / 状态码筛选。

**权限**：**普通用户只能看自己的日志；admin 亦不允许查看任何用户的聊天日志**（皇上 2026-09-23 定）。
admin 的职责仅限用户管理（建号 / 停用 / 重置密码），不越权碰业务数据。

---

## 8. 场景体系

### 8.1 场景 = 题目集 + 提示词 + 面板配置

```python
class Scenario:
    slug: str                # romance / workplace / general / <custom>
    name: str                # 恋爱助手 / 职场助手 / 通用决策
    kind: ScenarioKind
    judge_questions: dict    # JEV 题目集（noul/choice/score）
    system_prompt: str       # LLM 起草回复的提示词
    rank_min / rank_max: int # 候选排序条数范围（默认 3~5）
    is_builtin: bool
```

### 8.2 预设场景

| 场景 | 题目集来源 |
|---|---|
| **恋爱助手** | **人工预设**：Jarvis 7 题移植 + `emotion`(18 类) + `emotion_intensity`(5 档) |
| **职场助手** | **agent-first**：参考项目里**没有现成的职场题目集**（Jarvis 仅一套混了恋爱/职场语境的通用题），故改由 **LLM 按场景描述现场生成**，用户确认后落库 |
| **通用决策** | 无固定题目，进入「决策工作台」自由提问 |

#### agent-first 的题目生成（职场场景为例）

```text
用户填写 / 选择场景描述（如"职场沟通：同事 / 上下级 / 客户"）
      ↓
LLM 生成题目集草案（noul / choice / score 混排，英文 instructions + 判别规则）
      ↓
用户预览、增删改（可再交 LLM 润色修订）
      ↓
落库为该场景的 judge_questions / persona_questions
```

> **理由**：题目集的判别规则本质是"业务知识"，人工硬写一套通用题容易失真；
> 交 LLM 按场景生成、人工把关，是 **agent-first** 的合理落法。
> **生成结果必须经用户确认才落库**，不自作主张。

### 8.3 自定义场景

用户可复制任一预设场景另存为自定义，编辑题目集（增删题、改选项、改 instructions）与提示词。

### 8.4 聊天场景完整链路（定调：**JEV 决策 → LLM 表达 → 用户定夺**）

```text
① 输入         用户粘贴对方的话（可附图片 → 原样交多模态 LLM，系统不做 OCR）
      ↓
② 上下文装配    记忆 + 人设档案 + 滚动摘要 + 最近消息（双预算裁剪，见 §8.5）
      ↓
③ 翻译桥（入）  LLM 把中文上下文译成英文 ——【凡送 JEV 的内容一律先译】（见 §9.6）
      ↓
④ JEV 判断      场景题目集一次调用 → 输出对「对话者」的各种决策
                （情绪 / 意图 / 危险度 / 该不该实质回复 / 最佳动作 / 她需要什么 / …）
      ├─ 信息不足 → ⑤ LLM 生成追问 → 用户补充 → 回到 ②   【可选，轮次不设上限】
      ↓
⑥ 翻译桥（出）  JEV 的英文结果转回中文展示
      ↓
⑦ 人设更新      JEV 建模题（信息足够时自动更新）→ personas（见 §8.6）
      ↓
⑧ 用户查看决策 ──【用户手动触发】──→ ⑨ LLM 起草 3 条中文候选（严格依据 JEV 的决策）
      ↓
⑩ JEV 排序      对这 3 条候选做优劣决策（同样经翻译桥）
      ↓
⑪ 用户定夺      选一条 / 自己改写 / 自己写 → 落库
```

**两条铁律（JEV 与 LLM 的本质分工）：**

1. **JEV 只出决策、不产文本；回复文本一律由 LLM 写。**
   - JEV 负责：情绪、意图、危险度、该不该回、最佳动作、她需要什么、候选孰优
   - LLM 负责：把决策落成自然语言、翻译、追问、润色
   - **LLM 不得直接给出"你该怎么回"的建议** —— 那是 JEV 的活
2. **②→⑦ 是「分析」，⑧→⑪ 是「生成」，两者之间由用户手动触发。**
   用户可以只看决策、不生成回复（**纯分析模式**），也可以在信息不足时先补充再要方案。

**⑧ 之后，用户有三个选择**（系统是**辅助**，不是必经之路）：

1. 点「生成回复」→ 走 ⑨⑩⑪（系统给 3 条候选 + JEV 排序）
2. **自己写** —— 完全不靠系统生成候选，**也可以跳过 JEV 排序**
3. 只要决策，什么都不生成（**纯分析模式**）

**决策权归属**：系统给决策与方案，**拍板永远在用户**。

> **记忆复盘的位置**：不在这条主链路上。它由「消息累积到阈值 / 用户手动点复盘」触发（见 §8.8），
> 与单次分析解耦 —— 因此链路图里不出现，但它是记忆更新与 `background` 的来源。

### 8.5 上下文管理（双预算）

同一份会话要喂给**两个脑子**，因此有两套独立预算：

| 消费方 | 预算 | 超限动作 |
|---|---|---|
| **LLM** | **默认 64K token，可配置**（用户按自己模型的实际窗口填） | 触发压缩：较老消息交给 LLM 摘要，写入 `session_summaries` |
| **JEV** | **装配预算：默认 1500 字符，可配** | 装配器裁剪：从优先级最低者起整块删除，绝不截半句 |

> **⚠️ 概念澄清（皇上 2026-09-23 指出）**：1500 **不是 JEV 模型的输入上限**，
> 而是**我们自设的装配预算**。它抄自 Jarvis v1.3 的 `ContextBuilder.BUDGET_CHARS = 1500`，
> 而该常量的注释写得很清楚 —— *"Deliberately dumb and cheap (v1.3 revision)"*，
> 是**为了省事省算力**定的硬预算，与模型能力无关。
>
> 且 Jarvis 的口径是 **`background` + `history` 合计**，
> **不含 `chat.messages`**（最近 10 条按**条数**限制，不占这个预算）。
>
> **JEV 真实能接多长取决于皇上部署的 System One 实例** —— 该默认值可放宽，
> 待确认实际限制后调整（见 §18 待办）。

> **关键**：请求 JEV 前**必须再过一次 JEV 专属预算** —— LLM 侧那份上下文不能原样丢给 JEV。
> JEV 是决策模型，**输入越精简判断越准**（这才是设预算的真正理由，而非模型装不下）。

装配器按优先级排序取材：

| 优先级 | 材料 | 来源 | 说明 |
|---|---|---|---|
| 1 | 当前会话最近 N 条消息 | `messages` | N 默认 10，随场景可配 |
| 2 | 关系记忆 | `memories`（**按对象过滤**，规则见下） | 偏好 / 雷区 / 口头禅 / 重要事件 |
| 3 | 人设档案 | `personas`（`counterpart_key` = 当前对象） | 该对象的「我」+「对方」两份 |
| 4 | 情绪轨迹 | `memories`（`category=情绪模式`） | 历次分析的情绪走向 —— 无独立字段，由记忆条目承载 |
| 5 | 滚动摘要 | `session_summaries` | 更早对话的 LLM 摘要 |

**记忆的对象过滤规则**（皇上审阅意见第 2 条）：

- `subject = me` / `relation` —— **始终参与**（全局共享）
- `subject = other` —— **仅当 `counterpart_key` 等于当前会话对象时参与**；
  留空视为"未归属"，**不进任何 background**，宁缺勿串

**裁剪规则**（修正此前"必带 / 可裁"的自相矛盾）：

- 1–3 为**优先保底**、4–5 为**可裁**；
- 但"保底"≠"永不裁"：当 1–3 自身已超预算时，**按条从最旧开始回退**（先退第 1 项消息），
  并在面板上明示「上下文已截断」，让用户知道判断依据被压缩过；
- 裁剪**永远整块删除**，绝不截半条消息或半句话。

- 压缩触发：LLM 侧上下文逼近**其配置的窗口上限**时，把 `upto_seq` 之前的消息压缩为一条新摘要
- 本次调用的**实际上下文**与 `trace_id` 一并写入 `call_logs`，**可完整回放**（见 §7）
- **字数与 token 的换算**：写代码时统一用"估算 token = 字符数 × 系数"的工具函数，
  中英混排系数不同（中文更贵），避免两套页面各算各的

### 8.6 人设建模（参考主流人格框架，JEV 驱动）

给「用户本人」与「聊天对象」各建一份档案。**维度不拍脑袋定，直接对齐成熟人格框架**：

| 框架 | JEV 题型 | 恋爱 | 职场 | 备注 |
|---|---|---|---|---|
| **大五人格 OCEAN** | score ×5 | ✅ 核心 | ✅ | **科学性最强**（数十年复制研究）；用**连续谱**而非固定类型 |
| **依恋类型** | choice(4) | ✅ 核心 | — | 安全 / 焦虑 / 回避 / 混乱；关系领域证据充分 |
| **爱的五种语言** | choice(5) | ✅ 高实用 | — | 肯定言词 / 精心时刻 / 接受礼物 / 服务的行动 / 身体接触 |
| **冲突处理风格** | choice(5) | ✅ | ✅ | 竞争 / 协作 / 妥协 / 回避 / 迁就（Thomas-Kilmann 思路） |
| **HSP 高敏感** | score | ✅ | ✅ | 情绪敏感度量表思路 |
| **MBTI 四维** | choice ×4 | 🟡 趣味 | 🟡 | 流行度最高、有话题性；**但科学性弱**（独立研究显示重测有 39–76% 的人换型） |
| **DISC** | choice(4) | — | ✅ | 职场场景 |

> **诚实原则**：MBTI 这类科学性弱的框架，UI 上必须标注"**仅供参考、非临床诊断**"，
> 不与大五混为一谈。皇上素来反对夸大，这里也不该给用户错觉。

> **人设题集的归属**：人设题**挂在场景上**（`scenarios.persona_questions`），随场景切换 ——
> 恋爱场景出「依恋类型 / 爱的五种语言 / 大五」，职场场景出「DISC / 冲突风格 / 大五」，**两者不混用**。

#### 证据来源分三档（置信度不同）

| 来源 | 用于 | 置信度 |
|---|---|---|
| **自评问卷** | 「我」 | 最高（用户自己答题） |
| **对话推断** | 「对方」 | 中（JEV 从聊天记录推断，**必带 `evidence` 引用具体消息**） |
| **混合** | 两者 | 自评为主 + 对话修正 |

#### 与「追问」的闭环 ⭐

人设维度**决定 LLM 该问什么**：某个维度证据不足（`evidence_sufficient = false`）→
LLM 针对**该维度**生成追问 → 用户补充 → 重新建模。
这样追问不是乱问，而是**直奔缺口**。

#### 应用价值（有研究支撑的用法）

- 大五的「**低神经质 + 高宜人性**」与关系满意度正相关（元分析结论）→ 可做**关系健康度**提示
- 依恋类型的「**焦虑 × 回避**」组合是经典"追逃循环" → 可做**风险提示**

#### 关键约束

- `evidence_sufficient` 为假或置信度不足 → **保留旧档案、不覆盖**，避免一次误判污染长期画像
- 每次更新保留 `version`，可回溯；`personas.traits` 存结构化结果，`evidence` 存依据

### 8.7 建模素材：四类来源与导入

人设建模**不局限于站内会话**，支持四类素材：

| # | 素材 | 形态 | 处理 |
|---|---|---|---|
| 1 | 对话推断 | 站内会话消息 | 直接装配（基础能力） |
| 2 | **聊天记录导入** | 文本（多行「角色: 内容」，或上传文件） | **解析成 `messages` 入库**，此后与站内会话同等对待 |
| 3 | **QA 对** | JSON 数组 `[{question, answer, tags?}]` | 写入 `qa_pairs`，装配时作为背景，**并作为建模证据** |
| 4 | **聊天记录截图** | 图片 | 存 `materials`；**仅当所选 LLM 支持多模态时**原文交 LLM 读图（**系统不做 OCR**） |

#### 聊天记录导入的解析约定

- 支持「`我:` / `她:` 内容」逐行格式，角色标签可由用户自定义映射（如「老婆」「宝宝」→ 对方）
- 解析结果写入 `messages` 并标 `source=import`
- **导入前必须给用户预览确认**（认出多少条、角色判对没有），**绝不静默入库**

#### QA 对导入

```json
[
  { "question": "她最喜欢的食物？", "answer": "可颂、草莓蛋糕", "tags": ["偏好"] },
  { "question": "她的雷区？", "answer": "不要提前任", "tags": ["雷区"] }
]
```

- 校验：必须为数组、每项含 `question` 与 `answer`；条数、单条长度、总字数均设上限
- 用途：参与上下文装配（背景）**并且**作为 JEV 建模的输入证据
- 与记忆体系的关系：QA 对是**用户直接给的**，**置信度高于自动抽取的记忆**；冲突时以 QA 对为准

#### 截图的约束

- 仅在选中**多模态 LLM**（`supports_vision`）时可用；否则入口置灰并说明原因
- 系统**不做任何 OCR**，图片原样交 LLM
- 留存策略由用户选：默认「分析后不留原图，只留提取结果」

### 8.8 记忆治理：LLM 复盘与总结（参考主流 agent 记忆方案）

**不采用** Copilot 那种正则抽取（噪声大、只做到"记住"），改为 **LLM 复盘 + 总结**。
借鉴 2026 年开源主流方案：

| 方案 | 借鉴点 |
|---|---|
| **Mem0**（48K★，生态最广） | LLM 抽取事实 + **增删改决策**（ADD / UPDATE / INVALIDATE / NOOP）+ 多信号检索（semantic + BM25 + entity） |
| **Zep / Graphiti** | **时序事实**：事实变更**不覆盖**，旧的置 `validTo`、新的立 `validFrom`，可回答"当时为真的是什么"（LongMemEval 上 63.8% vs Mem0 49.0%，差距正来自时序模型） |
| **Letta / MemGPT** | **后台复盘（sleep-time 整理）**：Agent 自主反思、提炼、整理自己的记忆；分层 core / recall / archival |
| **腾讯云 Agent Memory** | 分层蒸馏 + **冲突仲裁** |

#### 我们的设计

> **边界（皇上 2026-09-23 定）**：**只依赖 SQLite，不接任何云端记忆服务**（Mem0 Cloud / Zep Cloud 一律不用），
> 数据与逻辑**全部在本项目内自管**。
> 借鉴 Mem0 的**接口形态与写入决策模型**（add / search / update / delete），**自己实现**；
> 日后若需向量检索，也只采用**本地自托管**方案（如 `sqlite-vec` 扩展），**数据绝不外发**。

1. **记忆条目化** —— 每条记忆是一个结构化条目：
   `{ subject(me/other/relation), category, content, valid_from, valid_to, confidence, source, evidence }`
2. **写入决策**（抄 Mem0）：
   - `ADD` 新信息
   - `UPDATE` 补充或修正既有条目
   - `INVALIDATE` 旧条目置 `valid_to`（**不物理删除**，保留历史）
   - `NOOP` 重复信息，不动
3. **复盘管线**（抄 Letta 的 sleep-time 思路）：
   - 触发：会话消息累积到阈值 / 用户手动点「复盘」
   - 流程：LLM 读本段对话 → 产出**记忆变更集** → 冲突仲裁 → 应用 → 写 `memory_reflections` 留痕（**可撤销**）
4. **冲突仲裁**：
   - **用户直接提交的 QA 对优先级最高**（其次：近期证据 > 久远证据）
   - 无法判定时**不覆盖**，标记 `confidence` 待用户确认
5. **检索**：一期用「类别 + 关键词」过滤；接口按 `search` 形态预留**本地**向量检索位（如 `sqlite-vec`），**绝不接云**
6. **记忆是用户级**（皇上已定）：跨聊天对象共享，不按会话切分（见 §4）

> 与"人设"的分工：**记忆**记"是什么"（事实、偏好、事件），**人设**记"是什么样的人"（人格维度）。
> 两者都由 LLM/JEV 从对话中提炼，但记忆是**用户级**、人设是**按对象级**。

**允许重复存储**（皇上 2026-09-23 定）：同一条信息（如"她生气时会冷战"）**可以同时进记忆与人设**，
**不为去重设前置约束**；去重与整合**交给 LLM 复盘时统一处理**。

> 即：**写入宽松、复盘收敛**。好处是不必在入库时判断"该进哪边"（这个判断本身就易错），
> 也不会因为误判而丢信息；代价是复盘任务要承担整合职责，属可接受开销。

---

## 9. JEV 集成

### 9.1 端点与协议约束

**端点**：用户填写**完整 URL**（如 `https://your-host/v1/systemone`），系统不做任何路径拼接、不做 provider 推断。

**协议（硬约束，须在配置页明示用户）**：本项目**只支持 System One 协议**：

- 请求体固定 `{ model, state, questions }`
- 题型限三种：`noul`（是非概率）/ `choice`（分类 + 概率）/ `score`（评分）
- 响应固定 `{ model, answers, usage? }`，`answers` 为 `key → 答案对象` 字典

> **不兼容 System One 的端点无法使用**。若将来要接异构协议，在 `clients/jev_client.py` 加适配层
> （对外接口不变），**不在业务层做分支**。

### 9.2 state 结构（抄 Jarvis）

```json
{
  "chat": {
    "relationship": "女朋友",
    "messages": [{ "from": "other", "text": "..." }],
    "latest_from": "other"
  },
  "background": "关系：女朋友；偏好：可颂；雷区：别提前任；最近情绪趋势：失望→委屈",
  "history": [{ "from": "me", "text": "..." }]
}
```

- `messages` 取最近 **10** 条；`background` / `history` **为空时省略字段**
- `background` 由记忆体系序列化（上限 **1500 字符**，先删最旧、绝不截半句）

### 9.3 题目集（`scenarios/builders.py`）

```python
BACKGROUND_NOTE = " Facts given in background are provided context, not off-topic."
# 每道题的 instructions 末尾都追加该句（抄 Jarvis）
```

三种构造器：`noul(question, {true, false})` / `choice(question, {k: label})` / `score(question, [levels])`

**恋爱场景的 10 道题**：

| key | 题型 | 说明 |
|---|---|---|
| `literal_question` | noul | 最新消息是否纯字面、无潜台词 |
| `true_intent` | choice(6) | confirm_you_care / vent_anger / request_action / seek_explanation / casual_chat / close_topic |
| `danger_level` | score(10 档) | 离吵架 / 伤关系有多近 |
| `should_reply_now` | noul | 下条消息是否该含实质内容 |
| `best_action` | choice(7) | check_history / apologize / give_commitment / explain / acknowledge / say_less / make_plan |
| `she_needs` | choice(5) | apology / action / explanation / care / nothing |
| `tension_resolved` | noul | 紧张是否已化解 |
| `emotion` | choice(18) | **保留**：18 类情绪 |
| `emotion_intensity` | score(5 档) | **保留**：情绪强度 |
| **`context_sufficient`** | noul | **信息是否足以判断** —— 为假则触发 LLM 追问（见 §8.4） |

> 前 7 题来自 Jarvis，英文 instructions 原样移植（含关键判别规则），但**职场语汇需按恋爱场景改写**。

### 9.4 防御性重试（抄 Jarvis）

带 `background` / `history` 的请求若返回 **4xx**，自动去掉这两个字段重试一次 ——
未验证字段**只能降级分析，不能打断分析**。

### 9.5 候选排序（生成 3 条，排序题支持 3~5）

- **默认起草 3 条**（皇上定的主流程）：`rank_question(candidates)` 的 `criteria` 为候选文本字典
  （`reply_a` / `reply_b` / `reply_c`…），返回各候选概率，前端按占比降序。
- **排序题键数动态**：场景可配 `rank_min` / `rank_max`（默认 3~5），构造器按实际条数生成 `reply_a…reply_e`。
- ⚠️ **需重新校准**：Jarvis 的排序题是**硬性 3 条**且已用真实对话校准过；若要支持 4、5 条，
  需用 `tools/jev` 的脚手架重新跑一批标注。

### 9.6 翻译桥：非英文入参才翻译 ⭐

**背景**：JEV 主训练语言是英文，**对中文等非英文不友好**。
Jarvis 的做法是"题目英文 + 聊天内容保留中文"，本方案**更进一步**。

**触发规则（皇上 2026-09-23 定）：由用户发送的原文语言决定 —— 除纯英文外都需要译成英文。**

| 原文语言 | 入向 | 出向 |
|---|---|---|
| **非英文**（中文 / 日文…） | LLM 译成英文 → 送 JEV | JEV 结果**译回原文语言**展示 |
| **纯英文** | **跳过翻译**，直接送 JEV | **不回译**（枚举按英文展示） |

| 环节 | 处理 |
|---|---|
| **题目层** | 预设场景的题目与 criteria 本就是英文（Jarvis 原样）；**自定义场景**的中文题目 / 选项，送 JEV 前由 LLM 译为英文，并缓存「英文选项 ↔ 原文」映射 |
| **上下文层** | `state` 里的对话按上表规则处理；**英文内容原样通过** |
| **结果层** | JEV 返回的枚举值（`confirm_you_care`、`danger_level=4`）走**本地映射表**转成用户语言的标签；自由文本才由 LLM 回译 |

**语言判定**：**含任何非 ASCII 字符即走翻译**，不额外调用 LLM。
这样中英混排（如「今天 meeting 太多」）不会被误判成纯英文而漏译；
判定不确定时**默认走翻译** —— 宁可多译一次，不可漏译。

**翻译 prompt 必须要求保留情绪信号**（皇上审阅意见第 7 条）：

- **标点风格原样保留** —— 句号结尾的冷淡感、连用「？？？」的急迫感，都是信号
- **emoji / 颜文字 / 重复字符**（「好好好」）不省略、不改写
- **语气词**（「嗯」「哦」「呵呵」）保留原始形态，不替换成通用英文语气词

> 语气损耗无法根除，只能缓解。**`call_logs` 已存双语对照**（送 JEV 的英文版 + 用户看到的中文版），
> 前端日志页应提供**并排对照视图** —— 便于区分"是翻译错还是判断错"。

**成本控制**：枚举走本地映射表（零 LLM 成本）；仅自由文本才需回译调用。

**落库要求**：翻译前后的文本都写入 `call_logs`（送 JEV 的是英文版，用户看到的是原文语言版），
便于对照排查"是翻译错还是判断错"。

---

## 10. LLM 集成

- **OpenAI 兼容**：`POST {endpoint_url}`（用户自填完整 URL），`Authorization: Bearer <key>`
- **必须有**：未配置时聊天场景返回明确错误（不做本地兜底合成）
- **多模态**：配置项 `supports_vision`；开启时图片以 `image_url` 内容块随请求发送
- **无 OCR**：系统不做任何图片文字识别；图片原样交给用户的多模态 LLM
- **`response_format: json_object`**：400 时降级重试（抄 Copilot 的做法）
- **上下文预算 64K token**：逼近上限即触发摘要压缩（见 §8.5）
- **翻译桥职责**：**仅当原文非英文时才触发**（入向译英）；出向按原文语言按需回译（见 §9.6）
- **LLM 的职责边界**：分析 / 提问 / 起草 / 翻译 —— **不得充当决策者**（见 §8.4 三原则）

### 10.1 输入润色服务（全场景可用）⭐

皇上要求：**用户在输入框填的内容，都可交给 LLM 润色提升** —— 聊天场景与通用决策都适用。

| 适用位置 | 润色目标 |
|---|---|
| 聊天副驾：粘贴的对话文本 | 补全主语、去歧义、修错别字 —— 让 **JEV 判断更准** |
| 聊天副驾：用户**自拟的回复** | 语气调整（更体贴 / 更简短 / 更像本人），**保持原意** |
| 决策工作台：题目 instructions | **改写成可判定的规范提问**（JEV 最吃这一套） |
| 决策工作台：选项标签 | 选项互斥、表述清晰、长度相当 |
| 自定义场景：整份题目集 | 同上，支持批量润色 |

**交互设计**（皇上 2026-09-23 定）：

- 每个文本输入旁给「✨ 润色」入口
- 点击后**直接以润色稿替换用户的输入** —— 一步到位，不做对比确认
- 方向可选（"更简短" / "更正式" / "更口语" …）：选定后重新润色并再次直接替换
- 替换后给一个轻量 Toast「**已润色 · 撤回**」，留一条后路但不打断流程

> ⚠️ **工程注意**：直接替换意味着连点润色会**在已润色版本上继续加工**，可能语义漂移。
> 因此前端需记住**用户原始输入**，二次润色仍基于原文（而非上一次结果），撤回也回到原文。

**实现**：

- `POST /api/polish`，走用户自配的 LLM（`response_format: json_object`）
- 与翻译桥的分工：**润色在中文侧完成**，送入 JEV 前**再**走翻译桥译成英文 —— 两步分开，职责清晰、便于排查
- 计入 `call_logs`（`kind=llm`，同一 `trace_id`）

### 10.2 上游调用的超时、重试与降级（JEV / LLM 通用）

| 项 | JEV | LLM |
|---|---|---|
| 超时 | 45s（可配） | 60s（可配） |
| 重试 | **429 / 529 / 5xx 指数退避，最多 3 次**（抄 Jarvis / Copilot） | 同左 |
| 4xx 特殊处理 | 带 `background` / `history` 的 4xx → **去掉这两字段重试一次**（见 §9.4） | `response_format` 引发 400 → **去掉该字段重试一次** |
| 失败后 | 明确错误文案 + **保留本次输入**，用户可一键重试 | 同左 |

**统一对外错误模型**：

```json
{ "error": { "code": "JEV_UPSTREAM_ERROR", "message": "…", "trace_id": "…", "retryable": true } }
```

`code` 的取值与前端引导：

| code | 前端动作 |
|---|---|
| `JEV_NOT_CONFIGURED` / `LLM_NOT_CONFIGURED` | 引导去设置页配置 |
| `PROTOCOL_MISMATCH` | **明确告知"该端点不是 System One 协议"**，引导换端点 |
| `RATE_LIMITED` | 提示稍后重试 |
| `JEV_UPSTREAM_ERROR` / `LLM_UPSTREAM_ERROR` | 展示上游状态码摘要（已脱敏）+ 重试按钮 |

- 任何上游失败**不得导致进程退出**（沿用 hlg 的 `handle()` 包装思路）
- **连通性测试**失败时必须回传上游**原始状态码与摘要**（已脱敏），不能只说"测试失败"

---

## 11. API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` `/logout` | 登录 / 登出 |
| GET | `/api/auth/me` | 当前用户 |
| POST | `/api/account/password` | 改密（含强制改密路径） |
| GET/POST/PATCH/DELETE | `/api/providers` | JEV/LLM 配置 CRUD（Key 只进不出，回显为掩码） |
| POST | `/api/providers/{id}/test` | **连通性测试**（发最小请求验证 URL/Key/模型） |
| GET/POST/PATCH/DELETE | `/api/scenarios` | 场景 CRUD（预设只读） |
| POST | `/api/chat/analyze` | 聊天判断（题目集一次调用；同时返回是否需要追问） |
| POST | `/api/chat/clarify` | **新**：信息不足时由 LLM 生成追问问题 |
| POST | `/api/chat/reply` | LLM 起草 3~5 条 → JEV 排序 |
| POST | `/api/chat/evaluate` | **新**：对「用户自拟方案」做 JEV 评估 / 排序 |
| POST | `/api/decide` | **通用决策**：任意 questions + state |
| POST | `/api/polish` | **新**：输入润色（全场景），返回润色稿由前端**直接替换**输入 |
| GET/PUT | `/api/personas` | **新**：人设档案读写（`subject=me\|other`） |
| POST | `/api/personas/build` | **新**：触发 JEV 人设建模 |
| GET/POST/PATCH/DELETE | `/api/conversations` | **会话 CRUD**（创建 / 重命名 / 删除） |
| GET/POST | `/api/conversations/{id}/messages` | **消息读写**（按用户隔离） |
| GET | `/api/export` | **新**：导出本人全部数据（JSON，便于用户自留存） |
| DELETE | `/api/account` | **新**：账号注销，连带清除本人全部数据 |
| GET/PUT | `/api/memories` | 记忆条目读写（**用户级**） |
| POST | `/api/memories/reflect` | **新**：触发 LLM 复盘，产出记忆变更集（ADD / UPDATE / INVALIDATE / NOOP） |
| POST | `/api/memories/apply` | **新**：确认或撤销复盘变更（写入 `memory_reflections`） |
| POST | `/api/import/chat` | **新**：导入聊天记录（解析 → 预览确认 → 入库） |
| POST | `/api/import/qa` | **新**：导入 QA 对 JSON |
| POST | `/api/materials/screenshot` | **新**：上传聊天截图（仅 `supports_vision` 时可用） |
| GET | `/api/logs/calls` | 调用日志查询（**可按 traceId 拉完整链路**） |

---

## 12. 前端页面

| 页面 | 内容 |
|---|---|
| 登录 / 强制改密 | 参考 hlg admin |
| **聊天副驾** | 选场景 + 选会话 → 粘贴对方的话 → 判断面板（危险等级 / 真实意图 / 最佳动作 / 她需要什么 / 情绪）→ **信息不足时弹 LLM 追问卡片**（答完继续）→ 候选方案（按 JEV 占比排序）→ **可选：自行改写或自拟方案，并请 JEV 评估** |
| **人设档案** | 查看 / 编辑「我」与「对方」的人设（依恋倾向 / 表达方式 / 冲突风格…）+ 置信度与依据溯源 |
| **决策工作台** | 题目编辑器（题型/问题/选项）+ 上下文框 → 结果可视化（noul 概率条 / choice 概率条形图 / score 刻度条）+ 存为模板 |
| **设置** | JEV 与 LLM 两卡：完整 URL / Key / 模型 / 支持图片 + **一键连通测试** |
| **场景管理** | 预设场景列表 + 自定义场景编辑（含**人设题集**编辑） |
| **记忆管理** | **新**：记忆条目列表（按类别 / 主体筛选）、手动增改、**复盘变更集的查看与撤销** |
| **日志** | 调用日志（kind / 时间 / 状态码筛选）+ **按 traceId 拉完整链路** + 详情（脱敏后的请求响应） |

**移动端适配**（皇上 2026-09-23 定，需求 18）：

- **聊天副驾是高频移动场景，优先适配**：≥360px 宽可用、可单手操作、**软键盘不遮挡输入框**
- 布局切换：桌面**双栏**（会话列表 + 判断面板）↔ 移动**单栏**（面板以底部弹层 / 抽屉展开）
- 决策工作台与设置页同样响应式，但**可优先保证桌面体验**
- 技术：Tailwind 响应式断点；**不做独立 App、不做 PWA**（纯 Web 响应式）

---

## 13. 分阶段实施

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P0 基座** | 项目骨架 + Settings/APP_SECRET + **全部表一次建成** + 用户/session + 登录/改密/限流 + **会话/消息 CRUD** + 前端登录页 | 能登录改密；**表结构齐备**；能建会话与消息 |
| **P1 配置与连通** | provider_configs（Key 加密）+ CRUD + **连通性测试** + 设置页（含 **上下文窗口** 配置项） | 填错 URL/Key 有明显报错；填对可通过 |
| **P2 上下文与记忆** | context assembler（**双预算**）+ 滚动摘要 + **记忆治理：LLM 复盘管线 / 条目化时序 / 写入决策 / 冲突仲裁** | 超限裁剪正确；复盘变更集可回溯、可撤销 |
| **P3 JEV 内核** | builders + 恋爱场景 10 题 + jev_client（**协议校验** + 防御性重试 + 失败降级）+ `/chat/analyze` | 一次调用返回 10 项判断；上游失败有明确提示且不崩 |
| **P4 LLM 与翻译桥** | llm_client（vision + 可配窗口）+ **中→英翻译桥** + `/chat/clarify` 追问闭环 + **`/api/polish` 输入润色** | 送 JEV 入参为英文；润色直接替换输入并可撤回 |
| **P5 素材导入 + 人设建模** | **聊天记录导入（预览确认）** + **QA 对导入** + **多模态截图** + personas + **场景级人设题集** + `/personas/build` + 人设页 | 导入前预览确认；低置信度**不覆盖**旧档案；科学性弱的有明示 |
| **P6 方案链路** | LLM 起草 3 条 + JEV 排序 + 用户定夺 + `/chat/evaluate` | 候选按占比排序；自拟方案可被评估 |
| **P7 通用决策 + 场景化** | `/decide` + 决策工作台页 + 职场场景题目集 + 自定义场景 | 三种题型可视化正确；可复制预设并改题 |
| **P8 日志与数据权利** | call_logs(trace_id) + 脱敏 + 日志页 + **记忆管理页** + **数据导出 / 账号注销** | 日志无 Key 泄漏；traceId 可拉全链路；能导出并清空自己的数据 |

---

## 14. 已定事项（皇上 2026-09-23 批复）

| # | 事项 | 批复 |
|---|---|---|
| 1 | **项目名** | **`helpme-jev`** |
| 2 | **日志形态** | **明文进日志**；凭 **traceId** 查完整链路；apiKey 类凭据不入日志（见 §7） |
| 3 | **JEV / LLM 端点** | 填**完整 URL**，系统不做任何路径拼接（见 §9.1） |
| 4 | **admin 权限** | **仅管用户**（建号 / 停用 / 重置密码）；**admin 亦不允许查看任何用户的日志**（见 §7） |
| 5 | **追问轮次** | **不设上限** —— 直到 JEV 认为信息足够（见 §8.4） |
| 6 | **人设建模触发** | **自动更新**：每次分析后尝试，置信度不足则跳过、保留旧档案（见 §8.6） |
| 7 | **上下文预算** | **LLM 统一 64K token**，到限即压缩；**JEV 另设字符上限**，请求 JEV 前再过一次预算（见 §8.5） |
| 8 | **翻译桥** | 因 JEV 对中文不友好，**入参一律英文化**（题目层 + 上下文层），结果再转回中文（见 §9.6） |
| 9 | **人设框架** | 对齐主流人格测试（大五人格 / 依恋类型 / 爱的五种语言 / 冲突风格 / HSP / MBTI / DISC）；**科学性弱者须如实标注**（见 §8.6） |
| 10 | **记忆归属** | 记忆**按用户隔离、不区分聊天对象**（同一用户全部会话共享）；**人设相反，按对象区分**（见 §4） |
| 11 | **记忆治理** | 用 **LLM 自我复盘与总结**（参考 Mem0 / Zep / Letta），条目化 + 时序，**不用正则抽取**（见 §8.8） |
| 12 | **建模素材** | 聊天记录导入 / QA 对 JSON / 多模态截图（见 §8.7） |
| 13 | **依赖安装** | 已获授权，可直接安装所需依赖 |
| 14 | **输入润色** | 全场景可润色，**润色后直接替换用户输入**（不做对比确认），可撤回（见 §10.1） |
| 15 | **未配 LLM 的行为** | **不可用，直接报错**并引导去配置（见 §1 第 1 条） |
| 16 | **聊天主流程** | **JEV 决策 → 用户手动触发 → LLM 起草 3 条 → JEV 排序 → 用户定夺**；凡送 JEV 的内容一律先经 LLM 译英（见 §8.4 / §9.6） |
| 17 | **LLM 上下文窗口** | **可配置，默认 64K**（见 §8.5） |
| 18 | **JEV 协议** | **必须 System One 标准请求体与题型**（noul / choice / score）（见 §9.1） |
| 19 | **依赖边界** | **只依赖 SQLite，不接任何云端服务**（含记忆服务），数据与逻辑**全部本项目自管**（见 §8.8） |
| 20 | **数据权利** | 提供**数据导出**与**账号注销**（见 §11 / §13 P8） |
| 21 | **测试** | **必须写测试**（pytest；上游一律 mock；见 §16） |
| 22 | **部署运维** | 一期不做（不写 Docker / 运维章节） |
| 23 | **数据保留期** | **只对 `call_logs` 设 15 天滚动清除**；**`messages` 不按天数清** —— 只清"已被滚动摘要覆盖"的旧消息，以保证人设 `evidence`、情绪轨迹、复盘原料不断档（见 §4 / §8.5） |
| 24 | **移动端适配** | 前端**响应式适配手机**，聊天副驾优先（见 §12） |
| 25 | **记忆与人设** | **允许重复存储**，去重与整合交给 **LLM 复盘**统一处理（见 §8.8） |
| 26 | **职场场景题目集** | 参考项目**无现成题集** → 走 **agent-first**：LLM 生成 + 用户确认落库（见 §8.2） |
| 27 | **部署形态** | **单机 SQLite**（见 §2） |
| 28 | **生成回复的触发方式** | **纯粹手动触发**：分析完先给决策，用户点了才生成候选 —— **不做预热**。延迟优化只取"起草时一次输出中英双版"与"全程进度指示"（见 §17） |
| 29 | **数据迁移** | **Alembic 为 schema 唯一来源**（不用 `create_all` 建表）；启动时跑 `upgrade head`（见 §3 / §17） |
| 30 | **记忆对象归属** | `other` 类记忆**必带 `counterpart_key`**；`me`/`relation` 类留空＝全局共享（见 §4 / §8.5） |
| 31 | **JEV 装配预算** | 1500 字符是**我们自设的装配预算**（抄自 Jarvis v1.3 的省事约定），**不是 JEV 模型输入上限**；<br>真实上限取决于部署的 System One 实例，**确认后可放宽**（见 §8.5 澄清） |

---

## 15. 红线

- 服务端**所有**业务查询必须带 `owner_user_id` scope
- **admin 身份不构成查看他人聊天与日志的授权**（admin 只管用户）
- apiKey 明文绝不入日志 / 响应 / 异常栈
- 加密解密失败一律拒绝资源，不做降级猜测
- 每次业务操作必须带 `trace_id`，并贯穿其上下游全部 JEV / LLM 调用
- 每个阶段跑通测试再进下一阶段；提交用 Conventional Commits + 中文

---

## 16. 测试策略（皇上要求"需要测试"）

工具：**pytest**（后端为主）；前端一期不做 E2E。

### 16.1 必测清单（按风险排序）

| 优先级 | 对象 | 测什么 |
|---|---|---|
| **P0** | `core/security.py` | 信封加解密往返、**篡改密文必抛错**、AAD 用途绑定不可跨用、版本号解析 |
| **P0** | `clients/redaction.py` | 嵌套结构（dict / list / 深嵌套）里的 `api_key` / `token` / `Authorization` **必被抹除**；误粘贴的 key 形态串也被正则兜住 |
| **P0** | **用户隔离** | **换用户后取不到他人任何数据**（每张业务表一条用例，防越权回归） |
| **P1** | `clients/jev_client.py` | 协议校验、4xx 去 background/history 重试、429/5xx 退避、错误码映射 |
| **P1** | `clients/translation.py` | 翻译桥往返（中文 → 英文 → 枚举回中文）、映射表完整性 |
| **P1** | `services/context_service.py` | 双预算裁剪顺序（先删最旧、**绝不截半句**）、超限行为 |
| **P1** | `services/memory_service.py` | 四种写入决策、冲突仲裁优先级、复盘变更集**可撤销** |
| **P2** | `services/import_service.py` | 聊天记录解析（多种格式）、QA 对校验（非法 JSON 必须拒绝） |
| **P2** | `api/*` | 端点契约测试（含 `409` / `422` / `PROTOCOL_MISMATCH` 等错误码） |

### 16.2 上游一律 mock

**所有 JEV / LLM 调用在测试里必须 mock，不打真实上游**。
在 `tests/conftest.py` 提供 `fake_jev_response(...)` / `fake_llm_response(...)` 工厂，
并可注入 4xx / 429 / 超时等异常分支。

### 16.3 不测与例外

- 前端 UI 不做 E2E（人工验收）
- 职场场景题目集的"业务正确性"无法自动化 —— 需人工设计 + 真实对话校准

---

## 17. 审阅意见采纳记录（2026-09-23）

### 已立即落实

| # | 意见（指出的问题） | 落实方式 |
|---|---|---|
| 1 | messages 保留期与知识体系冲突 | §14 第 23 条改为：**只对 `call_logs` 设 15 天**；`messages` 只清"已被滚动摘要覆盖"的 |
| 2 | `other` 记忆无对象归属，跨对象会串 | `memories` 增 **`counterpart_key`**；§8.5 补过滤规则（`other` 类必带对象、未归属者不进 background） |
| 3 | 改名断 `counterpart_key`，人设成孤儿 | 代码改为**生成后冻结**（改名只动显示名），已加测试锁定 |
| 4 | 无迁移机制，后续改表会成为迁移地狱 | **引入 Alembic**（`migrations/`，`render_as_batch` 适配 SQLite）；<br>bootstrap 与测试夹具**均走 `alembic upgrade head`**，schema 单一来源；baseline 已生成 |
| 5 | §8.5「必带」与「可裁」自相矛盾 | §8.5 补：1–3 优先保底、4–5 可裁；**保底项自身超预算时按条从最旧回退，并在面板明示"上下文已截断"** |
| 6 | 语言判定规则需明确 | §9.6 改为「**含任何非 ASCII 字符即走翻译**」，避免中英混排误判 |
| 7 | 翻译桥语气损耗 | §9.6 补翻译 prompt 要求（**保留标点风格 / emoji / 重复字符 / 语气词**）+ 日志页**双语并排对照** |

### 采纳并排入阶段

| # | 意见 | 排期与做法 |
|---|---|---|
| 8 | **决策可解释层** | **P4**：LLM 基于「JEV 决策 + 消息」生成"为什么这么判"，UI 标注**由 LLM 解读、仅供参考**。属"表达"而非"决策"，**不破铁律** |
| 9 | **连通性测试 → 冒烟测试 + JEV 健康度** | **P1**：内置 3–5 组标准 case（典型输入 → 期望决策分布），连通测试时顺带跑出**健康度**；<br>**健康度未达标前，排序条数 UI 锁死 3 条**（顺带解决排序题校准问题） |
| 10 | **高危险度人文设计** | **P6**：`danger_level ≥ 8` 时，面板首屏不再是"3 条候选"，而是「**这已超出文字回复能解决的范围，建议当面或电话沟通**」 |
| 11 | **决策效果闭环** | **P8 之后**：复盘管线捕捉「上次定夺 → 本次情绪变化」的关联，让人设/记忆更新带上因果 |

### 小项

| # | 意见 | 落实 |
|---|---|---|
| 12 | 串行调用延迟（实为 **7 次**） | **P4**：LLM 起草时**一次输出中文候选 + 英文版**（省一次翻译调用）；<br>前端**全程逐步进度指示**（当前处于 翻译 / 判断 / 起草 / 排序 哪一步） |
| 13 | 追问地狱 | **P4**：面板常显「**信息充足度 xx%**」，并**永远保留「跳过追问，直接出结果」** —— 拍板在用户，不在 JEV |
| 14 | 依赖度提醒 | **P6**：统计「候选直接采用率 vs 手动改写率」，**只展示不说教** |
| 15 | token 存 localStorage 的 XSS 面 | 已在 §5 标注该取舍（自部署小圈子可接受；如需加固改 httpOnly cookie + CSRF） |

### 已定夺（皇上 2026-09-23）

**保留纯粹手动触发，不做预热。**

- 理由：送进 JEV 的 payload 本身很小（装配预算 1500 字符的 `background` + `history`，
  加最近 10 条消息），**判断链路本身很快**；
  延迟主要来自 LLM 起草那一次调用，预热能省的有限，不值得拿产品语义（用户要才生成）去换。
- 因此第 12 条的优化只取**两点**：
  1. LLM 起草时**一次输出中文候选 + 英文版**（省掉"候选再译英送去排序"这一次往返）
  2. 前端**全程逐步进度指示**（当前处于 翻译 / 判断 / 起草 / 排序 哪一步）
- **不引入**后台预热与"手动揭晓"式实现。
