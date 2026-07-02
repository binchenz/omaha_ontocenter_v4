# 前端暴露 system prompt 用于调试

> **状态（2026-07-01 修订）**：本事件已改为**默认关闭**，通过 `EXPOSE_SYSTEM_PROMPT` 环境变量开启。原决策（"任何环境都显示"）预留的转向条件已触发，详见文末「修订」小节。

Agent 把拼好的 system prompt（含 schema summary / 语义层信息）通过一个新的 `system_prompt` SSE 事件推给前端，在 chat 右侧面板的"提示词"标签页展示。这让用户能直接看到喂给 LLM 的语义层信息（字段 unit、类型 description、关系），便于调试"模型为什么这样选字段"。

## 机制

`OrchestratorService.run()` 在拼好 systemPrompt 后、进入工具循环前，yield 一个 `{ type: 'system_prompt', content }` 事件。SSE runner 原样透传（不持久化到对话历史——它只对 `text` 事件做持久化）。前端 `handleEvent` 接住存入 state，面板用 `<pre>` 渲染。

## 权衡：总是显示 vs 仅调试模式

选择了**任何环境都显示**（非 dev-only）。代价：system prompt 含完整本体 schema（所有对象类型、字段、关系），生产环境下任何登录用户都能在浏览器看到整个租户的数据模型。

接受这个代价的理由：本平台面向企业租户，schema 是用户自己的数据模型，给本租户用户看通常无妨。**但这是一个已知的信息暴露面**——若未来出现多租户共享视图、对外嵌入、或 schema 本身敏感的场景，应改为环境变量/权限门控的 dev-only 显示。记录于此以便那时能找到这个决策点。

## 与 LLM debug dump 的关系

这与后端的 `.llm-debug/*.json` 落盘（LLM_DEBUG 开关）互补：落盘捕获**完整 messages + tools + 原始响应**供事后逐字分析；本事件只推 **system prompt** 供实时在 chat 里看。两者服务不同调试场景（回溯 vs 实时），不互相替代。

## 已知局限

前端只显示 system prompt，不含历史 messages、tool 结果、或模型原始响应——那些仍需看 `.llm-debug`。此外，字段级 `description` 当前并未拼进 schema summary（getSchemaSummary 只输出 name/type/flags/unit + 类型级 description），所以面板里看不到字段 description；那是 schema summary 自身的局限，是另一个待决问题。

## 修订（2026-07-01）：默认关闭，改由 `EXPOSE_SYSTEM_PROMPT` 门控

本 ADR 原决策里预留的转向条件（"若未来…schema 本身敏感…应改为环境变量/权限门控的 dev-only 显示"）现已触发：拼好的 system prompt 如今不再只是"本租户自己的 schema"，它还带有**租户身份注入**（`Tenant.settings.selfBrands`，如纯米对应的 小米/米家 合并口径）和**全套 skill 编排纪律**（drill gate、universe 规则、收敛护栏、四跳范式）——这些是平台内部实现，不应对每个登录用户逐字流式外泄。

因此 `system_prompt` SSE 事件改为**默认关闭**，通过环境变量 `EXPOSE_SYSTEM_PROMPT` 显式开启（`=1` 或 `=true`），与 `LLM_DEBUG` 同一风格、在使用点读取。生产默认不发；开发/联调需要看提示词时设 `EXPOSE_SYSTEM_PROMPT=1`。

- **单一 emit 点**：`orchestrator.service.ts` `run()` 里唯一的 `yield { type: 'system_prompt' }`，用 `this.exposeSystemPrompt` 包住。`resume()` 路径本就不发该事件。
- **前端零改动**：chat 右侧「提示词」标签页已有 null 占位态——事件不到达时显示占位文案、标签上带一个 ` ·` 圆点，属正常降级，不是 bug。
- **测试**：多个 spec 用该事件作为断言 prompt 组装/身份注入的唯一通道；core-api 的 jest setup（`test/jest-setup.ts`）统一设 `EXPOSE_SYSTEM_PROMPT=1`，故单测仍走 emit，无需逐个改。
- **可逆**：设回 `EXPOSE_SYSTEM_PROMPT=1` 即恢复旧行为；runner 从不持久化该事件，故关闭后历史里也没有残留。
