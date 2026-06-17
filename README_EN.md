# Jade Agent

[![中文 README](https://img.shields.io/badge/%E4%B8%AD%E6%96%87-README-0f766e?style=for-the-badge)](./README.md)

Jade Agent is a vertical AI agent system for jade commerce. It is not a general-purpose chatbot. It turns real marketplace actions such as buyer sourcing, merchant publishing, and lead follow-up into executable, traceable, and explainable agent workflows.

The core goal is simple: a buyer can say something natural, such as "I want an icy jade bangle for my mother, around 50k RMB, clean looking", and the backend will extract category, budget, water quality, color, occasion, flaw tolerance, and price preference. It then retrieves product evidence from the local catalog, ranks products, explains the recommendation, and creates merchant leads when the buyer provides an email.

## What This System Does

Jade Agent simulates an AI sourcing and merchant operations assistant inside a jade e-commerce marketplace.

On the buyer side, it turns vague natural language into structured sourcing constraints and explainable recommendations. Buyers do not need to fill out complex filters. They can describe budget, product type, use case, jade water quality, color, bangle size, or gift scenario in plain language.

On the merchant side, it helps with product publishing and lead follow-up. A merchant can upload product images and add short notes to generate a product draft. When a buyer inquiry becomes a lead, the system can generate follow-up copy, next actions, and risk notes.

On the engineering side, every agent run keeps its input, output, trace, retrieval evidence, and ranking reasons, so the system can answer why a product was recommended and which business signals were understood.

## Core Capabilities

- **Natural-language sourcing**: parses buyer messages into category, budget, color, water quality, size, occasion, flaws, and certificate requirements.
- **Context refinement**: supports multi-turn sourcing, such as "show me bangles" followed by "mid price" or "a little greener".
- **Local RAG retrieval**: products are converted into searchable documents, then used as retrieval evidence for buyer needs.
- **Rules plus semantic ranking**: combines hard constraints, budget fit, business concept hits, RAG matches, and latest preference signals.
- **Explainable agent traces**: records intent detection, concept understanding, inventory boundary checks, RAG retrieval, ranking, explanation, and lead creation.
- **Merchant publish assistance**: drafts product title, category, price, detail copy, tags, and checks from images and notes.
- **Lead follow-up assistance**: drafts follow-up messages, next steps, and risk notes from buyer inquiries and product data.

## Architecture

```text
React / Vite frontend
  ├─ Buyer sourcing UI
  ├─ Merchant dashboard
  ├─ Product publishing
  └─ Lead follow-up

Python HTTP API
  ├─ backend/app.py                 API routes and upload serving
  ├─ backend/agent.py               Agent orchestration, ranking, reply generation
  ├─ backend/query_understanding.py Query understanding and business concept matching
  ├─ backend/db.py                  SQLite, product documents, run records
  └─ backend/validation.py          User input boundary validation

SQLite data layer
  ├─ products                        Products
  ├─ product_documents               RAG retrieval documents
  ├─ query_concepts                  Business concept dictionary
  ├─ query_understanding_events      Query understanding events
  ├─ agent_sessions / messages       Conversation state
  ├─ agent_runs                      Agent execution traces
  └─ leads                           Buyer leads
```

## AI Agent Design

The system decomposes each marketplace action into explicit agent steps instead of asking a model to directly produce the final answer.

### 1. Intent Agent

The first step classifies the user message:

- `match`: a new sourcing request
- `refine`: a refinement of the previous sourcing request
- `customer_service`: customer-service chat or jade knowledge
- `clarify`: missing information or inventory constraints require a follow-up question

This prevents every message from becoming a product recommendation. For example, "hello" becomes a service reply, while "the most expensive one" can refine the previous sourcing context as a price preference.

### 2. Query Understanding Agent

The query understanding layer converts buyer language into structured fields and preference signals:

- Category: bangle, pendant, necklace, ring stone, safety buckle
- Budget: `50k RMB`, `mid price`, `unlimited budget`
- Water quality: waxy, icy waxy, icy, high icy, glassy
- Color: clear base, white icy, floating green, vivid green, lavender, blue water
- Occasion: gift, self wear, collection, daily wear, business gift
- Quality requirements: no cracks, clean looking, certificate, natural jadeite

This layer is implemented mainly in `backend/query_understanding.py` and the `query_concepts` table.

### 3. Inventory Boundary Agent

Before ranking products, the system checks whether current inventory can satisfy hard constraints. If the requested category, color, size, or budget cannot be covered, it asks a clarification question instead of forcing unrelated recommendations.

### 4. RAG Retrieval Tool

Product data is converted into documents in `product_documents`. Buyer needs are expanded into business terms, then used to retrieve relevant product evidence and candidate products.

### 5. Ranking Agent

Ranking is not pure keyword matching. It combines:

- category consistency
- price fit against budget
- water quality, color, and shape matches
- certificate, no-crack, and size constraints
- RAG document match strength
- latest turn preference, such as premium, lowest price, mid price, gift, clean look, or premium look

Each product receives `matchScore`, `matchReasons`, and `agentScore`, which are used to explain the recommendation.

### 6. Explanation Agent

The explanation step turns ranking output into a buyer-facing response: what product is recommended first, why it is recommended, how many product evidence documents were retrieved, and how the buyer need was understood.

### 7. Memory and Tracing

The system stores conversation state in `agent_sessions` and `messages`, agent execution records in `agent_runs`, and concept hits in `query_understanding_events`.

## How LangGraph Is Used

The backend now uses LangGraph. `backend/agent.py` exposes three compiled graphs:

- `BUYER_MATCH_GRAPH`: buyer sourcing with context preparation, intent routing, budget clarification, customer-service replies, product matching, and run logging.
- `PUBLISH_GRAPH`: merchant publishing with publish-input preparation, image-based product draft generation, and run logging.
- `LEAD_FOLLOWUP_GRAPH`: lead follow-up with lead loading, follow-up copy generation, and run logging.

Using LangChain / LangGraph terminology, the current implementation maps to these concepts:

| LangChain / LangGraph concept | Current implementation |
| --- | --- |
| Graph | `BUYER_MATCH_GRAPH`, `PUBLISH_GRAPH`, `LEAD_FOLLOWUP_GRAPH` |
| Node | `buyer_prepare_node`, `buyer_match_node`, `publish_draft_node`, `lead_followup_node`, etc. |
| Conditional Edge | Buyer sourcing routes to budget clarification, customer service, or product matching based on intent |
| Tool | RAG retrieval, inventory boundary check, lead creation, product draft generation |
| Retriever | `search_product_documents()` |
| Document Store | SQLite table `product_documents` |
| Memory | `agent_sessions`, `messages`, `lastParsedNeed` |
| Callback / Trace | `trace` fields and the `agent_runs` table |
| Prompt / Output Parser | Concept normalization, structured signals, and optional Ollama JSON parsing in `query_understanding.py` |

Business logic still lives in local Python functions. LangGraph is used to organize those steps into branchable, traceable, replaceable agent workflows.

### Local LangSmith Studio

The project also includes `langgraph.json` and `backend/studio_graphs.py` to expose the existing workflows to LangSmith Studio:

```bash
npm run graph:validate
npm run dev:graph
```

Use this Base URL in Studio:

```text
http://127.0.0.1:2024
```

Available graphs:

- `buyer_match`: buyer sourcing. You can pass `need`, `buyerEmail`, and `sessionId`.
- `merchant_publish`: merchant publishing. Pass `sellerId` and at least one uploaded image path, for example `/uploads/xxx.jpg`.
- `lead_followup`: lead follow-up. You can pass `sellerId` and `leadId`; otherwise it uses the latest local seed lead.

Ports: `8787` is the product API, `5173` is the frontend, and `2024` is the LangGraph Studio Agent Server.

## RAG Design

The RAG layer is designed around the product catalog, not generic knowledge-base Q&A.

### 1. Document Construction

When a product is created or updated, the system converts product fields into searchable text:

- title, SKU, category, price
- material, treatment, water quality, color, shape
- size, weight, flaws, certificate
- occasion, tags, intro, detail, merchant notes

This text is stored in `product_documents` and becomes the retrieval source for buyer sourcing.

### 2. Query Expansion

The raw buyer message is not used alone. Query Understanding expands it into retrieval-friendly business terms:

- "for my mother" expands to gift, elder, certificate, no cracks
- "a little greener" expands to vivid green, floating green, green family
- "mid price" expands to mid price, daily wear, self wear
- "clean looking" expands to no cracks, visually clean, less cotton, fewer flaws

These terms are combined with the original query during retrieval.

### 3. Retrieval and Scoring

`search_product_documents()` searches local SQLite product documents and weights hits using matched terms, category boost, tags, and search keywords. Each retrieval result keeps:

- product ID
- document chunk type
- matched terms
- score
- evidence snippet
- product payload

### 4. RAG Is Evidence, Not the Final Answer

RAG provides evidence and candidates. Final recommendations still go through rule-based ranking so products that match the text but violate price, category, size, or quality constraints do not rank first.

Final ranking considers:

- RAG hits
- structured buyer need
- inventory boundaries
- price range
- category hard constraints
- color, water quality, size, and certificate details
- latest preference from the current turn

## Local Development

```bash
npm install
npm run seed
npm run dev
```

Default URLs:

- Buyer app: `http://127.0.0.1:5173/#/buyer`
- Merchant app: `http://127.0.0.1:5173/#/merchant`
- Backend: `http://127.0.0.1:8787`

You can also run services separately:

```bash
npm run dev:api
npm run dev:web
```

The default local merchant login code is `123456`. Override it with `DEV_OTP_CODE`.

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8787` | Python API port |
| `DEV_OTP_CODE` | `123456` | Local merchant login code |
| `AI_PROVIDER` | `auto` | Set to `ollama` to let query understanding try the local model path |
| `QUERY_UNDERSTANDING_PROVIDER` | unset | Set to `ollama` to force local Ollama attempts for query understanding |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama base URL |
| `OLLAMA_MODEL` / `AI_MODEL` | `qwen2.5:7b` | Ollama model name |

## Project Layout

| Path | Description |
| --- | --- |
| `backend/app.py` | Python API routes and upload serving |
| `backend/agent.py` | Core agent orchestration, ranking, reply generation, and trace logging |
| `backend/query_understanding.py` | Query understanding, business concept matching, optional Ollama structured parsing |
| `backend/db.py` | SQLite schema, seed data, product RAG documents, and run records |
| `backend/validation.py` | API input boundary validation |
| `src/App.jsx` | React frontend and business interactions |
| `src/styles.css` | Frontend styles |
| `scripts/dev.js` | Starts the Python API and Vite frontend together |
| `data/jade-agent.sqlite` | Local SQLite database |
| `public/uploads` | Merchant-uploaded images |
