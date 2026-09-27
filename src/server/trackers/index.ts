import type { CourierName, TrackingResult } from './types.ts';
import { trackDEX } from './dex.ts';
import { trackTCS } from './tcs.ts';
import { trackPostEx } from './postex.ts';
import { trackTrax } from './trax.ts';
import { trackLeopards } from './leopards.ts';

export type * from './types.ts';

export async function trackParcel(courier: CourierName, trackingNumber: string): Promise<TrackingResult> {
  const normCourier = courier.toLowerCase().trim() as CourierName;
  switch (normCourier) {
    case 'dex':
    case 'daraz':
      return trackDEX(trackingNumber);
    case 'tcs':
      return trackTCS(trackingNumber);
    case 'postex':
      return trackPostEx(trackingNumber);
    case 'trax':
      return trackTrax(trackingNumber);
    case 'leopards':
      return trackLeopards(trackingNumber);
    default:
      throw new Error(`Unknown courier: ${courier}. Supported: tcs, leopards, postex, daraz, dex, trax`);
  }
}
