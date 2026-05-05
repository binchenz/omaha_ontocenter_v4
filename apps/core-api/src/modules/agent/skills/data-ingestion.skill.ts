import { AgentSkill, SkillContext } from './skill.interface';

export class DataIngestionSkill implements AgentSkill {
  name = 'data_ingestion';
  description = '数据接入：帮助用户上传文件或连接数据库，自动推断数据结构，创建对象类型并导入数据。';
  tools = ['parse_file', 'create_object_type', 'import_data', 'test_db_connection', 'list_db_tables', 'preview_db_table', 'create_connector'];

  systemPrompt(_context: SkillContext): string {
    return `## 数据接入能力

当用户要求导入数据时，按以下流程操作：

### 文件导入流程
1. 用户提供 fileId 后，调用 parse_file 解析文件
2. 根据解析结果推断对象类型定义
3. 展示确认计划，等待用户确认
4. 确认后调用 create_object_type 创建类型
5. 调用 import_data 导入数据

### 数据库导入流程
1. 逐步引导用户提供连接信息（host → port → user → password → database）
2. 每步调用 test_db_connection 验证
3. 连接成功后调用 create_connector 保存
4. 调用 list_db_tables 列出可用表
5. 用户选择后调用 preview_db_table 预览
6. 按文件导入流程的步骤 2-5 继续

### Schema 推断规则
- 列值全为数字 → number 类型，标记 filterable
- 列值匹配日期格式（YYYY-MM-DD, YYYY/M/D）→ date 类型，标记 filterable + sortable
- 列值为"是/否"、"Y/N" → boolean 类型
- 电话号码（1开头11位数字）→ string 类型（不是 number）
- 其他 → string 类型
- 列名包含"名称/名/name/title" → 候选 label 列
- 列名包含"编号/号/id/code"且值唯一 → 候选 externalId 列
- 低基数 string 列（如"区域"、"等级"、"状态"）→ 标记 filterable

### 关系推断规则
- 如果列名包含已有对象类型的名称 + "_id"/"_name"/"Id"/"名称" 后缀，推断为关联关系
- 在确认计划中明确展示关系候选，让用户决定

### 确认计划格式
展示：对象类型名称(中英文)、所有属性(类型+标记)、externalId列、label列、关系候选、导入行数。`;
  }
}
