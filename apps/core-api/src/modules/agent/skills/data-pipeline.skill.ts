import { AgentSkill, SkillContext } from './skill.interface';

/**
 * Data Pipeline skill (ADR-0052 / ADR-0054) — declares the transform-config and
 * pipeline-authoring tools so the Agent can build reusable transform configs and
 * wire them into ingestion pipelines. Extended as configure_pipeline /
 * trigger_pipeline_run / get_pipeline_status land (#172, #173).
 */
export class DataPipelineSkill implements AgentSkill {
  name = 'data_pipeline';
  description = '数据管道配置：创建可复用的转换配置（品牌词典、价格分档等），供数据接入管道引用。';
  tools = [
    'create_transform_config',
    'list_transform_configs',
    'configure_pipeline',
    'trigger_pipeline_run',
    'get_pipeline_status',
  ];

  systemPrompt(_context: SkillContext): string {
    return `## 转换配置能力

你可以为数据接入管道创建可复用的转换配置（TransformConfig）。

### 工作流
1. 调用 list_transform_configs 查看当前租户已有的配置，避免重复创建
2. 若需新建或更新，调用 create_transform_config，传入 name、type、config
   - 同名 create 会追加为新版本（append-only），不会覆盖旧版本
3. 配置创建后即可在后续管道步骤中按名称引用

### 配置类型（type）
- brand_mapping：品牌归一词典。config 形如 { "mappings": { "MIDEA": "美的", "Haier": "海尔" } }
- price_bands：价格分档。config 形如 { "bands": [ { "max": 500, "label": "0-500" }, { "label": "500+" } ] }

### 约定
- 配置内容由 type 决定，提交前确保结构与上述示例一致，否则会被校验拒绝
- 创建前先用 list_transform_configs 确认是否已存在同名配置

## 管道配置能力（configure_pipeline）

你可以用一次调用原子地创建一条数据接入管道（Pipeline）及其全部有序步骤（Step）。

### 用法
调用 configure_pipeline，传入 name、connectorId、outputObjectTypeId、steps[]，可选 autoActivate。
- steps 按 order 顺序执行；每个 step 形如 { order, type, config }
- 任一 step 的 config 校验失败，整次调用回滚，不写入任何数据
- autoActivate=true 创建为 active；省略或 false 创建为 draft（草稿，需后续激活）

### 步骤类型（step.type）
- filter：单条件过滤。config 形如 { field, operator(eq|gt|lt|gte|lte|contains|in), value }；复合条件用多个 filter 步骤表达
- rename：字段改名。config 形如 { mappings: { "旧名": "新名" } }
- compute：预定义函数计算。config 形如 { function(normalize_brand|price_band), inputField, outputField, configRef, configVersion? }
  - configRef 指向一个已创建的 TransformConfig（如品牌词典名）
  - 不传 configVersion 时，会在配置管道时锁定到当前最新版本（版本钉死，保证管道可复现）

### 约定
- compute 步骤引用的 configRef 必须已存在（先用 create_transform_config 创建）
- MVP 仅支持创建，无更新路径；如需调整请重新配置一条新管道

## 运行与观测能力（trigger_pipeline_run / get_pipeline_status）

- trigger_pipeline_run：手动触发一次管道运行（用于重跑或测试新配置）。传入 pipelineId、inputDatasetId，返回 { runId, status }。
- get_pipeline_status：查询管道及其最近运行。可选 pipelineId；不传则列出本租户全部管道。
  - 失败的运行会带 error 详情 { step, rowIndex, message }：step 是出错的步骤序号，rowIndex 是出错的行号（-1 表示非行级错误），message 是原因。
  - 用这些字段向用户用自然语言解释失败原因，例如"第 2 步在第 41 行因价格非数值而失败"。

### 约定
- 运行是异步的：trigger 后状态通常为 pending/running，需稍后用 get_pipeline_status 查询最终结果
- 不要轮询；在用户询问时再查询状态（被动查询模型）`;
  }
}
