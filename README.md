# HelpMe JEV

> **JEV 决策工作台** —— 以「聊天副驾」为第一个场景，向上提供**通用 JEV 决策能力**与**可自定义的细分场景**。

**核心分工：JEV 出决策，LLM 做表达，用户拍板。**

JEV（TypeSafe System One）只回答类型化问题（是非 / 分类 / 评分），**不生成文本**；
自然语言表达交给用户自配的 LLM；系统提供决策与方案，**最终选择权永远在用户手里**。

---

## 特性

- **聊天副驾**：粘贴对方的话 → JEV 一次判断（意图 / 危险度 / 最佳动作 / 她需要什么 / 情绪…）→
  必要时由 LLM 追问补全信息 → 用户手动触发才生成候选回复 → JEV 排序 → 人工定夺
- **通用决策工作台**：任意三题型自由提问
  - `noul` —— 是非概率（bool 决策）
  - `choice` —— 选项概率分布（给选项求置信度）
  - `score` —— 评分刻度
- **人设建模**：用 JEV 给「你」与「聊天对象」建模（大五人格 / 依恋类型 / 爱的五种语言 / 冲突风格 / MBTI 等）
- **记忆治理**：LLM 自我复盘与总结（条目化 + 时序，变更不覆盖、可回溯可撤销）
- **多模态**：图片原样交给多模态 LLM；**系统不做 OCR**
- **翻译桥**：JEV 对非英文不友好 —— 原文非英文时先译英再送 JEV，结果译回原文语言
- **输入润色**：聊天文本 / 自拟回复 / 决策题目，一键 LLM 润色并直接替换
- **全部自管**：只依赖 SQLite，**不接任何云端服务**，数据不出本机

## 技术栈

| 层 | 选型 |
|---|---|
| 后端 | Python 3.12+ / FastAPI / SQLAlchemy 2.x / SQLite（WAL）/ `uv` |
| 前端 | React 19 + Vite + Tailwind 4（响应式，适配手机） |
| 密码 | Argon2id |
| 加密 | HKDF-SHA256 → AES-256-GCM（信封 `hmj1.<ver>.<nonce>.<cipher+tag>`，AAD 用途绑定） |
| 认证 | 服务端 session + `Bearer` token（库中只存 SHA256）；**邀请码注册** |

## 快速开始

```bash
# 1. 安装依赖
uv sync

# 2. 生成 APP_SECRET（32 字节 CSPRNG 的 base64url，43 字符）
cp .env.example .env
python -c "import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip('='))"
# 把输出填进 .env 的 APP_SECRET=

# 3. 启动
uv run uvicorn app.main:app --reload --port 8790
```

首次启动会自动建表并创建默认管理员（`admin` / 见 `.env.example`），**首次登录强制改密**。

## 目录结构

```text
app/
├── core/          # 配置、加密、DB、脱敏、限流、时间
├── domain/        # 枚举、错误、Schema
├── repositories/  # ORM 模型 + 数据访问
├── services/      # 业务用例
├── clients/       # JEV / LLM / 翻译桥 / 脱敏
├── scenarios/     # 各场景题目集
└── api/           # HTTP 接口
web/               # 前端（React 19 + Vite）
docs/              # 设计与工作流文档
tests/             # pytest
```

## 文档

- [`docs/DESIGN.md`](docs/DESIGN.md) —— 完整设计方案（需求、数据模型、接口契约、分阶段实施）
- [`docs/WORKFLOW.md`](docs/WORKFLOW.md) —— 工作流与场景清单
- [`docs/REVIEW.md`](docs/REVIEW.md) —— 设计审阅意见与处理结果

## 安全与隐私

- 用户配置的 apiKey **加密存储**（AES-256-GCM 信封），接口只进不出
- 调用日志记录完整请求响应但**必经脱敏**，apiKey 绝不入库
- 查询全部带 `owner_user_id` 隔离；**admin 也不可查看他人聊天与日志**
- 日志与聊天记录默认 **15 天**滚动清除
- 提供**数据导出**与**账号注销**

## 许可

[AGPL-3.0](LICENSE) © 2026 故笙

本项目以 AGPL-3.0 授权：你可以自由使用、修改、分发，但**若以网络服务形式提供**，
必须向使用者提供完整源代码。
