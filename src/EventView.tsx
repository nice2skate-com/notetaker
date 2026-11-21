import { eventFacts } from "./lib/export";
import type { EventBriefing } from "./lib/types";

/** The DJ's working sheet for an event: key facts, people, running order, music. */
export default function EventView({ e }: { e: EventBriefing }) {
  const facts = eventFacts(e);
  return (
    <section className="event">
      {!!facts.length && (
        <dl className="facts">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {!!e.contacts.length && (
        <>
          <h3>Ansprechpartner</h3>
          <ul className="plain">
            {e.contacts.map((c, i) => (
              <li key={i}>
                <strong>{c.name}</strong>
                {c.role && <span className="muted"> · {c.role}</span>}
                {c.contact && <div className="muted small">{c.contact}</div>}
              </li>
            ))}
          </ul>
        </>
      )}

      {!!e.timeline.length && (
        <>
          <h3>Ablauf</h3>
          <ol className="timeline">
            {e.timeline.map((t, i) => (
              <li key={i}>
                <span className="t">{t.time || "–"}</span>
                <span>{t.item}</span>
              </li>
            ))}
          </ol>
        </>
      )}

      {!!e.special_moments.length && (
        <>
          <h3>Besondere Momente</h3>
          <ul className="plain">
            {e.special_moments.map((t, i) => (
              <li key={i}>
                <span className="muted">{t.moment}</span>
                <div className={t.song ? "song" : "song open"}>{t.song || "Song noch offen"}</div>
              </li>
            ))}
          </ul>
        </>
      )}

      {e.music_style && (
        <>
          <h3>Musik &amp; Stimmung</h3>
          <p>{e.music_style}</p>
        </>
      )}

      {(!!e.must_play.length || !!e.do_not_play.length) && (
        <div className="two">
          {!!e.must_play.length && (
            <div>
              <h3>Musikwünsche</h3>
              <ul>{e.must_play.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </div>
          )}
          {!!e.do_not_play.length && (
            <div>
              <h3 className="nogo">No-Gos</h3>
              <ul>{e.do_not_play.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      {!!e.logistics.length && (
        <>
          <h3>Technik &amp; Organisation</h3>
          <ul>{e.logistics.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </>
      )}
    </section>
  );
}
