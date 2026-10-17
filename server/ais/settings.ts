export interface HarborPoint {
  id?: string;
  name: string;
  lon: number;
  lat: number;
  kind?: string;
  emptyId?: string;
}

export interface AisSettingsBlock {
  bbox: number[][];
  messageTypes: string[];
  berthRadiusMeters: number;
  berthedMaxKnots: number;
  staleMinutes: number;
  onTimeLateMinutes: number;
  onTimeMinKnots: number;
  onTimeStaleEtaHours: number;
  breakwaterLonLat: number[][];
  recording: string;
  replaySpeed: number;
  replayMaxGapSeconds: number;
  replayLoopPauseSeconds: number;
  replayWarmStartMinutes: number;
  connectTimeoutSeconds: number;
  liveFirstVesselSeconds: number;
  reconnectBaseSeconds: number;
  reconnectMaxSeconds: number;
  emitMaxPerSecond: number;
  berthMinLengthM: number;
  displayTimeZone: string;
}

export interface AisSettings {
  ais: AisSettingsBlock;
  harbor: { targets: HarborPoint[]; gates: HarborPoint[] };
}
