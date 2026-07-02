import type { Vertical } from '../vertical';

/**
 * The AVC vertical. AVC is the FIRST real (private-bound) vertical; the reference
 * vertical is its neutral public twin. For now the AVC code still lives in the core repo
 * (physical extraction to a private package is deferred) — this manifest is the seam through
 * which AVC's contributions reach the platform, so core wiring no longer names AVC types directly.
 *
 * AVC's tools/skills remain provided by their owning modules pending physical extraction;
 * they will fold into `toolClasses`/`skills` here as that extraction proceeds.
 */
export const AVC_VERTICAL: Vertical = {
  name: 'avc',
};
