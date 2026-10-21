'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrganization } from '@/hooks/useOrganization';
import type { SlaSettings, SlaTargets } from '@/domain/sla/slaSettings';

/**
 * SLA settings (2026-10) — Settings → SLA Targets. Administrators edit the
 * organization's business-day targets, cutoff times, holidays, crematory
 * return days and alerts. The server validates every value
 * (domain/sla/slaSettings.ts); the dashboard, case header and alerts all
 * read the saved settings, so one change applies everywhere.
 */
async function fetchSettings(organizationId: string): Promise<SlaSettings> {
  const response = await fetch(`/api/organization/sla-settings?organizationId=${encodeURIComponent(organizationId)}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? 'Could not load SLA settings.');
  return body.settings as SlaSettings;
}

async function saveSettings(organizationId: string, settings: SlaSettings): Promise<SlaSettings> {
  const response = await fetch('/api/organization/sla-settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, settings }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? 'Could not save SLA settings.');
  return body.settings as SlaSettings;
}

const TARGET_FIELDS: Array<{ key: keyof SlaTargets; label: string; help: string }> = [
  { key: 'edrsEntry', label: 'Case received → EDRS entry', help: 'Business days.' },
  { key: 'doctorAttestation', label: 'EDRS submitted → doctor attestation', help: 'Business days.' },
  { key: 'hardSave', label: 'Attestation received → Hard Save', help: '0 = the same business day.' },
  { key: 'approval', label: 'Submitted → state approval', help: 'Business days.' },
  { key: 'crematoryTurnaround', label: 'Crematory receipt → cremains ready', help: 'Business days.' },
  { key: 'familyPickup', label: 'Cremains ready → family pickup', help: 'Business days. A reminder only.' },
];

const WEEKDAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

export function SlaSettingsPanel() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['sla-settings', organizationId], queryFn: () => fetchSettings(organizationId) });
  const [draft, setDraft] = useState<SlaSettings | null>(null);
  const [holidaysText, setHolidaysText] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (query.data) {
      setDraft(query.data);
      setHolidaysText(query.data.holidays.join('\n'));
    }
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: (settings: SlaSettings) => saveSettings(organizationId, settings),
    onSuccess: (settings) => {
      queryClient.setQueryData(['sla-settings', organizationId], settings);
      void queryClient.invalidateQueries({ queryKey: ['organization', organizationId] });
      setSaved(true);
    },
  });

  if (query.isPending) return <p className="sx-help">Loading SLA settings…</p>;
  if (query.isError || !draft) return <div className="sx-error-state" role="alert">{(query.error as Error | null)?.message ?? 'Could not load SLA settings.'}</div>;

  const update = (next: Partial<SlaSettings>) => {
    setSaved(false);
    setDraft({ ...draft, ...next });
  };

  function submit() {
    const holidays = holidaysText
      .split(/[\n,]+/)
      .map((line) => line.trim())
      .filter(Boolean);
    mutation.mutate({ ...draft!, holidays });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <section className="sx-settings-section">
        <h3 className="sx-settings-section-title">Targets</h3>
        <p className="sx-help">Business days, Monday to Friday, in {draft.timezone}. Weekends and the holidays below never count.</p>
        <div className="sx-form-grid sx-form-grid-3" style={{ marginTop: 12 }}>
          {TARGET_FIELDS.map((field) => (
            <div className="sx-field" key={field.key}>
              <label className="sx-label" htmlFor={`sla-${field.key}`}>
                {field.label}
              </label>
              <input
                id={`sla-${field.key}`}
                className="sx-input"
                type="number"
                min={0}
                max={field.key === 'familyPickup' ? 60 : 30}
                value={draft.targets[field.key]}
                onChange={(event) => update({ targets: { ...draft.targets, [field.key]: Number(event.target.value) } })}
              />
              <span className="sx-help">{field.help}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="sx-settings-section">
        <h3 className="sx-settings-section-title">Business hours</h3>
        <div className="sx-form-grid sx-form-grid-3" style={{ marginTop: 12 }}>
          <div className="sx-field">
            <label className="sx-label" htmlFor="sla-closing">
              Closing time
            </label>
            <input id="sla-closing" className="sx-input" type="time" value={draft.closingTime} onChange={(event) => update({ closingTime: event.target.value })} />
            <span className="sx-help">A deadline is this time on its due date.</span>
          </div>
          <div className="sx-field">
            <label className="sx-label" htmlFor="sla-cutoff">
              After-hours cutoff
            </label>
            <input id="sla-cutoff" className="sx-input" type="time" value={draft.afterHoursCutoff} onChange={(event) => update({ afterHoursCutoff: event.target.value })} />
            <span className="sx-help">Anything received at or after this time counts from the next business day.</span>
          </div>
          <div className="sx-field">
            <label className="sx-label" htmlFor="sla-due-soon">
              &ldquo;Due soon&rdquo; within
            </label>
            <input
              id="sla-due-soon"
              className="sx-input"
              type="number"
              min={0}
              max={10}
              value={draft.dueSoonBusinessDays}
              onChange={(event) => update({ dueSoonBusinessDays: Number(event.target.value) })}
            />
            <span className="sx-help">Business days before the deadline.</span>
          </div>
        </div>
        <div className="sx-field" style={{ marginTop: 14 }}>
          <label className="sx-label" htmlFor="sla-holidays">
            Holidays
          </label>
          <textarea
            id="sla-holidays"
            className="sx-textarea"
            style={{ height: 96, padding: 8 }}
            value={holidaysText}
            placeholder={'One date per line, e.g. 2026-11-26'}
            onChange={(event) => {
              setSaved(false);
              setHolidaysText(event.target.value);
            }}
          />
          <span className="sx-help">Dates the business is closed. They are skipped in every deadline.</span>
        </div>
      </section>

      <section className="sx-settings-section">
        <h3 className="sx-settings-section-title">Crematory schedule</h3>
        <p className="sx-help">If the crematory returns cremains only on certain days, choose them; the turnaround deadline moves to the next return day. Leave all unchecked for any business day.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 10 }}>
          {WEEKDAYS.map((day) => (
            <label key={day.value} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13.5 }}>
              <input
                type="checkbox"
                checked={draft.crematoryReturnWeekdays.includes(day.value)}
                onChange={(event) =>
                  update({
                    crematoryReturnWeekdays: event.target.checked
                      ? [...draft.crematoryReturnWeekdays, day.value].sort()
                      : draft.crematoryReturnWeekdays.filter((value) => value !== day.value),
                  })
                }
              />
              {day.label}
            </label>
          ))}
        </div>
      </section>

      <section className="sx-settings-section">
        <h3 className="sx-settings-section-title">Alerts</h3>
        <p className="sx-help">Alerts go to staff only. SOLIS never contacts families, doctors or crematories.</p>
        <div className="sx-form-grid" style={{ marginTop: 10, maxWidth: 420 }}>
          {[0, 1].map((slot) => (
            <div className="sx-field" key={slot}>
              <label className="sx-label" htmlFor={`sla-alert-time-${slot}`}>
                {slot === 0 ? 'Morning check' : 'Afternoon check'}
              </label>
              <input
                id={`sla-alert-time-${slot}`}
                className="sx-input"
                type="time"
                value={draft.alertTimes[slot] ?? ''}
                onChange={(event) => {
                  const times = [...draft.alertTimes];
                  times[slot] = event.target.value;
                  update({ alertTimes: times.filter(Boolean) });
                }}
              />
            </div>
          ))}
        </div>
        <span className="sx-help">Deadline alerts are checked at these times on business days.</span>
        {(
          [
            ['approaching', 'Staff deadlines due soon or due today'],
            ['overdue', 'Staff deadlines overdue'],
            ['external', 'A doctor, the state or the crematory past its target'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 13.5 }}>
            <input type="checkbox" checked={draft.notifications[key]} onChange={(event) => update({ notifications: { ...draft.notifications, [key]: event.target.checked } })} />
            {label}
          </label>
        ))}
      </section>

      {mutation.isError && (
        <div className="sx-error-state" role="alert" style={{ marginTop: 12 }}>
          {(mutation.error as Error).message}
        </div>
      )}
      {saved && !mutation.isPending && (
        <p className="sx-help" role="status" style={{ color: 'var(--sx-green-text)', marginTop: 12 }}>
          SLA settings saved.
        </p>
      )}
      <div style={{ marginTop: 16 }}>
        <button type="submit" className="sx-btn sx-btn-primary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Save SLA settings'}
        </button>
      </div>
    </form>
  );
}
