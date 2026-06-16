import type { Vertical } from '../vertical';

/**
 * The AVC vertical (ADR-0062 §3/§4). AVC is the FIRST real (private-bound) vertical; the reference
 * vertical is its neutral public twin. For now the AVC code still lives in the core repo (physical
 * extraction to a private package is #209) — this manifest is the seam through which AVC's
 * contributions reach the platform, so core wiring no longer names AVC types directly.
 *
 * Currently contributes the drill-gate (moved out of agent.module's TODO(#208) hardcode). AVC's
 * tools/skills remain provided by their owning modules pending #209's physical move; they will fold
 * into `toolClasses`/`skills` here as that extraction proceeds.
 */
export const AVC_VERTICAL: Vertical = {
  name: 'avc',
  drillGates: [
    {
      broadLayer: new Set(['brand_share', 'market_metric']),
      drillTarget: 'model_metric',
      confirmMessage: '即将下钻到机型（SKU）层。请确认要钻取的价格段/参数，确认后我再继续。',
    },
  ],
};
