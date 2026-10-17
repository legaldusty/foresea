import type { NoticeKind, PublicReason, Wording } from '../shared/protocol';
import { clockLabel, minutesLabel } from './eta';

export type Lang = 'es' | 'zh' | 'ko' | 'tl' | 'vi';

export const LANGUAGE_NAMES: Record<Lang, string> = {
  es: 'Spanish',
  zh: 'Chinese',
  ko: 'Korean',
  tl: 'Tagalog',
  vi: 'Vietnamese',
};

type PhraseKey = 'KEEP CLEAR' | 'SLOW' | 'USE EAST CHANNEL' | 'USE MAIN CHANNEL' | 'WAIT' | 'LEAVE ZONE' | 'ALL CLEAR';

const PHRASES: Record<Lang, Record<PhraseKey, (n: number) => string>> = {
  es: {
    'KEEP CLEAR': (n) => `MANTÉNGASE A ${n} m DE DISTANCIA`,
    SLOW: (n) => `REDUZCA A ${n} NUDOS`,
    'USE EAST CHANNEL': () => 'USE EL CANAL ESTE',
    'USE MAIN CHANNEL': () => 'USE EL CANAL PRINCIPAL',
    WAIT: () => 'ESPERE',
    'LEAVE ZONE': () => 'SALGA DE LA ZONA AHORA',
    'ALL CLEAR': () => 'FIN DEL AVISO',
  },
  zh: {
    'KEEP CLEAR': (n) => `保持 ${n} 米距离`,
    SLOW: (n) => `减速至 ${n} 节`,
    'USE EAST CHANNEL': () => '使用东航道',
    'USE MAIN CHANNEL': () => '使用主航道',
    WAIT: () => '原地等待',
    'LEAVE ZONE': () => '立即驶离该区域',
    'ALL CLEAR': () => '警报解除',
  },
  ko: {
    'KEEP CLEAR': (n) => `${n} m 거리를 유지하십시오`,
    SLOW: (n) => `${n} 노트로 감속하십시오`,
    'USE EAST CHANNEL': () => '동쪽 수로를 이용하십시오',
    'USE MAIN CHANNEL': () => '주 수로를 이용하십시오',
    WAIT: () => '대기하십시오',
    'LEAVE ZONE': () => '즉시 구역을 벗어나십시오',
    'ALL CLEAR': () => '상황 해제',
  },
  tl: {
    'KEEP CLEAR': (n) => `LUMAYO NG ${n} m`,
    SLOW: (n) => `BUMAGAL SA ${n} KNOTS`,
    'USE EAST CHANNEL': () => 'GAMITIN ANG SILANGANG KANAL',
    'USE MAIN CHANNEL': () => 'GAMITIN ANG PANGUNAHING KANAL',
    WAIT: () => 'MAGHINTAY',
    'LEAVE ZONE': () => 'UMALIS SA LUGAR NGAYON DIN',
    'ALL CLEAR': () => 'LIGTAS NA',
  },
  vi: {
    'KEEP CLEAR': (n) => `GIỮ KHOẢNG CÁCH ${n} m`,
    SLOW: (n) => `GIẢM TỐC XUỐNG ${n} HẢI LÝ/GIỜ`,
    'USE EAST CHANNEL': () => 'ĐI LUỒNG PHÍA ĐÔNG',
    'USE MAIN CHANNEL': () => 'ĐI LUỒNG CHÍNH',
    WAIT: () => 'CHỜ',
    'LEAVE ZONE': () => 'RỜI KHỎI KHU VỰC NGAY',
    'ALL CLEAR': () => 'ĐÃ AN TOÀN',
  },
};

const REASONS: Record<Lang, Record<PublicReason, string>> = {
  es: { 'Security zone': 'Zona de seguridad', 'Whale nearby': 'Ballena cerca', 'Divers in water': 'Buzos en el agua', 'Dredge working': 'Draga trabajando', 'Person in the water': 'Persona en el agua', 'Area closed': 'Zona cerrada', 'Search area': 'Zona de búsqueda' },
  zh: { 'Security zone': '安全区', 'Whale nearby': '附近有鲸鱼', 'Divers in water': '水中有潜水员', 'Dredge working': '疏浚作业中', 'Person in the water': '有人在水中', 'Area closed': '区域关闭', 'Search area': '搜索区域' },
  ko: { 'Security zone': '보안 구역', 'Whale nearby': '근처에 고래 출현', 'Divers in water': '잠수부 작업 중', 'Dredge working': '준설 작업 중', 'Person in the water': '물에 사람이 있음', 'Area closed': '구역 폐쇄', 'Search area': '수색 구역' },
  tl: { 'Security zone': 'Sonang pangseguridad', 'Whale nearby': 'May balyena sa malapit', 'Divers in water': 'May mga maninisid sa tubig', 'Dredge working': 'May dredge na gumagana', 'Person in the water': 'May tao sa tubig', 'Area closed': 'Saradong lugar', 'Search area': 'Lugar ng paghahanap' },
  vi: { 'Security zone': 'Khu vực an ninh', 'Whale nearby': 'Có cá voi gần đây', 'Divers in water': 'Có thợ lặn dưới nước', 'Dredge working': 'Tàu nạo vét đang hoạt động', 'Person in the water': 'Có người dưới nước', 'Area closed': 'Khu vực đóng', 'Search area': 'Khu vực tìm kiếm' },
};

export interface WordingFacts {
  kind: NoticeKind;
  instruction: string;
  instructionText: string;
  publicReason: PublicReason;
  radiusM: number;
  slowKnots: number;
  nearPlace: string;
  validUntilMin: number;
  approvedBy: string;
  boats: { name: string; instructionText: string; addedMin: number }[];
  totalAddedMin: number;
  station: string;
  link: string;
  contact?: {
    label: string;
    classification: string;
    sizeM: number;
    speedMps: number;
    hostility: number;
    evidence: string[];
    targetName: string;
    odds: number;
    etaMin: number | null;
    riskScore: number;
    level: string;
    damage: string;
    lonlatText: string;
  };
}

function phraseNumber(instruction: string, facts: WordingFacts): number {
  return instruction === 'SLOW' ? facts.slowKnots : Math.round(facts.radiusM / 50) * 50;
}

const REASON_AT: Record<Lang, Record<PublicReason, (p: string) => string>> = {
  es: { 'Security zone': (p) => `Zona de seguridad cerca de ${p}`, 'Whale nearby': (p) => `Ballena cerca de ${p}`, 'Divers in water': (p) => `Buzos en el agua cerca de ${p}`, 'Dredge working': (p) => `Draga trabajando cerca de ${p}`, 'Person in the water': (p) => `Persona en el agua cerca de ${p}`, 'Area closed': (p) => `Zona cerrada cerca de ${p}`, 'Search area': (p) => `Zona de búsqueda cerca de ${p}` },
  zh: { 'Security zone': (p) => `${p}附近安全区`, 'Whale nearby': (p) => `${p}附近有鲸鱼`, 'Divers in water': (p) => `${p}附近有潜水员`, 'Dredge working': (p) => `${p}附近疏浚作业中`, 'Person in the water': (p) => `${p}附近有人在水中`, 'Area closed': (p) => `${p}附近区域关闭`, 'Search area': (p) => `${p}附近搜索区域` },
  ko: { 'Security zone': (p) => `${p} 근처 보안 구역`, 'Whale nearby': (p) => `${p} 근처에 고래 출현`, 'Divers in water': (p) => `${p} 근처 잠수부 작업 중`, 'Dredge working': (p) => `${p} 근처 준설 작업 중`, 'Person in the water': (p) => `${p} 근처 물에 사람이 있음`, 'Area closed': (p) => `${p} 근처 구역 폐쇄`, 'Search area': (p) => `${p} 근처 수색 구역` },
  tl: { 'Security zone': (p) => `Sonang pangseguridad malapit sa ${p}`, 'Whale nearby': (p) => `May balyena malapit sa ${p}`, 'Divers in water': (p) => `May mga maninisid malapit sa ${p}`, 'Dredge working': (p) => `May dredge na gumagana malapit sa ${p}`, 'Person in the water': (p) => `May tao sa tubig malapit sa ${p}`, 'Area closed': (p) => `Saradong lugar malapit sa ${p}`, 'Search area': (p) => `Lugar ng paghahanap malapit sa ${p}` },
  vi: { 'Security zone': (p) => `Khu vực an ninh gần ${p}`, 'Whale nearby': (p) => `Có cá voi gần ${p}`, 'Divers in water': (p) => `Có thợ lặn gần ${p}`, 'Dredge working': (p) => `Tàu nạo vét đang hoạt động gần ${p}`, 'Person in the water': (p) => `Có người dưới nước gần ${p}`, 'Area closed': (p) => `Khu vực đóng gần ${p}`, 'Search area': (p) => `Khu vực tìm kiếm gần ${p}` },
};

export function translateInstruction(lang: Lang, instruction: string, facts: WordingFacts): string {
  const table = PHRASES[lang];
  const key = (instruction in table ? instruction : 'KEEP CLEAR') as PhraseKey;
  const place = facts.nearPlace.replace(/^the /, '');
  const reason = place ? REASON_AT[lang][facts.publicReason](place) : REASONS[lang][facts.publicReason];
  return `${reason}: ${table[key](phraseNumber(key, facts))}`;
}

const DAMAGE_BY_KIND: Record<string, string> = {
  fuel: 'could start a fire or a spill',
  passenger: 'could hurt people on board or ashore',
  hull: 'could damage a loaded ship and stop cargo work',
  research: 'could damage research equipment',
};

export function damagePhrase(targetKind: string): string {
  return DAMAGE_BY_KIND[targetKind] ?? 'could cause damage';
}

function spokenNumber(meters: number): string {
  return `${Math.round(meters / 50) * 50} meters`;
}

export function reasonAt(reason: string, place: string): string {
  if (!place) return reason;
  return /nearby$/i.test(reason) ? reason.replace(/nearby$/i, `near ${place}`) : `${reason} near ${place}`;
}

export function templateWording(facts: WordingFacts): Wording {
  const until = clockLabel(facts.validUntilMin);
  const headline = reasonAt(facts.publicReason, facts.nearPlace);
  const notice = `${headline}. ${facts.instructionText}. Valid until ${until}. Approved by ${facts.approvedBy}, ${facts.station}.`;
  const boatsLine = facts.boats.length
    ? `${facts.boats.length === 1 ? 'One boat' : `${facts.boats.length} boats`} ${facts.boats.length === 1 ? 'is' : 'are'} in its path; the reroutes add ${Math.round(facts.totalAddedMin)} min in total.`
    : 'No boat routes cross it.';
  let why: string;
  if (facts.contact) {
    const c = facts.contact;
    const eta = c.etaMin !== null ? `, about ${minutesLabel(c.etaMin)} out` : '';
    why = `${c.targetName} is the likeliest target at ${Math.round(c.odds * 100)}%${eta}. A ${c.sizeM.toFixed(1)} m ${c.classification.toLowerCase()} there ${c.damage}, so the risk is ${c.riskScore} (${c.level}). ${boatsLine}`;
  } else {
    why = `${headline}. ${boatsLine}`;
  }
  const named = facts.boats.filter((b) => b.instructionText !== facts.instructionText).slice(0, 2)
    .map((b) => `${b.name}, ${b.instructionText.toLowerCase()}.`).join(' ');
  const spokenInstruction = facts.instruction === 'KEEP CLEAR' ? `Keep ${spokenNumber(facts.radiusM)} clear` : facts.instructionText.charAt(0) + facts.instructionText.slice(1).toLowerCase();
  const vhf = `All stations, all stations, this is ${facts.station}. ${headline}. ${spokenInstruction}. ${named} Until ${until}. ${facts.station} out.`.replace(/\s+/g, ' ');
  const aisMarker = `${facts.publicReason.toUpperCase()} ${facts.nearPlace.replace(/^the /, '').toUpperCase()} ${facts.instructionText} UNTIL ${until.replace(':', '')}`.replace(/\s+/g, ' ').slice(0, 160);
  const sms = `GIVE WAY: ${headline}. ${facts.instructionText} until ${until}. Map: ${facts.link}`;
  const translations: Record<string, string> = {};
  for (const lang of Object.keys(PHRASES) as Lang[]) translations[lang] = translateInstruction(lang, facts.instruction, facts);
  let brief: string | null = null;
  if (facts.contact) {
    const c = facts.contact;
    brief = [
      `${facts.station} to Coast Guard Sector Los Angeles-Long Beach.`,
      `${c.label}, an unidentified underwater contact (${c.classification.toLowerCase()}), about ${c.sizeM.toFixed(1)} m, ${c.speedMps.toFixed(1)} m/s, at ${c.lonlatText}.`,
      `Evidence: ${c.evidence.join('; ')}. Hostility estimate ${c.hostility.toFixed(2)}.`,
      `Predicted target ${c.targetName}, ${Math.round(c.odds * 100)}%${c.etaMin !== null ? `, about ${minutesLabel(c.etaMin)} out` : ''}. Risk ${c.riskScore} of 25 (${c.level}).`,
      `Actions so far: ${facts.publicReason.toLowerCase()} published, ${facts.instructionText}, ${facts.boats.length} boats rerouted. Nothing closed. Nothing has touched the vehicle.`,
      'Requesting your assessment and response.',
    ].join(' ');
  }
  return { source: 'template', model: null, notice, why, vhf, aisMarker, sms, translations, brief };
}

export function allClearWording(station: string, nearPlace: string, atMin: number): Pick<Wording, 'notice' | 'vhf' | 'aisMarker' | 'sms'> {
  const where = nearPlace ? ` near ${nearPlace}` : '';
  return {
    notice: `ALL CLEAR${where}. Resume normal navigation. ${clockLabel(atMin)}.`,
    vhf: `All stations, all stations, this is ${station}. All clear${where}. Resume normal navigation. ${station} out.`,
    aisMarker: `ALL CLEAR ${nearPlace.replace(/^the /, '').toUpperCase()} ${clockLabel(atMin).replace(':', '')}`.trim(),
    sms: `GIVE WAY: ALL CLEAR${where}. Resume normal navigation.`,
  };
}
