export type CourierName = 'tcs' | 'leopards' | 'postex' | 'daraz' | 'dex' | 'trax';

export interface HistoryItem {
  timestamp: string;
  status: string;
  location?: string;
  step?: number;
  completed?: boolean;
}

export interface TrackingResult {
  status: string;
  location: string;
  timestamp: string;
  history: HistoryItem[];
  delivered: boolean;
  customer?: string;
  error?: string;
}

export interface ParcelConfig {
  name: string;
  courier: CourierName;
  tracking_number: string;
}

export interface NtfyConfig {
  server: string;
  topic: string;
  priority: string;
  tags: string[];
}

export interface AppConfig {
  trackers: ParcelConfig[];
  ntfy: NtfyConfig;
}

export interface StateEntry {
  status: string;
  last_checked: string;
  location?: string;
  delivered_at?: string;
  removed?: boolean;
  history?: HistoryItem[];
  customer?: string;
}

export type TrackingState = Record<string, StateEntry>;

export interface StatusChange {
  name: string;
  courier: CourierName;
  tracking_number: string;
  result: TrackingResult;
  previous_status: string;
}
