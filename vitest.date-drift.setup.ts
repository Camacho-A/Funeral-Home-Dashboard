import { vi } from 'vitest';

/**
 * Date-drift regression run (2026-10): every test again, with "today" moved
 * DATE_DRIFT_DAYS (default 365) into the future. The calendar suite was
 * written against the real date and began failing on 2026-10-17, the day
 * the real date passed one of its fixtures; this catches that class of test
 * before the calendar does. Only Date is faked, so timers behave normally;
 * a test that pins its own clock still wins.
 */
const days = Number(process.env.DATE_DRIFT_DAYS ?? '365');
vi.useFakeTimers({ toFake: ['Date'], now: new Date(Date.now() + days * 86_400_000) });
