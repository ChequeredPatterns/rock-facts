import {
  confirmedCrewCount,
  crewShortfall,
  formatEventTime,
  formatMoney,
  JOB_STATUS_LABELS,
  SYSTEM_LABELS,
  type Job,
  type SystemId,
} from '@/lib/domain';

/** Short codes for the source indicator squares. */
const SOURCE_CODE: Record<SystemId, string> = {
  streak: 'S',
  onrent: 'OR',
  calendar: 'C',
  connecteam: 'CT',
  gmail: 'G',
};

const ALL_SYSTEMS: SystemId[] = ['streak', 'onrent', 'calendar', 'connecteam'];

function statusChipClass(job: Job): string {
  switch (job.status) {
    case 'accepted':
      return 'chip ok';
    case 'not_accepted':
      return 'chip ghost';
    case 'completed':
      return 'chip ghost';
    case 'unknown':
      return 'chip soon';
    default:
      return 'chip';
  }
}

/**
 * One job on the timeline. Shows at a glance: when, who, what it's worth,
 * where it sits in the pipeline, who's crewed, and which systems know about
 * it — the last being the thing no single existing tool can tell you.
 */
export function JobRow({ job }: { job: Job }) {
  const shortfall = crewShortfall(job);
  const confirmed = confirmedCrewCount(job);

  return (
    <article className="job">
      <div className="job-time">{formatEventTime(job)}</div>

      <div className="job-main">
        <h3>
          {job.ref ? <span style={{ color: 'var(--ink-faint)' }}>{job.ref} </span> : null}
          {job.clientName}
        </h3>

        <div className="job-meta">
          {job.venue ? <span>{job.venue}</span> : null}
          {job.clientEmail ? <span>{job.clientEmail}</span> : null}
        </div>

        <div className="job-meta" style={{ marginTop: 7 }}>
          <span className={statusChipClass(job)}>{JOB_STATUS_LABELS[job.status]}</span>

          {/* Order matters. A green chip must never be able to show zero —
              "0 crew" in reassuring green is worse than no chip at all. */}
          {shortfall > 0 ? (
            <span className="chip urgent">Short {shortfall} crew</span>
          ) : job.crew.length === 0 ? (
            <span className="chip soon">No crew booked</span>
          ) : confirmed === 0 ? (
            <span className="chip soon">
              {job.crew.length} crew, none confirmed
            </span>
          ) : (
            <span className="chip ok">
              {confirmed} crew{job.crewRequired ? ` / ${job.crewRequired}` : ''} confirmed
            </span>
          )}

          {job.matchConfidence === 'low' ? (
            <span className="chip soon" title={job.matchReason}>
              Match unconfirmed
            </span>
          ) : null}
        </div>
      </div>

      <div className="job-side">
        <span className="money">{formatMoney(job.quoteTotal)}</span>

        {job.crew.length > 0 ? (
          <div className="crew-list">
            {job.crew.map((c) => (
              <span
                key={c.id + c.name}
                className={c.confirmed ? 'chip' : 'chip ghost'}
                title={
                  c.confirmed
                    ? `${c.name} — confirmed${c.role ? ` (${c.role})` : ''}`
                    : `${c.name} — not yet confirmed${c.role ? ` (${c.role})` : ''}`
                }
              >
                {c.name}
                {c.confirmed ? '' : ' ?'}
              </span>
            ))}
          </div>
        ) : null}

        {/* Which systems hold a record for this job. A gap here is usually
            the thing worth noticing. */}
        <div className="sources" title="Systems holding a record for this job">
          {ALL_SYSTEMS.map((sys) => {
            const src = job.sources.find((s) => s.system === sys);
            const label = `${SYSTEM_LABELS[sys]}: ${src ? 'has a record' : 'no record'}`;
            return src?.url ? (
              <a
                key={sys}
                className="src on"
                href={src.url}
                target="_blank"
                rel="noreferrer"
                title={`${label} — open in ${SYSTEM_LABELS[sys]}`}
              >
                {SOURCE_CODE[sys]}
              </a>
            ) : (
              <span key={sys} className={src ? 'src on' : 'src'} title={label}>
                {SOURCE_CODE[sys]}
              </span>
            );
          })}
        </div>
      </div>
    </article>
  );
}
