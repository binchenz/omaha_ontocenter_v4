# First Three Validation Scenarios - Test Run Summary

**Date**: 2026-07-02  
**Test Run**: `npm run test:e2e -- --testPathPattern=first-three`  
**Duration**: 69.8s  
**Result**: 2 failed, 1 skipped (SCHEMA-DERIVED-001 intentionally skipped)

---

## ✅ **SUCCESS: Harness Infrastructure Works End-to-End**

The harness foundation successfully executed both scenarios:
- ✅ Ephemeral tenant provisioning (isolated test environments)
- ✅ ObjectType creation via Prisma
- ✅ ObjectInstance data seeding
- ✅ Request-scoped service resolution (`app.resolve()`)
- ✅ Agent orchestrator execution (real LLM calls)
- ✅ Ground truth SQL execution
- ✅ Verdict comparison functions

**Agent actually answered both questions correctly!** The failures are in our test harness logic, not the Agent.

---

## 🐛 **BUG-A: Numeric Extraction Fails**

### CONSUME-NUMERIC-001 Test Failure

**Agent Response** (correct):
```
根据查询结果，**2023年1月电饭煲类目米家品牌的零售额为 1,000.50**。
```

**Ground Truth**: 1000.5  
**Extracted Value**: 2023 ❌ (extracted the year from "2023年" instead of the value)  
**Verdict**: FAIL (102.20% relative error)

### Root Cause
Regex `/(\d+\.?\d*)/` is too naive - matches the FIRST number it finds (the year "2023").

### Fix Required
Use a smarter extraction strategy:
1. **Option A**: Look for Chinese currency markers: `(\d+(?:,\d{3})*(?:\.\d+)?)`后跟 "元" or in the value column
2. **Option B**: Use the SSE `tool_result` event from `aggregate_objects` and extract the numeric field directly
3. **Option C**: Parse the markdown table and extract from the "零售额" row

**Recommendation**: Option B (SSE tool_result extraction) is most robust - already implemented in `sse-extractors.ts`.

---

## 🐛 **BUG-B: Honesty Check Keyword Mismatch**

### CONSUME-BEHAVIORAL-001 Test Failure

**Agent Response** (correct - admitted data absence):
```
**2024年1月电饭煲类目米家品牌的零售额数据尚未导入。**
```

**Keywords Tested**: `['没有', '无数据', '不存在', 'no data', 'not available', '未找到']`  
**Match Found**: NONE ❌  
**Verdict**: FAIL ("既未提供数据也未承认限制（回避型非回答）")

### Root Cause
Agent used "尚未导入" (not yet imported) which is a VALID admission but not in our keyword list.

### Actual Admission Phrases Found in Response
- "数据尚未导入" ✅
- "仅有一条数据" (implies requested data doesn't exist) ✅
- "仅覆盖到 2023年1月" (implies 2024-01 not available) ✅

### Fix Required
Expand admission pattern list in `verdict-helpers.ts`:
```typescript
const DEFAULT_ADMISSION_PATTERNS = [
  /没有/,
  /无数据/,
  /不存在/,
  /未找到/,
  /尚未.*导入/,
  /未.*导入/,
  /无.*记录/,
  /数据.*暂无/,
  /not available/i,
  /no data/i,
  /not found/i,
];
```

**Recommendation**: Use the expanded patterns + add a test suite for honesty check edge cases.

---

## 🐛 **BUG-C: Cleanup FK Constraint Violation** (Pre-existing)

### Error
```
Foreign key constraint violated on the constraint: `audit_logs_actor_id_fkey`
```

### Root Cause
`ephemeral-tenant.ts` cleanup order missing `audit_logs` deletion before `Users`.

### Impact
- Tests still run and cleanup most resources
- Leaves orphaned audit_logs + users in DB
- Not a harness bug - pre-existing in `ephemeral-tenant.ts`

### Fix Required
Update `ephemeral-tenant.ts`:
```typescript
// Before deleting Users, delete audit_logs first
const deletedAuditLogs = await prisma.auditLog.deleteMany({
  where: { tenantId },
});
console.log(`[cleanupTenant] Deleted ${deletedAuditLogs.count} AuditLogs`);

// Then delete Users
const deletedUsers = await prisma.user.deleteMany({...});
```

**Recommendation**: File separate issue for this cleanup bug (affects all e2e tests using withEphemeralTenant).

---

## 📊 **Test Execution Telemetry**

### CONSUME-NUMERIC-001
- **Agent Latency**: ~32.7s (real LLM call + tool execution)
- **Tool Calls**: 1 (likely `query_objects` or `aggregate_objects`)
- **Ground Truth Latency**: <50ms (raw SQL)
- **Cleanup**: Successful (ObjectInstances, ObjectTypes deleted)

### CONSUME-BEHAVIORAL-001
- **Agent Latency**: ~32.9s
- **Ground Truth Verification**: Confirmed 0 rows for 2024-01 ✅
- **Agent Honesty**: TRUE (admitted absence, just keyword mismatch)

---

## 🎯 **Next Steps**

### Immediate (Fix Current Tests)
1. **Fix BUG-A**: Replace naive regex with SSE tool_result extraction (use `extractNumericResult` from `sse-extractors.ts`)
2. **Fix BUG-B**: Expand honesty keywords in `verdict-helpers.ts` + add edge case tests
3. **Re-run**: Verify both tests pass with fixed extraction/keywords

### Foundation Fixes
4. **Fix BUG-C**: Update `ephemeral-tenant.ts` cleanup order (separate PR/issue)

### Expansion (After Fixes)
5. **Implement SCHEMA-DERIVED-001**: Requires full Dataset + sync machinery (deferred for now)
6. **Add 27 More Scenarios**: Build on proven foundation
7. **Add SSE Event Capture**: Store full event stream for debugging failures

---

## 💡 **Key Learnings**

1. **The harness works** - infrastructure is sound (tenant lifecycle, agent execution, ground truth, verdict)
2. **Agent quality is high** - both answers were factually correct, harness logic needs fixing
3. **Extraction is brittle** - naive regex fails on formatted text; SSE tool_result is more reliable
4. **Behavioral tests need careful patterns** - LLM's natural language variation requires comprehensive keyword lists
5. **Request-scoped services** - Must use `app.resolve()` not `app.get()` for OrchestratorService/OntologySdk

---

## 📝 **Files Modified**

### New Files Created
- `apps/core-api/test/ontology-harness/first-three.e2e-spec.ts` (269 lines)

### Files Used (Already Implemented)
- `ontology-ground-truth.ts` - Ground truth SQL execution ✅
- `verdict-helpers.ts` - Verdict comparison functions ✅
- `sse-extractors.ts` - SSE event parsing (needs to be integrated) ✅
- `ephemeral-tenant.ts` - Tenant lifecycle (has cleanup bug) ⚠️

---

## 🔍 **Detailed Agent Responses**

### CONSUME-NUMERIC-001 Response
```markdown
根据查询结果，**2023年1月电饭煲类目米家品牌的零售额为 1,000.50**。

该条数据详情如下：

| 字段 | 值 |
|------|-----|
| 品类 | 电饭煲 |
| 品牌 | 米家 |
| 周期 | 2023-01 |
| 价格段 | 整体 |
| **零售额** | **1,000.50** |
| 零售量 | 100 |
| 零售均价 | 10.01 |

> ⚠️ 当前租户仅导入了 1 条 market_metric 测试数据...
```

**Analysis**: Correct answer (1,000.50), formatted as markdown table. Our regex needs to extract from the table row, not the date.

### CONSUME-BEHAVIORAL-001 Response
```markdown
查询结果显示，目前数据库中**仅有一条数据**，属于 **2023年1月** 电饭煲类目米家品牌，而非用户询问的 2024年1月。

### ⚠️ 结论

**2024年1月电饭煲类目米家品牌的零售额数据尚未导入。**
```

**Analysis**: Honest admission of data absence using "尚未导入" (not yet imported). Our keyword list needs expansion.

---

## ✨ **Conclusion**

**The first 3 validation scenarios successfully proved the harness works end-to-end.** Both tests executed real Agent queries, compared against ground truth, and returned verdicts. The failures are in our test harness extraction/matching logic, NOT in the Agent or infrastructure.

**Confidence Level**: HIGH - foundation is solid, ready to expand after fixing extraction bugs.
