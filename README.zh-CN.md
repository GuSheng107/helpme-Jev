# HelpMe JEV

<p align="center">
  <strong>help me, JEV!</strong><br>
  <sub>遇到不会回答的问题怎么办？找 JEV。</sub><br>
  <sub>When a question is hard to answer, ask JEV.</sub>
</p>

<p align="center">
  一个小而完整的自托管工具，帮你处理难回的消息和拿不准的决定。<br>
  <strong>JEV 负责判断，LLM 处理语言任务，下一步由你决定。</strong>
</p>

<p align="center">
  <a href="https://github.com/GuSheng107/helpme-jev/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/GuSheng107/helpme-jev/ci.yml?style=flat-square&label=ci" alt="CI"></a>
  <a href="https://github.com/GuSheng107/helpme-jev"><img src="https://img.shields.io/github/stars/GuSheng107/helpme-jev?style=flat-square" alt="GitHub stars"></a>
  <a href="https://github.com/GuSheng107/helpme-jev/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square" alt="AGPL-3.0"></a>
  <a href="https://www.python.org/"><img src="https://img.shields.io/badge/python-3.12%2B-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python 3.12+"></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/react-19-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React 19"></a>
</p>

<p align="center">
  简体中文 · <a href="README.md">English</a>
</p>

> [!NOTE]
> HelpMe JEV 当前是自托管的 <code>0.1.0</code> 项目。它是帮你理清问题的工具，不替你开口，也不替你做最终决定。实际效果取决于你配置的 JEV 与 LLM 接口。

## 为什么做这个

有些问题看起来很小，真正回答起来却很难：

- “这句话是真的有问题，还是我想多了？”
- “现在回、再问一句，还是先放着？”
- “在职场里，下一步怎么做风险更小？”
- “能不能把这句话说清楚一点，但别把语气改了？”

把消息、截图或事情经过贴进来。HelpMe JEV 会把它拆成几项具体判断和几个可能的下一步。你可以检查输入、修改草稿、保留有用的上下文，也可以在发送之前随时停下。

> **JEV 负责判断，LLM 帮忙表达，最后还是你决定。**

JEV（TypeSafe System One）回答的是有类型的问题，例如是非概率、选项概率和评分。它不负责写最终消息。LLM 负责把输入翻译给 JEV，并可按需追问、起草或润色。程序支持 OpenAI Chat Completions、OpenAI Responses 和 Anthropic Messages 协议。

## 它能做什么

| 方向 | 能做的事 |
| --- | --- |
| 聊天助手 | 判断意图、风险、情绪、需求和可能的下一步。 |
| 通用决策 | 不进入聊天，直接提出 <code>noul</code>、<code>choice</code>、<code>score</code> 三类问题。 |
| 场景 | 内置恋爱、职场场景，也可以复制后改成自己的题集。 |
| 人与上下文 | 分开保存“你”和“对方”的上下文；用证据和置信度记录轻量人设。 |
| 记忆 | 让 LLM 把有用上下文总结成带日期的条目，可以查看、撤销或删除。 |
| 图片 | 支持粘贴或上传 PNG/JPEG/WEBP 截图，一条消息最多 9 张；由支持视觉的 LLM 描述，系统不做 OCR。 |
| 表达辅助 | 润色消息、补充问题、生成候选回复，再由 JEV 排序。 |
| 数据控制 | SQLite 存储、数据导出、账号注销、按用户隔离、可追踪调用日志，以及加密保存的提供方密钥。 |

## 基本流程

~~~mermaid
flowchart LR
    A["粘贴消息<br/>或截图"] --> B["需要时补充<br/>上下文"]
    B --> C["JEV 需要时<br/>先翻译成英文"]
    C --> D["JEV 回答<br/>类型化问题"]
    D --> E["可选 LLM<br/>追问或起草"]
    E --> F["JEV 比较<br/>候选回复"]
    F --> G["你来修改、发送、<br/>等待或停止"]
~~~

不会自动发送任何内容，最后一步始终由你决定。

## 快速开始

### 环境要求

- Python 3.12 或更高版本
- [uv](https://docs.astral.sh/uv/)
- Node.js 20 或更高版本，用于前端开发服务器和构建
- 如果要进行真实分析，还需要一个兼容 System One 协议的 JEV 接口，以及使用上述任一协议的 LLM 接口

### 1. 克隆并安装

~~~bash
git clone https://github.com/GuSheng107/helpme-jev.git
cd helpme-jev

uv sync --locked
cp .env.example .env
~~~

PowerShell 下把 <code>cp</code> 换成 <code>Copy-Item .env.example .env</code>。

生成 32 字节密钥，把输出填入 <code>.env</code> 的 <code>APP_SECRET</code>：

~~~bash
python -c "import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip('='))"
~~~

请妥善保存 <code>APP_SECRET</code>。更换它会导致已经加密保存的提供方密钥无法读取。

### 2. 启动后端

~~~bash
uv run uvicorn app.main:app --reload --port 8790
~~~

第一次启动时，程序会：

1. 执行 Alembic 数据库迁移；
2. 检查预期的数据表是否完整；
3. 仅在数据库没有用户时创建首个管理员；
4. 写入内置的恋爱和职场场景。

默认管理员的值来自 <code>.env</code> 中的 <code>DEFAULT_ADMIN_USERNAME</code> 和 <code>DEFAULT_ADMIN_PASSWORD</code>。请立即修改密码；首次登录会强制改密。

可以打开 [http://127.0.0.1:8790/api/health](http://127.0.0.1:8790/api/health) 查看健康状态，或打开 [http://127.0.0.1:8790/docs](http://127.0.0.1:8790/docs) 查看 FastAPI 接口文档。

### 3. 开发模式启动前端

保持后端运行，另开一个终端：

~~~bash
cd web
npm ci
npm run dev
~~~

打开 [http://127.0.0.1:5173](http://127.0.0.1:5173)。Vite 会把 <code>/api</code> 代理到后端的 <code>8790</code> 端口。

### 构建为单端口服务

如果希望由 FastAPI 直接托管构建好的 React 页面：

~~~bash
cd web
npm ci
npm run build
cd ..
uv run uvicorn app.main:app --host 127.0.0.1 --port 8790
~~~

只要 <code>web/dist</code> 存在，后端就会托管它。部署到公网时，请在服务前放置 TLS 和访问控制，不要暴露默认管理员凭据。

## 配置 JEV 和 LLM

登录后打开 **设置**：

1. 添加 <code>jev</code> 类型的提供方。
   - 填写完整的 System One 兼容接口 URL。
   - 填写 API Key 和模型名。
   - 运行连通性测试和 JEV 冒烟测试。
2. 添加 <code>llm</code> 类型的提供方。
   - 选择 OpenAI Chat Completions、OpenAI Responses 或 Anthropic Messages 协议。
   - 填写 API 基础地址（例如 <code>https://api.openai.com/v1</code>）；程序会根据协议拼接路径。原有完整接口地址也可使用。
   - 填写 API Key 和模型名。
   - 如果需要读截图，把它标记为支持视觉。
3. 分别运行连通性测试。新配置测试通过后才会启用。

LLM 在流程需要语言处理时使用：翻译、追问、图片描述、候选回复和润色。结构化判断仍由 JEV 完成。管理员可在邀请码页面生成邀请码，并反复点击复制图标复制已显示的邀请码。

## 环境变量

把 <code>.env.example</code> 复制为 <code>.env</code>。<code>.env</code> 已被 Git 忽略。

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| <code>APP_SECRET</code> | — | 必填的 32 字节 base64url 密钥，用于派生加密密钥。 |
| <code>DEFAULT_ADMIN_USERNAME</code> | <code>admin</code> | 首次管理员用户名，仅在没有用户时使用。 |
| <code>DEFAULT_ADMIN_PASSWORD</code> | 见 <code>.env.example</code> | 首次管理员密码，仅在没有用户时使用。 |
| <code>PORT</code> | <code>8790</code> | 应用端口。 |
| <code>DATABASE_PATH</code> | <code>./data/helpme_jev.db</code> | SQLite 数据库路径。 |
| <code>RETENTION_DAYS</code> | <code>15</code> | 上游调用日志保留天数。 |
| <code>SESSION_TTL_HOURS</code> | <code>8</code> | 服务端会话有效期。 |
| <code>WEB_DIST_DIR</code> | <code>./web/dist</code> | FastAPI 托管的前端构建目录。 |

更细的上下文预算配置见 <code>app/core/config.py</code>。

## 项目结构

~~~text
app/
├── api/            HTTP 接口
├── clients/        JEV、LLM、翻译和重试客户端
├── core/           配置、数据库、安全、日志、限流
├── domain/         枚举、错误和请求/响应 Schema
├── repositories/   SQLAlchemy 模型和数据访问
├── scenarios/      内置题集
└── services/       业务用例

web/                React 19 + TypeScript + Vite 前端
migrations/         Alembic 数据库迁移
tests/              后端测试
~~~

## API 速览

后端启动后，可以在 <code>/docs</code> 查看交互式接口文档。

| 方向 | 前缀 |
| --- | --- |
| 健康检查 | <code>GET /api/health</code> |
| 登录认证 | <code>/api/auth</code> |
| 账号导出/注销 | <code>/api/account</code> |
| 提供方配置 | <code>/api/providers</code> |
| 场景 | <code>/api/scenarios</code> |
| 对话和图片 | <code>/api/conversations</code> |
| 聊天分析和记忆 | <code>/api/chat</code> |
| 直接决策 | <code>/api/decide</code> |
| 人设和导入 | <code>/api/personas</code>、<code>/api/import</code>、<code>/api/materials</code> |
| 可按 trace 查询的日志 | <code>/api/logs</code> |

## 隐私与安全

- 提供方 API Key 使用 HKDF-SHA256 和 AES-256-GCM 加密保存，前端只收到掩码，绝不返回密钥明文。
- 密码使用 Argon2id。Bearer token 通过服务端会话处理，库中保存哈希值。
- 对话、记忆、人设、提供方配置和日志按用户隔离；管理员不会自动获得其他用户的聊天内容。
- 请求日志经过脱敏，<code>Authorization</code>、Cookie 和常见 Token 格式会被移除。
- 服务启动时会清理超过 <code>RETENTION_DAYS</code> 的调用日志；对话不会因为调用日志过期而被删除。
- 支持导出个人数据和注销账号。账号注销不可恢复。

> [!WARNING]
> “自托管”不等于“任何内容都不出本机”。如果配置了远程 JEV 或 LLM 接口，完成对应操作所需的文字或图片会发送给它。处理私密对话前，请先阅读提供方的数据政策。

## 开发与验证

~~~bash
# 后端
uv run pytest -q

# 前端
cd web
npm run typecheck
npm run build
~~~

当前基线由 CI 校验：后端测试、前端类型检查和生产构建。

## 参与贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告，不要开公开 Issue。社区规范见 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## 致谢

感谢 [Linux.do 社区](https://linux.do/) 早期提供的反馈、提问和讨论，它们帮助这个项目逐渐成形。

本项目独立开发，与 Linux.do 没有隶属、官方合作或背书关系。

本 README 的双语入口和自托管说明，也参考了作者的另一个项目：[human-llm-gateway](https://github.com/GuSheng107/human-llm-gateway)。

## 许可证

[AGPL-3.0](LICENSE) © 2026 故笙

如果你修改本项目并以网络服务形式提供，AGPL-3.0 要求向使用者提供对应的源代码。

<p align="center">
  写给那些消息看起来很简单，但脑子已经开了 17 个标签页的时刻。
</p>
