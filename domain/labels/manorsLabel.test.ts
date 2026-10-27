import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { MANORS_LABEL_TEMPLATE_XML } from './manorsLabelTemplate.generated';
import { MANORS_LABEL_SAMPLE_TEXT, fillManorsLabel, formatLabelDate, manorsLabelFileBytes, manorsLabelValuesFor, manorsLabelXmlFromFile, readManorsLabelValues } from './manorsLabel';

/**
 * Print Label (2026-10). The filled label must be the approved template
 * with exactly three text values changed — compared object by object and
 * line by line, with fictional names only.
 */
const TEMPLATE_PATH = path.join(__dirname, 'templates', 'manors-label.dymo');
const APPROVED_SHA256 = '437d792098ef64228442e9a92d0ee4d9776481f8941a8a7f85eb68db595cf668';

const parse = (xml: string) => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  return doc;
};

/** Every label object with everything about it except its text. */
function objectsWithoutText(xml: string) {
  const doc = parse(xml);
  return Array.from(doc.querySelector('LabelObjects')!.children).map((object) => {
    const copy = object.cloneNode(true) as Element;
    copy.querySelectorAll('Text').forEach((text) => (text.textContent = ''));
    return { tag: object.tagName, xml: new XMLSerializer().serializeToString(copy) };
  });
}

const texts = (xml: string) => Array.from(parse(xml).querySelectorAll('Text')).map((t) => t.textContent);

const fictional = { name: 'Juniper Q. Fairweather', tag: 'Tag #90210', date: 'November 3, 2026' };

describe('the approved template', () => {
  it('is the unchanged master file, and the embedded copy matches it exactly', () => {
    const file = readFileSync(TEMPLATE_PATH);
    expect(createHash('sha256').update(file).digest('hex')).toBe(APPROVED_SHA256);
    expect(MANORS_LABEL_TEMPLATE_XML).toBe(file.toString('utf8').replace(/^﻿/, ''));
  });

  it('holds each sample value exactly once, in its own text object', () => {
    expect(texts(MANORS_LABEL_TEMPLATE_XML)).toEqual([
      'Manors Cremation',
      '481 E. Commercial Blvd.',
      'Oakland Park, FL 33334',
      '954-884-5770',
      MANORS_LABEL_SAMPLE_TEXT.name,
      MANORS_LABEL_SAMPLE_TEXT.tag,
      MANORS_LABEL_SAMPLE_TEXT.date,
    ]);
  });
});

describe('fillManorsLabel', () => {
  it('changes only the name, tag and date text; every object, font, size and position is identical', () => {
    const filled = fillManorsLabel(fictional);
    expect(objectsWithoutText(filled)).toEqual(objectsWithoutText(MANORS_LABEL_TEMPLATE_XML));
    expect(texts(filled)).toEqual(['Manors Cremation', '481 E. Commercial Blvd.', 'Oakland Park, FL 33334', '954-884-5770', fictional.name, fictional.tag, fictional.date]);

    const before = MANORS_LABEL_TEMPLATE_XML.split('\n');
    const after = filled.split('\n');
    expect(after).toHaveLength(before.length);
    const changed = before.flatMap((line, i) => (line === after[i] ? [] : [[line.trim(), after[i].trim()]]));
    expect(changed).toEqual([
      ['<Text>Richard Lewis Reynolds</Text>', '<Text>Juniper Q. Fairweather</Text>'],
      ['<Text>Tag #44471</Text>', '<Text>Tag #90210</Text>'],
      ['<Text>October 24, 2026</Text>', '<Text>November 3, 2026</Text>'],
    ]);
  });

  it('leaves the template\'s own fit settings alone — the name box auto-fits, the tag/date box does not', () => {
    const fitModes = (xml: string) => Array.from(parse(xml).querySelectorAll('TextObject > FitMode')).map((f) => f.textContent);
    const long = fillManorsLabel({ ...fictional, name: 'Maximiliana Esperanza Guadalupe de la Cruz-Villanueva y Montenegro' });
    expect(fitModes(long)).toEqual(['AlwaysFit', 'AlwaysFit', 'AlwaysFit', 'None']);
    expect(fitModes(long)).toEqual(fitModes(MANORS_LABEL_TEMPLATE_XML));
    const sizes = (xml: string) => Array.from(parse(xml).querySelectorAll('FontSize')).map((f) => f.textContent);
    expect(sizes(long)).toEqual(sizes(MANORS_LABEL_TEMPLATE_XML));
  });

  it('escapes names with XML characters so the file stays valid', () => {
    const filled = fillManorsLabel({ ...fictional, name: "Rosa <Test> O'Neil & Sons" });
    expect(texts(filled)[4]).toBe("Rosa <Test> O'Neil & Sons");
  });

  it('a value that happens to equal another sample is still placed in its own spot', () => {
    const filled = fillManorsLabel({ name: 'Tag #44471', tag: 'Tag #1', date: 'October 24, 2026' });
    expect(texts(filled).slice(4)).toEqual(['Tag #44471', 'Tag #1', 'October 24, 2026']);
  });

  it('refuses a template that no longer holds a sample value exactly once', () => {
    expect(() => fillManorsLabel(fictional, MANORS_LABEL_TEMPLATE_XML.replace('Tag #44471', 'Tag #1'))).toThrow(/Tag #44471/);
  });

  it('never alters the template it was given', () => {
    const copy = MANORS_LABEL_TEMPLATE_XML;
    fillManorsLabel(fictional);
    expect(MANORS_LABEL_TEMPLATE_XML).toBe(copy);
    expect(readFileSync(TEMPLATE_PATH).toString('utf8').replace(/^﻿/, '')).toBe(MANORS_LABEL_TEMPLATE_XML);
  });
});

describe('formatLabelDate', () => {
  it('uses the template\'s Month D, YYYY format', () => {
    expect(formatLabelDate('10/24/2026')).toBe('October 24, 2026');
    expect(formatLabelDate('11/03/2026')).toBe('November 3, 2026');
  });

  it('gives null for anything that is not a real date', () => {
    for (const value of [null, undefined, '', '2026-10-24', '02/30/2026', '13/01/2026', '10/24/26']) expect(formatLabelDate(value)).toBeNull();
  });
});

describe('manorsLabelValuesFor', () => {
  const base = { decedentName: 'JUNIPER FAIRWEATHER', decedentMiddleName: 'QUINN', tagNumber: '90210', dateOfCremation: '11/03/2026' };

  it('builds the full name (middle name included), "Tag #" + tag, and the date', () => {
    expect(manorsLabelValuesFor(base)).toEqual({ ok: true, values: { name: 'Juniper Quinn Fairweather', tag: 'Tag #90210', date: 'November 3, 2026' } });
  });

  it('keeps a name already written in mixed case, and does not double a "#" on the tag', () => {
    const result = manorsLabelValuesFor({ ...base, decedentName: 'Juniper McAllister', decedentMiddleName: null, tagNumber: '#90210' });
    expect(result).toEqual({ ok: true, values: { name: 'Juniper McAllister', tag: 'Tag #90210', date: 'November 3, 2026' } });
  });

  it('refuses with a clear message naming every missing value', () => {
    expect(manorsLabelValuesFor({ ...base, dateOfCremation: null })).toEqual({
      ok: false,
      missing: ['date'],
      message: "Can't print the label yet. Add the Date of Cremation to this case first.",
    });
    const all = manorsLabelValuesFor({ decedentName: ' ', decedentMiddleName: null, tagNumber: '  ', dateOfCremation: '02/30/2026' });
    expect(all).toMatchObject({ ok: false, missing: ['name', 'tag', 'date'], message: "Can't print the label yet. Add the Decedent name, Tag # and Date of Cremation to this case first." });
  });
});

describe('the saved .dymo file', () => {
  it('keeps the template file\'s byte-order mark, and reads back to the exact label and its values', () => {
    const xml = fillManorsLabel({ ...fictional, name: 'Rosa & Juniper <Q>' });
    const bytes = manorsLabelFileBytes(xml);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(manorsLabelXmlFromFile(bytes)).toBe(xml);
    expect(readManorsLabelValues(manorsLabelXmlFromFile(bytes))).toEqual({ ...fictional, name: 'Rosa & Juniper <Q>' });
  });

  it('reads nothing from a file that is not a filled copy of this template', () => {
    expect(readManorsLabelValues('<DesktopLabel><Text>only one</Text></DesktopLabel>')).toBeNull();
  });
});
