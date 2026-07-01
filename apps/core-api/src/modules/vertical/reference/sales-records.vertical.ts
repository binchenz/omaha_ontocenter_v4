import type { Vertical } from '../vertical';
import type { AgentSkill, SkillContext } from '../../agent/skills/skill.interface';
import { SALES_RECORD_TYPE, SALES_LINE_TYPE } from './sales-stars';

/**
 * The Sales Records reference vertical (ADR-0062 §4, #207) — the community template, wired into
 * the platform seams via the public `Vertical` manifest. Neutral on purpose: a community OPC copies
 * this file, renames `sales_*` and the prose, and has a working vertical with all ADR-0061 semantics
 * + the drill-gate already demoed.
 */

class SalesAnalysisSkill implements AgentSkill {
  name = 'sales_analysis';
  description = '销售数据问答：在已导入的销售汇总与明细中查询销量/销售额/均价，按大区/产品线/月份分析趋势与结构。';
  tools = ['query_objects', 'aggregate_objects', 'get_ontology_schema', 'render_chart'];

  systemPrompt(_context: SkillContext): string {
    return `## 销售数据问答能力

可用数据对象：
- **sales_record**（汇总/全量口径）：按大区(region)×产品线(product)×月份(period) 的指标长表，指标(metric)分行：units_sold（销量）、revenue（销售额）、avg_price（均价）。region 默认折叠为「全国」——这是被折叠的维度，不是"没有大区"，要看分大区数据时显式按 region 钻取，绝不要因默认看不到就断言"无大区维度"。
  - **可加性纪律（关键）**：units_sold、revenue 可跨组求和；**avg_price 是比率，绝不可跨组 SUM/相加**。要整体均价时用 Σrevenue ÷ Σunits_sold（加权），不要对各行 avg_price 直接求平均或求和。
- **sales_line**（明细/样本口径）：单 SKU 的月度单价(unitPrice)与销量(unitsSold)样本。
  - **universe 纪律（别拿样本当全量）**：sales_line 是 TOP 样本，不是全量。**某产品线/区间在 sales_line 里没有 SKU ≠ 该处销量为零**——要判断"某处是否空白/为零"，必须回到 sales_record 的全量口径，不得据 sales_line 的样本空缺断言"真空"。

### 下钻纪律
先用 sales_record 看汇总（大区/产品线/月份层面），需要看到具体 SKU 时再下钻到 sales_line——下钻明细层前会先与你确认要钻取的产品/区间。`;
  }
}

export const SALES_RECORDS_VERTICAL: Vertical = {
  name: 'sales-records',
  skills: [new SalesAnalysisSkill()],
};
