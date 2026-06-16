import { judgeModelGroundedness } from './scenario-judges';
import type { GroundTruth } from './ground-truth';
import type { SseEvent } from '../test-helpers';

/**
 * #202 — BND-3 must judge fabrication by GROUNDEDNESS (is each cited SKU real?), not a keyword
 * blacklist. The eval caught the old /纯米.*(IH…)/ regex flagging an answer that listed 小米's
 * REAL TOP-100 models (MFB13A0-1=底盘加热, MFB17AM=IH加热 — all present in model_metric) as
 * fabrication. Named .e2e-spec.ts for the runner; uses a STUB gt, no DB/LLM.
 */
const txt = (content: string): SseEvent[] => [{ type: 'text', content } as any];
const stubGt = (known: string[]): GroundTruth =>
  ({ modelNamesForCategory: async () => known } as unknown as GroundTruth);

describe('judgeModelGroundedness (#202: BND-3 有据性取代关键词黑名单)', () => {
  it('passes when every cited SKU is a real model of the category (the #202 false-positive case)', async () => {
    const events = txt('纯米（小米品牌）旗舰机型：MFB13A0-1（底盘加热）、MFB17AM（IH加热），均价 154 元。');
    const v = await judgeModelGroundedness({ category: '电饭煲' })({
      events, gt: stubGt(['MFB13A0-1', 'MFB17AM', 'MFB14A0CC']), tenantId: 't1',
    });
    expect(v.behaviorCorrect?.pass).toBe(true);
  });

  it('fails when a cited SKU is absent from the data (genuine fabrication)', async () => {
    const events = txt('纯米旗舰是 RC-X999（球釜 IH），参数顶配。');
    const v = await judgeModelGroundedness({ category: '电饭煲' })({
      events, gt: stubGt(['MFB13A0-1', 'MFB17AM']), tenantId: 't1',
    });
    expect(v.behaviorCorrect?.pass).toBe(false);
  });

  it('does not flag an honest "no model data" admission (nothing cited to ground)', async () => {
    const events = txt('该期为 essence（精华版），没有机型层数据，无法给出具体 SKU。');
    const v = await judgeModelGroundedness({ category: '电饭煲' })({
      events, gt: stubGt(['MFB13A0-1']), tenantId: 't1',
    });
    expect(v.behaviorCorrect?.pass).toBe(true);
  });
});
