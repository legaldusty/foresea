import { useEffect } from 'react';
import { HandPalm, Prohibit, X } from '@phosphor-icons/react';
import type { ModelCard } from '../../shared/protocol';
import { Button } from '../ui';
import { withMono } from './Headline';
import '../../styles/inspect.css';

const NEVER = 'Never acts on its own';
const FEEDS = 'Feeds decisions the Standing Orders allow; a person can stop or undo them';

function runTime(ms: number | null) {
  if (ms === null || !isFinite(ms)) return <span className="na">Not measured</span>;
  return <span className="qty"><span className="mono">{ms < 10 ? ms.toFixed(1) : Math.round(ms).toLocaleString()}</span><span className="u">ms</span></span>;
}

function perMinute(n: number | null) {
  if (n === null || !isFinite(n)) return <span className="na">Not measured</span>;
  return <span className="mono">{n < 10 && !Number.isInteger(n) ? n.toFixed(1) : Math.round(n).toLocaleString()}</span>;
}

function ModelEntry(props: { m: ModelCard }) {
  const m = props.m;
  return (
    <article className="mdl-entry" data-testid={`model-${m.id}`}>
      <div className="mdl-id">
        <h3 data-testid={`model-${m.id}-name`}>{m.name}</h3>
        <span className="kind">{withMono(m.kind)}</span>
      </div>
      <div className="mdl-body">
        <dl className="mdl-facts">
          <div><dt>What it does</dt><dd data-testid={`model-${m.id}-role`}>{withMono(m.role)}</dd></div>
          <div>
            <dt>Authority</dt>
            <dd className="authority" data-testid={`model-${m.id}-authority`}>
              {m.decides ? <HandPalm size={16} /> : <Prohibit size={16} />}
              <span>{m.decides ? FEEDS : NEVER}</span>
            </dd>
          </div>
          <div><dt>Trained on</dt><dd data-testid={`model-${m.id}-trained`}>{withMono(m.trainedOn)}</dd></div>
        </dl>
        <div className="mdl-split">
          <div className="mdl-table" data-testid={`model-${m.id}-metrics`}>
            <div className="mdl-row head"><span>Metric</span><span className="v">Value</span></div>
            {m.metrics.length ? m.metrics.map((x) => (
              <div className="mdl-row" key={x.label}><span>{x.label}</span><span className="v">{withMono(x.value)}</span></div>
            )) : <div className="mdl-row"><span className="na">No metrics reported</span><span /></div>}
          </div>
          <div className="mdl-table" data-testid={`model-${m.id}-runtime`}>
            <div className="mdl-row head"><span>Runtime</span><span className="v" /></div>
            <div className="mdl-row"><span>Last run</span><span className="v">{runTime(m.lastRunMs)}</span></div>
            <div className="mdl-row"><span>Runs per minute</span><span className="v">{perMinute(m.runsPerMinute)}</span></div>
          </div>
        </div>
      </div>
    </article>
  );
}

export function ModelsPanel(props: { models: ModelCard[]; onClose: () => void }) {
  const { models, onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const acting = models.filter((m) => m.decides).length;
  const meta = models.length
    ? withMono(`${models.length} ${models.length === 1 ? 'model' : 'models'}. ${acting} ${acting === 1 ? 'feeds' : 'feed'} decisions the signed Standing Orders allow; ${models.length - acting} ${models.length - acting === 1 ? 'never acts on its own' : 'never act on their own'}. Each entry says what the model does, what it learned from and how it scores.`)
    : 'No models reported by the hub.';
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet mdl" role="dialog" aria-label="Models" onClick={(e) => e.stopPropagation()} data-testid="models-panel">
        <div className="sheet-head">
          <div className="title-block">
            <h2>Models</h2>
            <span className="t-small c-muted" data-testid="models-summary">{meta}</span>
          </div>
          <Button variant="quiet" icon={<X size={16} />} onClick={onClose} testId="models-close">Close</Button>
        </div>
        <div className="sheet-body">
          {models.length ? (
            <div className="mdl-list">
              {models.map((m) => <ModelEntry key={m.id} m={m} />)}
            </div>
          ) : <p className="mdl-empty">Nothing to show until the hub sends its model list.</p>}
        </div>
      </div>
    </div>
  );
}
