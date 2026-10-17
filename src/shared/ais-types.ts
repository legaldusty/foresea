export type DataSource = 'live' | 'replay' | 'cache' | 'snapshot';

export type VesselTypeLabel =
  | 'cargo'
  | 'tanker'
  | 'passenger'
  | 'tug'
  | 'pilot'
  | 'fishing'
  | 'pleasure'
  | 'sailing'
  | 'law'
  | 'sar'
  | 'other';

export type AisClass = 'A' | 'B';

export interface NavStatus {
  code: number;
  label: string;
}

export interface AisVessel {
  mmsi: number;
  name: string;
  lat: number;
  lon: number;
  sogKn: number | null;
  cogDeg: number | null;
  headingDeg: number | null;
  navStatus: NavStatus;
  shipType: number;
  typeLabel: VesselTypeLabel;
  lengthM: number | null;
  beamM: number | null;
  destination: string;
  etaReported: string | null;
  aisClass: AisClass;
  lastSeen: number;
  source: DataSource;
}

export type AisMode = 'live' | 'replay' | 'offline';

export interface AisRecordingInfo {
  file: string;
  recordedFrom: number;
  recordedTo: number;
  messages: number;
  speed: number;
}

export interface AisStatus {
  mode: AisMode;
  detail: string;
  since: number;
  recording?: AisRecordingInfo;
}
