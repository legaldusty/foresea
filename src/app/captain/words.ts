import { useState } from 'react';
import type { CaptainNotice, Priority } from '../../shared/protocol';

export const LANGUAGES: { code: string; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'zh', name: '中文' },
  { code: 'ko', name: '한국어' },
  { code: 'tl', name: 'Tagalog' },
  { code: 'vi', name: 'Tiếng Việt' },
];

const LANGUAGE_KEY = 'giveway.language';

function readLanguage(): string {
  try {
    const v = localStorage.getItem(LANGUAGE_KEY);
    return v && LANGUAGES.some((l) => l.code === v) ? v : 'en';
  } catch {
    return 'en';
  }
}

export function useLanguage(): [string, (code: string) => void] {
  const [code, setCode] = useState(readLanguage);
  const choose = (next: string) => {
    setCode(next);
    try { localStorage.setItem(LANGUAGE_KEY, next); } catch { return; }
  };
  return [code, choose];
}

export function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? 'English';
}

export function translated(n: CaptainNotice, lang: string): string | null {
  if (lang === 'en') return null;
  return n.translations[lang] ?? null;
}

export function headline(n: CaptainNotice): string {
  if (!n.place) return n.publicReason;
  const place = n.place.replace(/^the /, '');
  return /nearby$/i.test(n.publicReason) ? n.publicReason.replace(/nearby$/i, `near ${place}`) : `${n.publicReason} near ${place}`;
}

export function sentence(upper: string): string {
  const lower = upper.toLowerCase().replace(/\bknots\b/g, 'kn');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function splitDetail(detail: string): [string, string] {
  const cut = detail.search(/\.\s+[A-Z]/);
  return cut < 0 ? [detail, ''] : [detail.slice(0, cut + 1), detail.slice(cut + 1).trim()];
}

export const PRIORITY_NAME: Record<Priority, string> = { P1: 'Act now', P2: 'Act soon', P3: 'Heads up', P4: 'Info' };

export function isSecurityWatch(n: CaptainNotice): boolean {
  return n.kind === 'security' && /^NO ACTION/.test(n.instructionText);
}

export function listTitle(n: CaptainNotice): string {
  if (n.kind === 'security' && n.crossingLabel && (n.priority === 'P3' || n.priority === 'P4')) return 'Unknown vessel near your route';
  return n.place ? `${n.publicReason}, ${n.place.replace(/^the /, '')}` : n.publicReason;
}

export function listDetail(n: CaptainNotice, lang: string): string {
  const head = `${n.priority} ${PRIORITY_NAME[n.priority]}${n.priority === 'P4' ? ', silent' : ''}.`;
  const route = n.priority === 'P4' ? ' Not on your route.' : '';
  const crossing = n.crossingLabel ? ` Expected ${n.crossingLabel}.` : '';
  const text = translated(n, lang);
  if (text) return `${head}${route}${crossing} ${text}`;
  const until = n.untilLabel ?? n.validUntilLabel;
  const action = isSecurityWatch(n) ? `${sentence(n.instructionText)}.` : `${sentence(n.instructionText)} until ${until}.`;
  return `${head}${route}${crossing} ${action}`;
}
