/**
 * ACTION NEEDED — the secondary screen.
 *
 * The timeline answers "what's on". This answers "what will bite us". Items
 * are ordered by severity then by how soon the event is, so the top of this
 * list is always the most pressing thing in the business.
 */

import { getDashboard } from '@/lib/data';
import { countBySeverity, type ActionItem, type Severity } from '@/lib/actions';
import {
  daysUntilEvent,
  formatMoney,
  SYSTEM_LABELS,
  sourceUrl,
  type Job,
} from '@/lib/domain';

export const dynamic = 'force-dynamic';

const SEVERITY_LABEL: Record<Severity, string> = {
  urgent: 'Urgent',
  soon: 'Soon',
  fyi: 'Worth knowing',
};

function whenLabel(job: Job, now: Date): string {
  const d = daysUntilEvent(job, now);
  if (d == null) return 'No date set';
  if (d < 0) return `${Math.abs(d)} days ago`;
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  return `In ${d} days`;
}

function ActionCard({ item, now }: { item: ActionItem; now: Date }) {
  const link = sourceUrl(item.job, item.actIn);
  return (
    <div className={`action ${item.severity}`}>
      <div className="action-head">
        <h3>{item.title}</h3>
        <span className={`chip ${item.severity === 'fyi' ? 'ghost' : item.severity}`}>
          {SEVERITY_LABEL[item.severity]}
        </span>
        <span className="chip ghost">{whenLabel(item.job, now)}</span>
        {item.job.quoteTotal ? (
          <span className="chip ghost">{formatMoney(item.job.quoteTotal)}</span>
        ) : null}
      </div>

      <p>{item.detail}</p>

      <div className="next-step">
        <b>Do this next</b>
        {item.nextStep}{' '}
        {link ? (
          <a className="plain" href={link} target="_blank" rel="noreferrer">
            Open in {SYSTEM_LABELS[item.actIn]} →
          </a>
        ) : (
          <span style={{ color: 'var(--ink-faint)' }}>({SYSTEM_LABELS[item.actIn]})</span>
        )}
      </div>
    </div>
  );
}

export default async function ActionsPage() {
  const data = await getDashboard();
  const now = new Date(data.fetchedAt);
  const counts = countBySeverity(data.actions);

  const groups: { severity: Severity; items: ActionItem[] }[] = (
    ['urgent', 'soon', 'fyi'] as Severity[]
  ).map((severity) => ({
    severity,
    items: data.actions.filter((a) => a.severity === severity),
  }));

  return (
    <>
      <div className="page-head">
        <h1>Action needed</h1>
        <p>
          Things that are at risk of slipping between systems — enquiries left unquoted, quotes
          with no reply, confirmed jobs with nobody booked, and events missing from the calendar.
        </p>
      </div>

      {data.isSample ? (
        <div className="banner sample">
          <div>
            <strong>Sample data</strong>
            <p>
              These alerts are generated from invented example jobs so you can see how the rules
              behave. Connect your systems on <a className="plain" href="/setup">Setup</a> to get
              real ones.
            </p>
          </div>
        </div>
      ) : null}

      <div className="stats">
        <div className="stat">
          <div className="label">Urgent</div>
          <div className={counts.urgent > 0 ? 'value urgent' : 'value'}>{counts.urgent}</div>
        </div>
        <div className="stat">
          <div className="label">Soon</div>
          <div className="value">{counts.soon}</div>
        </div>
        <div className="stat">
          <div className="label">Worth knowing</div>
          <div className="value">{counts.fyi}</div>
        </div>
      </div>

      {data.actions.length === 0 ? (
        <div className="empty">
          <h2>Nothing needs attention</h2>
          <p>Every job is quoted, crewed and in the calendar.</p>
        </div>
      ) : (
        groups.map(({ severity, items }) =>
          items.length === 0 ? null : (
            <section key={severity} style={{ marginBottom: 28 }}>
              <h2 style={{ marginBottom: 10 }}>
                {SEVERITY_LABEL[severity]} ({items.length})
              </h2>
              {items.map((item) => (
                <ActionCard key={item.id} item={item} now={now} />
              ))}
            </section>
          ),
        )
      )}
    </>
  );
}
