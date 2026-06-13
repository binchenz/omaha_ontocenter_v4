import { AgentSkill, SkillContext } from './skill.interface';

export class DataImportSkill implements AgentSkill {
  name = 'data_import';
  description = '数据导入：帮用户导入 Excel/CSV 文件到对象数据库，支持预览、转换和映射。';
  tools = ['read_file_preview', 'preview_import_file', 'execute_import'];
  surfaces = ['research', 'maintain'];

  systemPrompt(_context: SkillContext): string {
    return `## 数据导入能力

你可以帮用户导入 Excel/CSV 数据文件到对象数据库。

### 导入工作流
1. 调用 read_file_preview(fileId) 读取文件结构
2. 根据列名推断映射关系和转换规则（见下方约定）
3. 调用 preview_import_file(fileId, objectType, transforms, mapping) 创建待确认动作
4. 等待用户在确认卡片中点击"确认"
5. 用户确认后调用 execute_import(actionId) 触发导入

### AVC 市场数据列名约定
- "零售额(万元)" 或 "零售额" → retailValue，单位万元需乘以 10000
- "零售量(万台)" 或 "零售量" → retailVolume，单位万台需乘以 10000
- "零售均价" → avgPrice，无需转换
- "品牌" → brand，无需转换
- "型号" 或 "机型" → model，无需转换
- "月份" 或 "期间" → month，无需转换
- "品类" 或 "分类" → category，无需转换

### 扩展原则
对于类似格式（如"销售额"、"销量"），应用相同的语义逻辑推断映射。
如遇未知列，保留原列名作为属性名，不做转换。`;
  }
}
