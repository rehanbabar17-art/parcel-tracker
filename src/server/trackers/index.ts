import { CourierName, TrackingResult } from './types.js';
import { trackDEX } from './dex.js';
import { trackTCS } from './tcs.js';
import { trackPostEx } from './postex.js';
import { trackTrax } from './trax.js';
import { trackLeopards } from './leopards.js';

export * from './types.js';

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
