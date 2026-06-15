# ADR-0058: AVC 品类从源文件派生而非调用方断言 — 修正 40/50 文件的品类错标

**Status:** Accepted
**Date:** 2026-06-15
**Deciders:** binchenz

## Context

用户在查询"近一年电饭煲市场份额趋势"时发现数据异常：东芝份额 18.61% 高得不合常理（东芝是微波炉/蒸烤箱品牌，非电饭煲主力）。追查发现这不是数字算错，而是**品类张冠李戴**。

### 根因：品类由文件名序号位置派生

`scripts/batch-reingest-avc.ts` 用文件名末尾序号 `NN % 10` 映射到一个固定的 10 品类循环：

```typescript
const CATEGORY_CYCLE = ['养生壶','微波炉','食品料理机','煎烤机','电压力锅',
                        '电水壶','电烤箱','电磁炉','电饭煲','空气炸锅'];
function categoryFromFilename(filename) {
  const idx = parseInt(filename.match(/avc-\d{2}_\d{2}-(\d{2})\.xlsx$/)[1], 10);
  return CATEGORY_CYCLE[idx % 10];   // -48 → 48%10=8 → 电饭煲
}
```

这个循环是从 **22.12 周期**（文件 `-00`..`-09`）反推的，恰好正确。但每个后续周期的上传顺序不同，位置假设全部失效。

### 结构性缺陷：extractor 盲信调用方

`AvcTemplateExtractor.extractAll(filePath, rawCategory)` 调用 `requireCategory(rawCategory)` —— 只校验品类**在词表内**，从不校验它与**文件内容**是否一致。即便每份文件的 `目录` sheet R1 标题（`《AVC-<品类>-线上零售市场监测月度数据报告》`）就写明了真实品类。品类是被调用方**断言**的，不是从源**派生**的。一个脚本里的位置笔误就能静默污染 40 份文件的数据。

### 权威审计（基于 50 份文件的 目录 标题）

| 真实品类（目录标题） | 文件数 | 备注 |
|---------------------|-------|------|
| 22.12 全部 10 品类 | 10 | ✅ 唯一正确的周期 |
| 其余 40 份 | 40 | ❌ 错标 |

**40/50 文件被错标。** 目录标题在 100% 的文件中存在且可解析（R1，合并单元格 C2:C6）。

### 关键发现：奥维在 24.12 周期改了 3 个品类口径——但性质不同

| 槽位 | 22.12–23.12 | 24.12 起 | 零售额跨界变化 | 性质 |
|------|------------|---------|--------------|------|
| 微波炉 | 微波炉 | 台式单功能微波炉 | −10%，品牌几乎不变 | ✅ 纯改名（同口径） |
| 料理机 | 料理机 | 破壁机 | −40%，品牌大部分重叠 | ⚠️ 收窄（料理机 ⊃ 破壁机） |
| 烤箱 | 电烤箱 | 台式复合机 | **−61%**，子类型从嵌入式/台式翻转为微蒸烤/蒸烤，品牌大换血（老板/方太/西门子 → 东芝/松下/小米） | ❌ **不同口径，非改名** |

电烤箱 → 台式复合机 **不是**改名：是奥维把跟踪口径从"所有电烤箱"收窄成"台式蒸烤复合机"。跨界画一条连续趋势线会谎报"烤箱市场暴跌 61%"，实则只是奥维不再统计嵌入式烤箱。

## Decision

### 1. Extractor 从源派生品类，调用方断言降级为交叉校验

`extractAll` 读 `目录` R1 标题 → `normalizeCategory` → 作为权威品类。调用方传入的 `rawCategory` 变为**可选的 fail-fast 交叉校验**：若提供且与文件声明不符，抛 `Category mismatch` 异常。

```typescript
async extractAll(filePath: string, assertedCategory?: string) {
  const workbook = await this.load(filePath);
  const declared = this.readDeclaredCategory(workbook, sourceReport); // 目录 R1 → normalizeCategory
  if (assertedCategory) {
    const asserted = normalizeCategory(assertedCategory);
    if (asserted && asserted !== declared) {
      throw new Error(`Category mismatch in ${sourceReport}: caller asserted "${asserted}" but file declares "${declared}"`);
    }
  }
  const category = declared;  // 文件是真相之源
  // ...
}
```

设计原则（与 ADR-0057 同源的 Palantir **Function-Backed Context** 模式）：**值从源计算，绝不盲信调用方。** 一个脚本里的位置笔误再也无法错标数据——文件标题覆盖断言。

`readDeclaredCategory` 镜像既有 `readCoverMonth` 的模式：定位 `目录` sheet，读 R1 第一个含 `AVC` 的字符串单元格，按 `-` 分割取 token[1]，过 `normalizeCategory`。标题缺失或品类不可归一时抛错（loud fail，不静默跳过）。

### 2. 台式复合机 成为独立 canonical 品类

`CANONICAL_CATEGORIES` 加入 `台式复合机`，**不**别名到 电烤箱。

```typescript
const CANONICAL_CATEGORIES = [ /* ... */, '电烤箱', '煎烤机', '台式复合机' ];
```

- 电烤箱：22.12–23.12（2 期）
- 台式复合机：24.12–26.04（3 期）
- 两条独立短序列——诚实反映奥维在不同时期跟踪的不同口径。

对比：`台式单功能微波炉 → 微波炉` 和 `破壁机/料理机 → 食品料理机` 保留为别名（已在 `CATEGORY_ALIASES`），因为它们是同口径或可接受的收窄。台式复合机是唯一一个口径真正改变、必须独立的。

### 3. 数据修正：全量清除 + 干净重灌

`externalId` 内嵌品类（`avc-stars.ts`：`${category}_${month}_${metric}` 等），所以把文件 `-48` 以正确的 `台式复合机` 重灌只会**新增** `台式复合机_*` 行，旧的 `电饭煲_*` 错标行成为**孤儿**，upsert 匹配不到、不会覆盖。重灌单独做只会让错误数据与正确数据并存。

因此修正步骤为：
1. 软删除 纯米 租户全部 AVC 实例（market_metric / brand_share / model_metric / avc_report）
2. 用修复后的路径重放全部 51 份文件（archive 完好，幂等可重放）
3. 重灌顺带正确重写 avc_report provenance（交付报告曾标注其偏薄）

选全量 wipe-and-reload 而非外科手术式修补：archive 在手 + 幂等重放的前提下，清空重灌远比逐文件 remap 不易出错，也不会漏掉孤儿行。

## Consequences

### Positive
- **品类错标类 bug 结构性消失** —— 文件自描述覆盖任何调用方断言，位置笔误无法再污染数据
- **交叉校验留下绊线** —— 下一个传错品类的调用方会响亮失败，而非静默错标
- **趋势诚实** —— 电烤箱与台式复合机分列，不会谎报 61% 暴跌
- **40 份错标文件被修正** —— 纯米 demo 前数据正确
- **archive 无需重新下载** —— 真相一直在文件的 目录 标题里

### Negative
- **破坏性数据操作** —— 全量软删 + 重灌；需在重灌前确认
- **batch-reingest-avc.ts 的 CATEGORY_CYCLE 失去作用** —— 应删除（文件覆盖之，不再 load-bearing）；删除独立于正确性，可单独提交
- **台式复合机 是词表新成员** —— Agent schema menu 多一个品类；与 电烤箱 是两条短序列而非一条长趋势

### 兼容性
- 既有调用方（`avc-bulk-ingest.ts`、`AvcConnector.fetch`、e2e fixtures）继续传 category —— 现在它只是交叉校验，匹配则无副作用，不匹配则按设计抛错暴露问题。
- `normalizeCategory` / `requireCategory` 签名不变；仅 `CANONICAL_CATEGORIES` 增一项。

## Alternatives Considered

### Alternative A: 只修脚本里的 idx%10 映射表

把 `CATEGORY_CYCLE` 改成正确的 per-file 映射。

❌ 拒绝原因：
- 只补这 50 份文件，地雷仍在 —— 下一个传错品类的 ingest 路径会再次静默错标
- 把品类继续当作调用方断言，不解决结构性缺陷

### Alternative B: extractor 完全忽略调用方品类（drop rawCategory）

只从文件派生，删掉 `rawCategory` 参数。

❌ 拒绝原因：
- blast radius 更大（每个调用方 + 测试都要改）
- 丢掉绊线 —— 文件标题若真错，无人察觉（奥维标题至今 100% 可靠，但保留低成本绊线更稳健）

### Alternative C: 台式复合机 别名到 电烤箱（保连续趋势）

把 台式复合机 当作 电烤箱 的新名，拼成一条 5 期连续趋势。

❌ 拒绝原因：
- 数据证伪：跨 23.12→24.12 边界零售额暴跌 61%、子类型翻转、品牌大换血 —— 不是同一口径
- 连续趋势线会谎报"烤箱市场崩盘"，实则奥维收窄了统计范围

## Implementation Notes

### 文件变更清单

| 类型 | 文件 | 变更 |
|------|------|------|
| 派生 | `apps/core-api/src/modules/research/avc-template-extractor.ts` | `extractAll` 从 目录 派生品类 + 交叉校验；新增 `readDeclaredCategory` |
| 词表 | `packages/shared-types/src/category.ts` | `CANONICAL_CATEGORIES` 加 `台式复合机` |
| 测试 | `avc-template-extractor.spec.ts` | 派生正确品类、mismatch 抛错、台式复合机 可归一 |
| 脚本 | `scripts/batch-reingest-avc.ts` | 删除 `CATEGORY_CYCLE`（不再 load-bearing） |
| 数据 | （运维步骤） | 软删 AVC 实例 + 全量重灌 51 文件 |

### readDeclaredCategory（镜像 readCoverMonth）

```typescript
private readDeclaredCategory(workbook: ExcelJS.Workbook, sourceReport: string): string {
  const toc = workbook.getWorksheet('目录');
  if (!toc) throw new Error(`AVC sheet "目录" not found in ${sourceReport}.`);
  let title = '';
  for (let c = 1; c <= 8; c++) {
    const v = this.cellText(toc.getRow(1).getCell(c).value);
    if (v.includes('AVC')) { title = v; break; }
  }
  const declared = title.replace(/[《》]/g, '').split('-')[1] ?? '';
  const canonical = normalizeCategory(declared);
  if (!canonical) throw new Error(`Cannot derive 品类 from 目录 title "${title}" in ${sourceReport}.`);
  return canonical;
}
```

## References

- ADR-0042: 品类/价格段 spine（`normalizeCategory` / `requireCategory` 的来源）
- ADR-0057: Ontology Dimension Constraints（同源的 Function-Backed Context 模式：值从源派生，不信调用方）
- ADR-0055/0056: AVC 汇入 Connector + Pipeline（`AvcConnector.fetch` 调用 `extractAll` 的路径）
- CONTEXT.md "Category Drift" / "AVC Report" 术语条目
- 发现链：用户质疑"东芝份额 18.61% 过高" → 目录标题审计 → 40/50 错标 → 24.12 三处品类漂移
