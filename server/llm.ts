import type { Wording } from '../src/shared/protocol';
import type { WordingFacts } from '../src/engine/wording';
import { LANGUAGE_NAMES, type Lang } from '../src/engine/wording';
import { BANNED, EMOJI } from './wording-rules.mjs';

interface LanguageSettings { ollamaModels: string[]; timeoutMs: number; languages: string[] }

export interface LanguageModel {
  status: () => { source: 'granite' | 'template'; model: string | null; detail: string };
  word: (facts: WordingFacts, template: Wording) => Promise<Wording>;
  draftOrder: (plainEnglish: string) => Promise<string | null>;
}

const SYSTEM = [
  'You write short harbor messages for the Port of Los Angeles watch officer.',
  'Use only the facts given. Never add numbers, places, names or claims that are not in the facts.',
  'Public text (notice, vhf, sms, translations) never mentions drones, vehicles, weapons, threats or risk scores; it only says the public reason, the place and the instruction.',
  'Keep the instruction text exactly as given, in capitals.',
  'Plain mariner English, short sentences, no dashes, no exclamation marks.',
].join(' ');

const BANNED_PUBLIC = /\b(drone|vehicle|weapon|threat|attack|explosive|hostile|risk)\b/i;
const hasTell = (s: string): boolean => BANNED.some(([re]) => re.test(s)) || EMOJI.test(s);

function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:[.:]\d+)?/g) ?? []).map((n) => n.replace(/^0+(?=\d)/, ''));
}

function factsText(facts: WordingFacts): string {
  const lines = [
    `Public reason: ${facts.publicReason}.`,
    `Instruction: ${facts.instructionText}.`,
    facts.nearPlace ? `Place: near the ${facts.nearPlace}.` : '',
    `Valid until ${String(Math.floor(facts.validUntilMin / 60) % 24).padStart(2, '0')}:${String(Math.floor(facts.validUntilMin % 60)).padStart(2, '0')}.`,
    `Approved by ${facts.approvedBy}, ${facts.station}.`,
    `Boats rerouted: ${facts.boats.length}, adding ${Math.round(facts.totalAddedMin)} min in total.`,
    ...facts.boats.slice(0, 4).map((b) => `Boat ${b.name}: ${b.instructionText}.`),
  ];
  if (facts.contact) {
    const c = facts.contact;
    lines.push(
      `Officer only: contact ${c.label}, ${c.classification}, ${c.sizeM.toFixed(1)} m, ${c.speedMps.toFixed(1)} m/s, at ${c.lonlatText}.`,
      `Officer only: evidence ${c.evidence.join('; ')}; hostility ${c.hostility.toFixed(2)}.`,
      `Officer only: likeliest target ${c.targetName} at ${Math.round(c.odds * 100)} percent${c.etaMin !== null ? `, about ${Math.round(c.etaMin)} min out` : ''}; it ${c.damage}; risk ${c.riskScore} of 25, ${c.level}.`,
    );
  }
  return lines.filter(Boolean).join('\n');
}

function cleanText(s: unknown): string {
  return typeof s === 'string' ? s.replace(new RegExp(String.fromCodePoint(0x2014), 'g'), ', ').replace(/\s+/g, ' ').trim() : '';
}

function supported(text: string, allowed: Set<string>): boolean {
  return numbersIn(text).every((n) => allowed.has(n));
}

export function createLanguageModel(settings: LanguageSettings, host = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'): LanguageModel {
  let model: string | null = null;
  let detail = 'Checking for a local model';

  async function call(messages: { role: string; content: string }[], schema: object, timeoutMs: number): Promise<Record<string, unknown> | null> {
    if (!model) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${host}/api/chat`, {
        method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, stream: false, format: schema, keep_alive: '60m', options: { temperature: 0.2 }, messages }),
      });
      if (!res.ok) { detail = `Model error ${res.status}; using templates`; return null; }
      const body = (await res.json()) as { message?: { content?: string } };
      return JSON.parse(body.message?.content ?? 'null');
    } catch (err) {
      detail = (err as Error).name === 'AbortError' ? 'Model too slow; using templates for that draft' : 'Model unreachable; using templates';
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function probe(): Promise<void> {
    try {
      const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(1500) });
      const tags = (await res.json()) as { models?: { name: string }[] };
      const names = new Set((tags.models ?? []).map((m) => m.name));
      const found = settings.ollamaModels.find((m) => names.has(m) || names.has(`${m}:latest`)) ?? null;
      if (found && found !== model) {
        model = found;
        detail = `IBM Granite (${found}) through Ollama, on this laptop`;
        void call([{ role: 'user', content: 'Reply with {"ok":true}' }], { type: 'object', properties: { ok: { type: 'boolean' } } }, 30_000);
      }
      if (!found) { model = null; detail = 'No local model found; using templates'; }
    } catch {
      model = null;
      detail = 'Ollama not running; using templates';
    }
  }
  void probe();
  setInterval(() => void probe(), 60_000).unref();

  return {
    status: () => ({ source: model ? 'granite' : 'template', model, detail }),

    async word(facts, template) {
      if (!model) return template;
      const text = factsText(facts);
      const allowed = new Set([...numbersIn(text), ...numbersIn(template.notice), ...numbersIn(template.vhf), ...numbersIn(template.sms), '1', '2']);
      const english = await call([
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Facts:\n${text}\n\nWrite: notice (public, one or two sentences, include the place and the instruction), vhf (a complete 10 second radio call that starts "All stations, all stations, this is ${facts.station}" and ends "${facts.station} out"), sms (public, under 160 characters), why (officer only, one sentence explaining why this notice and these boats)${facts.contact ? ', brief (officer only, a short message to the Coast Guard with the contact facts, the prediction, the risk and what has been done; say nothing has touched the vehicle)' : ''}.` },
      ], {
        type: 'object',
        properties: { notice: { type: 'string' }, vhf: { type: 'string' }, sms: { type: 'string' }, why: { type: 'string' }, brief: { type: 'string' } },
        required: ['notice', 'vhf', 'sms', 'why'],
      }, Math.max(settings.timeoutMs, 9000));
      if (!english) return template;
      const pick = (field: 'notice' | 'vhf' | 'sms' | 'why' | 'brief', isPublic: boolean, check: (s: string) => boolean): { value: string; ok: boolean } => {
        const value = cleanText(english[field]);
        const ok = value.length > 0 && check(value) && supported(value, allowed) && !hasTell(value) && (!isPublic || !BANNED_PUBLIC.test(value));
        return { value, ok };
      };
      const instruction = facts.instructionText.toLowerCase();
      const notice = pick('notice', true, (s) => s.toLowerCase().includes(instruction));
      const vhf = pick('vhf', true, (s) => s.length > 60 && /all stations/i.test(s) && / out\.?$/i.test(s));
      const sms = pick('sms', true, (s) => s.length <= 200 && s.toLowerCase().includes(instruction));
      const why = pick('why', false, (s) => s.length > 30);
      const brief = facts.contact ? pick('brief', false, (s) => s.length > 80) : { value: '', ok: false };
      const used = [notice, vhf, sms, why, brief].filter((f) => f.ok).length;
      if (!used) return template;
      const publicNotice = notice.ok ? notice.value : template.notice;
      const translations = { ...template.translations };
      const langs = settings.languages.filter((l): l is Lang => l in LANGUAGE_NAMES);
      const translated = await call([
        { role: 'system', content: 'You translate short harbor notices for boat captains. Keep numbers and units exactly. Keep it short and plain. Reply with JSON only.' },
        { role: 'user', content: `Translate this notice into ${langs.map((l) => `${LANGUAGE_NAMES[l]} (${l})`).join(', ')}:\n${publicNotice}` },
      ], { type: 'object', properties: Object.fromEntries(langs.map((l) => [l, { type: 'string' }])), required: langs }, 20_000);
      const radius = String(Math.round(facts.radiusM / 50) * 50);
      for (const l of langs) {
        const t = cleanText(translated?.[l]);
        if (t && (facts.instruction !== 'KEEP CLEAR' || t.includes(radius)) && supported(t, allowed)) translations[l] = t;
      }
      return {
        source: 'granite',
        model,
        notice: publicNotice,
        vhf: vhf.ok ? vhf.value : template.vhf,
        sms: sms.ok ? sms.value : template.sms,
        why: why.ok ? why.value : template.why,
        aisMarker: template.aisMarker,
        translations,
        brief: brief.ok ? brief.value : template.brief,
      };
    },

    async draftOrder(plainEnglish) {
      const out = await call([
        { role: 'system', content: 'You turn a harbor officer\'s plain English standing order into one rule card sentence of the form IF <condition> THEN <action>. Use only the officer\'s words and numbers. Reply with JSON only.' },
        { role: 'user', content: plainEnglish },
      ], { type: 'object', properties: { rule: { type: 'string' } }, required: ['rule'] }, settings.timeoutMs);
      const rule = cleanText(out?.rule);
      return rule || null;
    },
  };
}
