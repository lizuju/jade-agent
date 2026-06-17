# Jade Agent

[![English README](https://img.shields.io/badge/English-README-0f766e?style=for-the-badge)](./README_EN.md)

Jade Agent 是一个面向翡翠交易的垂直 AI Agent 系统。它不是通用聊天机器人，而是把“买家找货、商家发布、客资跟进”这几个真实交易动作串成可执行、可追踪、可解释的 agent 工作流。

系统的核心目标是：让买家用自然语言说出需求，比如“想找一个送妈妈的冰种手镯，预算 5 万左右，要干净一点”，后端能够理解这句话里的品类、预算、种水、颜色、用途、瑕疵要求和价格偏好，再从本地商品库里召回证据、排序商品、解释推荐理由，并把有邮箱的咨询沉淀成商家客资。

## 这个系统是干嘛的

Jade Agent 模拟的是一个翡翠电商平台里的 AI 找货与商家运营助手。

买家侧，它负责把模糊口语需求变成结构化找货条件，并给出可解释推荐。用户不需要填写复杂筛选器，只要自然表达预算、品类、佩戴场景、种水颜色、圈口尺寸等信息，系统就会自动判断是新找货、继续细化上一轮需求，还是普通客服咨询。

商家侧，它负责辅助商品发布和客资跟进。商家上传商品图片并补充一句描述后，系统可以生成商品草稿；买家留下咨询后，系统可以根据客资和商品信息生成跟进话术、下一步动作和风险提示。

工程侧，它保留每次 agent 执行的输入、输出、trace、检索证据和排序原因，方便复盘“为什么推荐这个商品”和“这次理解命中了哪些业务信号”。

## 核心能力

- **自然语言找货**：把买家的口语需求解析成品类、预算、颜色、种水、尺寸、场景、瑕疵、证书等结构化字段。
- **上下文细化**：支持连续对话，例如先说“找个手镯”，再补充“要中等价格”“绿一点”，系统会基于上一轮需求继续重排。
- **本地 RAG 检索**：商品会被整理成可检索文档，买家需求会先召回相关商品证据，再进入排序。
- **规则 + 语义排序**：结合硬性条件、预算贴近度、业务词命中、RAG 命中和本轮偏好计算推荐顺序。
- **可解释 Agent Trace**：输出意图识别、概念理解、库存边界、RAG 检索、排序、解释、客资写入等步骤。
- **商家发布辅助**：根据图片和描述生成商品标题、品类、价格、详情、标签和检查项。
- **客资跟进辅助**：根据买家咨询和商品信息生成跟进话术与下一步动作。

## 系统架构

```text
React / Vite 前端
  ├─ 买家找货界面
  ├─ 商家后台
  ├─ 商品发布
  └─ 客资跟进

Python HTTP API
  ├─ backend/app.py                 API 路由与上传服务
  ├─ backend/agent.py               Agent 编排、排序、回复生成
  ├─ backend/query_understanding.py 需求理解与业务概念匹配
  ├─ backend/db.py                  SQLite、商品文档、运行记录
  └─ backend/validation.py          用户输入边界校验

SQLite 数据层
  ├─ products                        商品
  ├─ product_documents               RAG 检索文档
  ├─ query_concepts                  业务概念词库
  ├─ query_understanding_events      需求理解事件
  ├─ agent_sessions / messages       对话状态
  ├─ agent_runs                      Agent 运行轨迹
  └─ leads                           买家客资
```

## AI Agent 如何设计

系统把一个完整交易动作拆成多个职责清晰的 agent 步骤，而不是只让大模型直接回答。

### 1. 意图识别 Agent

判断用户输入属于哪类任务：

- `match`：新的找货需求
- `refine`：基于上一轮需求继续细化
- `customer_service`：普通客服、翡翠知识或寒暄
- `clarify`：信息不足或库存边界不满足，需要追问

这样可以避免所有输入都进入商品推荐。例如“你好”会走客服回复，“最贵的”会被识别成上一轮找货的价格偏好细化。

### 2. 需求理解 Agent

需求理解层负责把用户自然语言转成结构化字段和偏好信号：

- 品类：手镯、吊坠、项链、戒面、平安扣等
- 预算：`5万`、`50000`、`中等价位`、`预算不限`
- 种水：糯种、糯冰、冰种、高冰、玻璃种
- 颜色：晴底、白冰、飘绿、阳绿、紫罗兰、蓝水等
- 场景：送礼、自用、收藏、日常佩戴、商务礼赠
- 质量要求：无纹裂、干净、证书、天然 A 货

这部分主要由 `backend/query_understanding.py` 和 `query_concepts` 表完成。

### 3. 库存边界 Agent

在真正排序前，系统先检查当前库存是否能覆盖硬性条件。比如用户要求某个品类、颜色、尺寸或预算，但库存里没有满足条件的商品，就不会硬推荐无关商品，而是返回明确的澄清建议。

### 4. RAG 检索 Tool

商品数据会被整理成 `product_documents` 文档。买家需求进入后，系统会用解析出的业务词和原始文本去检索相关商品证据，得到候选商品和命中片段。

### 5. 排序 Agent

排序不是单纯关键词匹配，而是综合多类信号：

- 品类是否一致
- 价格是否在预算内或贴近预算
- 种水、颜色、器型是否命中
- 是否满足证书、无纹裂、尺寸等硬性要求
- RAG 文档命中强度
- 本轮最新偏好，例如高货、低价、中等价位、送礼、干净、显贵

每个商品会生成 `matchScore`、`matchReasons` 和 `agentScore`，用于解释推荐结果。

### 6. 解释 Agent

解释层把排序结果转换成买家能理解的回复，例如推荐哪一件、为什么优先推荐、召回了多少条商品证据、当前需求被理解成什么。

### 7. 记忆与追踪

系统用 `agent_sessions` 和 `messages` 保存会话状态，用 `agent_runs` 保存每次 agent 执行的输入、输出和 trace，用 `query_understanding_events` 记录每次需求理解命中的概念信号。

## LangGraph 如何使用

当前后端已经接入 LangGraph。`backend/agent.py` 暴露三个编排图：

- `BUYER_MATCH_GRAPH`：买家找货，节点包括上下文准备、意图分流、预算澄清、客服回复、商品匹配和运行记录。
- `PUBLISH_GRAPH`：商家发布，节点包括发布输入准备、图片识别草稿生成和运行记录。
- `LEAD_FOLLOWUP_GRAPH`：客资跟进，节点包括客资读取、跟进话术生成和运行记录。

如果用 LangChain / LangGraph 的概念来理解，本系统的设计对应关系是：

| LangChain / LangGraph 概念 | 当前项目中的对应实现 |
| --- | --- |
| Graph | `BUYER_MATCH_GRAPH`、`PUBLISH_GRAPH`、`LEAD_FOLLOWUP_GRAPH` |
| Node | `buyer_prepare_node`、`buyer_match_node`、`publish_draft_node`、`lead_followup_node` 等 |
| Conditional Edge | 买家找货根据意图路由到预算澄清、客服回复或商品匹配 |
| Tool | RAG 检索、库存边界检查、客资写入、商品发布草稿生成 |
| Retriever | `search_product_documents()` |
| Document Store | SQLite 表 `product_documents` |
| Memory | `agent_sessions`、`messages`、`lastParsedNeed` |
| Callback / Trace | `trace` 字段和 `agent_runs` 表 |
| Prompt / Output Parser | `query_understanding.py` 中的概念归一、结构化信号和可选 Ollama JSON 解析 |

业务规则仍然保留在本地 Python 函数中，LangGraph 负责把这些步骤组织成可分流、可追踪、可替换的 agent 工作流。

### LangSmith Studio 本地查看

项目同时提供 `langgraph.json` 和 `backend/studio_graphs.py`，用于把现有工作流暴露给 LangSmith Studio：

```bash
npm run graph:validate
npm run dev:graph
```

打开 Studio 时 Base URL 填：

```text
http://127.0.0.1:2024
```

可选图：

- `buyer_match`：买家找货，可直接传 `need`、`buyerEmail`、`sessionId`。
- `merchant_publish`：商家发布，需要传 `sellerId` 和至少一张已上传图片路径，例如 `/uploads/xxx.jpg`。
- `lead_followup`：客资跟进，可传 `sellerId`、`leadId`，不传时使用本地种子数据里的最新客资。

端口分工：`8787` 是业务 API，`5173` 是前端页面，`2024` 是 LangGraph Studio Agent Server。

## RAG 如何设计

本项目的 RAG 是围绕商品库设计的，不是通用知识库问答。

### 1. 文档构建

每个商品创建或更新时，系统会把商品字段整理成一段可检索文本：

- 标题、SKU、品类、价格
- 材质、处理方式、种水、颜色、器型
- 尺寸、重量、瑕疵、证书
- 适用场景、标签、简介、详情、商家备注

这些文本写入 `product_documents`，作为买家找货时的检索来源。

### 2. 查询扩展

用户原始输入不会直接拿去匹配。系统会先通过 Query Understanding 生成更适合商品检索的词：

- 从“送妈妈”扩展出送礼、长辈、证书、无纹裂等信号
- 从“绿一点”扩展出阳绿、飘绿、绿色系
- 从“中等价格”扩展出中等价位、日常佩戴、自用
- 从“干净一点”扩展出无纹裂、肉眼干净、少棉、少瑕疵

这些扩展词会和原始输入一起进入检索。

### 3. 召回与打分

`search_product_documents()` 会在本地 SQLite 商品文档中查找命中词，并结合品类、标签、搜索关键词做加权。召回结果会保留：

- 商品 ID
- 命中的文档类型
- 命中词
- 分数
- 证据片段
- 对应商品

### 4. RAG 不是最终答案

RAG 只负责提供证据和候选池，最终推荐还要经过规则排序。这样可以避免“文档命中很多但价格、品类、尺寸不合适”的商品排到前面。

最终排序会同时看：

- RAG 命中
- 结构化需求
- 库存边界
- 价格区间
- 品类硬约束
- 颜色、种水、尺寸、证书等细节
- 当前轮次的最新偏好

## 运行方式

```bash
npm install
npm run seed
npm run dev
```

默认地址：

- 买家端：`http://127.0.0.1:5173/#/buyer`
- 商家端：`http://127.0.0.1:5173/#/merchant`
- 后端：`http://127.0.0.1:8787`

也可以分开启动：

```bash
npm run dev:api
npm run dev:web
```

商家本地登录验证码默认是 `123456`，可以通过 `DEV_OTP_CODE` 覆盖。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | Python API 端口 |
| `DEV_OTP_CODE` | `123456` | 本地商家登录验证码 |
| `AI_PROVIDER` | `auto` | 设置为 `ollama` 时，需求理解可尝试本地模型 |
| `QUERY_UNDERSTANDING_PROVIDER` | 未设置 | 设置为 `ollama` 可强制需求理解尝试本地 Ollama |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama 地址 |
| `OLLAMA_MODEL` / `AI_MODEL` | `qwen2.5:7b` | Ollama 模型名 |

## 目录说明

| 路径 | 说明 |
| --- | --- |
| `backend/app.py` | Python API 路由和静态上传服务 |
| `backend/agent.py` | 核心 agent 编排、排序、回复生成和 trace 记录 |
| `backend/query_understanding.py` | 需求理解、业务概念匹配、可选 Ollama 结构化理解 |
| `backend/db.py` | SQLite schema、种子数据、商品 RAG 文档和运行记录 |
| `backend/validation.py` | API 输入边界校验 |
| `src/App.jsx` | React 前端主界面和业务交互 |
| `src/styles.css` | 前端样式 |
| `scripts/dev.js` | 同时启动 Python API 和 Vite 前端 |
| `data/jade-agent.sqlite` | 本地 SQLite 数据库 |
| `public/uploads` | 商家上传图片目录 |
