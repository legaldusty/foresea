import { Binoculars, CaretRight, CheckCircle, Eye, MapPin, Siren, Translate, Warning } from '@phosphor-icons/react';
import type { CaptainNotice, CaptainSnapshot, CaptainTodayRow, Priority } from '../../shared/protocol';
import { Button } from '../ui';
import { ChoiceRow, Header, Num, Pin, pinForReason } from './parts';
import { LANGUAGES, languageName, listDetail, listTitle, sentence } from './words';

function placeOf(row: CaptainTodayRow): string {
  const near = `${row.reason} near `;
  if (row.label.startsWith(near)) return row.label.slice(near.length);
  return row.label === row.reason ? '' : row.label;
}

export function TodaySheet(props: { snap: CaptainSnapshot | null; lang: string; onReport: () => void; onLanguage: () => void }) {
  const rows = props.snap?.today ?? [];
  const onRoute = rows.some((r) => r.onRoute);
  const updated = props.snap?.clock.label ?? null;
  return (
    <div className="cap-today" data-testid="today">
      <div className="head">
        <span className="t-title">{onRoute || !rows.length ? 'Today on your route' : 'Today in the harbor'}</span>
        <span className="t-small c-muted">
          {rows.length ? null : props.snap?.lastAllClearLabel ? <>Nothing on your route. Last notice: All clear at <span className="num">{props.snap.lastAllClearLabel}</span>. </> : 'Nothing on your route. '}
          {updated ? <>Updated <span className="num">{updated}</span>.</> : null}
        </span>
      </div>
      {rows.length ? (
        <div className="zones">
          {rows.map((r) => {
            const place = placeOf(r);
            return (
              <div className="cap-zone" key={r.id} data-testid={`today-${r.id}`}>
                <Pin kind={pinForReason(r.reason)} />
                <div className="text">
                  <span className="t-heading">{r.reason}{r.simulated ? <span className="simulated">Simulated</span> : null}</span>
                  <span className="t-small c-muted"><Num text={`${place ? `${place}, ` : ''}${r.timesLabel}${r.onRoute ? '' : '. Not on your route'}`} /></span>
                  <span className="t-body"><Num text={sentence(r.instructionText)} /></span>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      <Button variant="secondary" size="l" block icon={<Binoculars size={20} />} onClick={props.onReport} testId="report-sighting">Report a sighting</Button>
      <button type="button" className="cap-setting" onClick={props.onLanguage} data-testid="open-language">
        <Translate size={24} />
        <span className="label">Language</span>
        <span className="value">{languageName(props.lang)}</span>
        <CaretRight size={20} />
      </button>
    </div>
  );
}

const ROW_ICONS: Record<Priority, typeof Siren> = { P1: Siren, P2: Warning, P3: Eye, P4: MapPin };

export function NoticesScreen(props: { notices: CaptainNotice[]; cleared: CaptainSnapshot['allClear']; lang: string; onBack: () => void; onOpen: (id: string) => void }) {
  const cleared = [...props.cleared].reverse();
  return (
    <div className="cap-screen" data-testid="notices">
      <Header title="Notices" onBack={props.onBack} testId="notices-back" />
      <div className="scroll">
        <p className="intro">P4 notices are not on your route. They arrive silently, with no sound or buzz.</p>
        {props.notices.map((n) => {
          const Icon = ROW_ICONS[n.priority];
          return (
            <button type="button" className="cap-notice" key={n.id} onClick={() => props.onOpen(n.id)} data-testid={`notice-${n.priority}`}>
              <Icon size={20} className={`lead ${n.priority}`} />
              <span className="text">
                <span className="t-heading">{listTitle(n)}</span>
                <span className="t-small c-muted"><Num text={listDetail(n, props.lang)} /></span>
              </span>
              <span className="time">{n.publishedAtLabel}</span>
            </button>
          );
        })}
        {cleared.map((c) => (
          <div className="cap-notice" key={c.id}>
            <CheckCircle size={20} className="lead" />
            <span className="text">
              <span className="t-heading">All clear, {c.publicReason}</span>
              <span className="t-small c-muted">Lifted by {c.approvedBy}. Resume normal navigation.</span>
            </span>
            <span className="time">{c.atLabel}</span>
          </div>
        ))}
        {!props.notices.length && !cleared.length ? <p className="intro">No notices right now.</p> : null}
      </div>
    </div>
  );
}

export function LanguageScreen(props: { lang: string; onChoose: (code: string) => void; onBack: () => void }) {
  return (
    <div className="cap-screen" data-testid="language">
      <Header title="Language" onBack={props.onBack} testId="language-back" />
      <div className="scroll" role="radiogroup" aria-label="Language">
        <p className="intro">Notices arrive in your language. Radio calls stay in English.</p>
        {LANGUAGES.map((l) => (
          <ChoiceRow key={l.code} label={l.name} lang={l.code} selected={props.lang === l.code} onSelect={() => props.onChoose(l.code)} testId={`language-${l.code}`} />
        ))}
      </div>
    </div>
  );
}
