import { describe, expect, it } from 'vitest';
import { escapeCsvField, buildCsv, EXPORT_ROW_CAP } from './csvExport';

describe('escapeCsvField', () => {
  it('leaves a plain value unquoted', () => {
    expect(escapeCsvField('plain value')).toBe('plain value');
  });

  it('quotes and doubles embedded quotes when the value contains a comma, quote, or newline', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('buildCsv', () => {
  it('builds a header row plus one row per item, joined by newline', () => {
    const rows = [
      { name: 'Alice', amount: 100 },
      { name: 'Bob', amount: 200 },
    ];
    const csv = buildCsv(rows, [
      { header: 'name', value: (r) => r.name },
      { header: 'amount', value: (r) => String(r.amount) },
    ]);
    expect(csv).toBe('name,amount\nAlice,100\nBob,200');
  });

  it('escapes fields that need it', () => {
    const csv = buildCsv([{ text: 'has, a comma' }], [{ header: 'text', value: (r) => r.text }]);
    expect(csv).toBe('text\n"has, a comma"');
  });

  it('returns just the header row for an empty array', () => {
    const csv = buildCsv([], [{ header: 'name', value: () => '' }]);
    expect(csv).toBe('name');
  });
});

describe('EXPORT_ROW_CAP', () => {
  it('is 10,000 — every exporter in this codebase shares this bound', () => {
    expect(EXPORT_ROW_CAP).toBe(10_000);
  });
});
