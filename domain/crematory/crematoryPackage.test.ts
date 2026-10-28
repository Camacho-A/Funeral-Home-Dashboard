import { describe, expect, it } from 'vitest';
import {
  assignAttachmentFileNames,
  crematoryEmailSubject,
  crematoryPackageFileName,
  defaultCrematoryMessage,
  packageNameParts,
  readyDateFromPackageFileName,
  toCaseDate,
} from './crematoryPackage';

describe('crematoryPackageFileName — LastName_FirstName_MM-DD-YYYY.pdf', () => {
  it('names the package after the decedent and the expected ready date', () => {
    expect(crematoryPackageFileName('RICHARD REYNOLDS', '11/06/2026')).toBe('Reynolds_Richard_11-06-2026.pdf');
    expect(crematoryPackageFileName('Richard Reynolds', '2026-11-06')).toBe('Reynolds_Richard_11-06-2026.pdf');
  });

  it('keeps multi-word surnames whole and mixed-case names as written', () => {
    expect(crematoryPackageFileName('ESTELA SALAS RUEDA', '01/05/2027')).toBe('Salas Rueda_Estela_01-05-2027.pdf');
    expect(crematoryPackageFileName('Juniper de la Cruz-Villanueva', '11/06/2026')).toBe('de la Cruz-Villanueva_Juniper_11-06-2026.pdf');
    expect(crematoryPackageFileName("ROSA O'NEIL", '11/06/2026')).toBe("O'neil_Rosa_11-06-2026.pdf");
  });

  it('strips characters no file system accepts', () => {
    expect(crematoryPackageFileName('JUNIPER FAIR/WEATHER:"?', '11/06/2026')).toBe('Fairweather_Juniper_11-06-2026.pdf');
  });

  it('never names a package without a real date or a name', () => {
    expect(crematoryPackageFileName('RICHARD REYNOLDS', null)).toBeNull();
    expect(crematoryPackageFileName('RICHARD REYNOLDS', '02/30/2026')).toBeNull();
    expect(crematoryPackageFileName('  ', '11/06/2026')).toBeNull();
    expect(packageNameParts('CHER')).toEqual({ first: 'Cher', last: '' });
    expect(crematoryPackageFileName('CHER', '11/06/2026')).toBe('Cher_11-06-2026.pdf');
  });

  it('reads the confirmed date back out of a package name', () => {
    expect(readyDateFromPackageFileName('Salas Rueda_Estela_01-05-2027.pdf')).toBe('01/05/2027');
    expect(readyDateFromPackageFileName('Reynolds_Richard_11-06-2026_B2026-043.pdf')).toBe('11/06/2026');
    expect(readyDateFromPackageFileName('Envelope.pdf')).toBeNull();
    expect(toCaseDate('2026-11-06')).toBe('11/06/2026');
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
