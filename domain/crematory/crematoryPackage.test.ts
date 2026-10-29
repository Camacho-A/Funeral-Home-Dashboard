import { describe, expect, it } from 'vitest';
import {
  assignAttachmentFileNames,
  crematoryEmailSubject,
  crematoryPackageFileName,
  legacyCrematoryPackageFileName,
  defaultCrematoryMessage,
  normalizePackageName,
  packageDisplayName,
  suggestPackageName,
  readyDateFromPackageFileName,
  toCaseDate,
} from './crematoryPackage';

describe('crematoryPackageFileName — LASTNAME_FIRSTNAME_CREMATORY_PACKAGE_MM-DD-YYYY.pdf', () => {
  it('uses the confirmed last and first name(s) exactly — middle names and multi-word surnames kept', () => {
    expect(crematoryPackageFileName({ first: 'Mary Ann', last: 'Smith' }, '11/06/2026')).toBe('SMITH_MARY ANN_CREMATORY_PACKAGE_11-06-2026.pdf');
    expect(crematoryPackageFileName({ first: 'Estela', last: 'Salas Rueda' }, '2026-11-06')).toBe('SALAS RUEDA_ESTELA_CREMATORY_PACKAGE_11-06-2026.pdf');
    expect(crematoryPackageFileName({ first: 'Richard', last: 'Reynolds' }, '11/06/2026')).toBe('REYNOLDS_RICHARD_CREMATORY_PACKAGE_11-06-2026.pdf');
    expect(crematoryPackageFileName({ first: 'Rosa', last: "O'Neil" }, '11/06/2026')).toBe("O'NEIL_ROSA_CREMATORY_PACKAGE_11-06-2026.pdf");
  });

  it('the requested example, and the pre-2026-10 name kept only to recognise packages already built', () => {
    expect(crematoryPackageFileName({ first: 'Hannelore', last: 'Willson' }, '10/30/2026')).toBe('WILLSON_HANNELORE_CREMATORY_PACKAGE_10-30-2026.pdf');
    expect(legacyCrematoryPackageFileName({ first: 'Hannelore', last: 'Willson' }, '10/30/2026')).toBe('Willson_Hannelore_10-30-2026.pdf');
    expect(readyDateFromPackageFileName('WILLSON_HANNELORE_CREMATORY_PACKAGE_10-30-2026.pdf')).toBe('10/30/2026');
    expect(readyDateFromPackageFileName('REYNOLDS_RICHARD_CREMATORY_PACKAGE_11-06-2026_B2026-043.pdf')).toBe('11/06/2026');
  });

  it('strips characters no file system accepts', () => {
    expect(crematoryPackageFileName({ first: 'Juniper', last: 'Fair/weather:"?' }, '11/06/2026')).toBe('FAIRWEATHER_JUNIPER_CREMATORY_PACKAGE_11-06-2026.pdf');
  });

  it('never names a package without a confirmed name or a real date', () => {
    expect(crematoryPackageFileName(null, '11/06/2026')).toBeNull();
    expect(crematoryPackageFileName({ first: 'Richard', last: '' }, '11/06/2026')).toBeNull();
    expect(crematoryPackageFileName({ first: 'Richard', last: 'Reynolds' }, null)).toBeNull();
    expect(crematoryPackageFileName({ first: 'Richard', last: 'Reynolds' }, '02/30/2026')).toBeNull();
  });

  it('reads the confirmed date back out of a package name', () => {
    expect(readyDateFromPackageFileName('Salas Rueda_Estela_01-05-2027.pdf')).toBe('01/05/2027');
    expect(readyDateFromPackageFileName('Reynolds_Richard_11-06-2026_B2026-043.pdf')).toBe('11/06/2026');
    expect(readyDateFromPackageFileName('Envelope.pdf')).toBeNull();
    expect(toCaseDate('2026-11-06')).toBe('11/06/2026');
  });
});

describe('package name — confirmed by staff, suggested only from the structured form name', () => {
  it('requires both parts and cleans them without changing what was typed', () => {
    expect(normalizePackageName({ first: '  Mary Ann ', last: 'Smith' })).toEqual({ first: 'Mary Ann', last: 'Smith' });
    expect(normalizePackageName({ first: 'Mary Ann', last: '' })).toEqual({ error: 'Enter the last name (surname) for the package.' });
    expect(normalizePackageName({ first: '', last: 'Smith' })).toEqual({ error: 'Enter the first name(s) for the package.' });
  });

  it('suggests from the form\'s first / middle / last boxes — the middle name joins the first', () => {
    expect(suggestPackageName({ first: 'MARY', middle: 'ANN', last: 'SMITH' })).toEqual({ first: 'Mary Ann', last: 'Smith' });
    expect(suggestPackageName({ first: 'ESTELA', middle: null, last: 'SALAS RUEDA' })).toEqual({ first: 'Estela', last: 'Salas Rueda' });
  });

  it('suggests nothing when the form did not give both a first and a last name', () => {
    expect(suggestPackageName({ first: 'MARY ANN SMITH', last: null })).toBeNull();
    expect(suggestPackageName({})).toBeNull();
  });

  it('the subject name is "First Last"', () => {
    expect(packageDisplayName({ first: 'Mary Ann', last: 'Smith' })).toBe('Mary Ann Smith');
  });
});

describe('assignAttachmentFileNames', () => {
  it('adds the case number only where two attachments would share a name', () => {
    const named = assignAttachmentFileNames([
      { fileName: 'Reynolds_Richard_11-06-2026.pdf', caseNumber: 'B2026-043' },
      { fileName: 'Reynolds_Richard_11-06-2026.pdf', caseNumber: 'B2026-051' },
      { fileName: 'Boone_Walter_11-06-2026.pdf', caseNumber: 'B2026-044' },
    ]);
    expect(named.map((n) => n.attachmentName)).toEqual([
      'Reynolds_Richard_11-06-2026_B2026-043.pdf',
      'Reynolds_Richard_11-06-2026_B2026-051.pdf',
      'Boone_Walter_11-06-2026.pdf',
    ]);
  });
});

describe('crematoryEmailSubject', () => {
  const c = (name: string, date: string) => ({ decedentDisplayName: name, expectedReadyDate: date });
  it('one case names the decedent and the date', () => {
    expect(crematoryEmailSubject('Manors Cremation', [c('Richard Reynolds', '11/06/2026')])).toBe('Manors Cremation — Richard Reynolds — Expected 11/06/2026');
  });
  it('several cases sharing a date name the count and the date', () => {
    const four = ['A B', 'C D', 'E F', 'G H'].map((n) => c(n, '11/06/2026'));
    expect(crematoryEmailSubject('Manors Cremation', four)).toBe('Manors Cremation — 4 Cases for Crematory — Expected 11/06/2026');
  });
  it('several cases with different dates never imply one date', () => {
    expect(crematoryEmailSubject('Manors Cremation', [c('A B', '11/06/2026'), c('C D', '11/07/2026')])).toBe('Manors Cremation — 2 Cases for Crematory');
  });
});

describe('defaultCrematoryMessage', () => {
  it('lists each attached decedent with their date and file', () => {
    const message = defaultCrematoryMessage('Manors Cremation', [{ decedentDisplayName: 'Richard Reynolds', expectedReadyDate: '11/06/2026', attachmentName: 'Reynolds_Richard_11-06-2026.pdf' }]);
    expect(message).toContain('- Richard Reynolds — expected 11/06/2026 (Reynolds_Richard_11-06-2026.pdf)');
    expect(message.endsWith('Manors Cremation')).toBe(true);
  });
});
