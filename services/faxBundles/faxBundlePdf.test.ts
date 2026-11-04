// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } from 'pdf-lib';
import { buildManateeApplicationPdf } from '../manateeApplicationTemplate';
import { buildManateeTemplateFixture } from '../__mocks__/manateeTemplateFixture';
import { REQUEST_BOXES, RequestBoxError, buildFaxBundlePdf, inspectApplication } from './faxBundlePdf';
import { differingPixelsOutside, renderPdfPage } from '@/lib/testing/renderPdfPage';

/**
 * The bundle PDF looks exactly like the saved applications everywhere
 * except inside the two "Request ___ of ___" boxes — checked by rendering
 * both and comparing every pixel. Fictional values on a stand-in form with
 * the real form's Request box positions (the real, signed form was
 * verified the same way outside the repository).
 */
const values = (first: string, request: [string, string] = ['', '']) => ({
  decedentFirst: first, decedentMiddle: 'Louise', decedentLast: 'Testcase', decedentSex: 'F' as const, ssn: '000123456', ssnNotKnown: false,
  dateOfDeath: '10/04/2026', placeOfDeathCity: 'Pembroke Pines', placeOfDeathCounty: 'Broward', spouseFirst: 'Jonathan', spouseMiddle: '', spouseLast: 'Testcase',
  representedName: 'Teresa Testcase', representedRelationship: 'Daughter', withCause: 2, withoutCause: 3, fedexFee: true, requestNumber: request[0], requestOf: request[1],
});

describe('fax bundle PDF', () => {
  it('pages are unscaled and uncropped, and nothing outside the Request boxes changes (pixel comparison)', async () => {
    const template = await buildManateeTemplateFixture();
    const saved = [await buildManateeApplicationPdf(template, values('Alpha')), await buildManateeApplicationPdf(template, values('Bravo', ['7', '9'])), await buildManateeApplicationPdf(template, values('Charlie'))];
    const bundle = await buildFaxBundlePdf(saved.map((bytes) => ({ bytes })));
    expect(bundle.applications.map((a) => a.numbering)).toEqual(['filled_blank', 'replaced_existing', 'filled_blank']);
    const doc = await PDFDocument.load(bundle.bytes);
    for (const [i, original] of saved.entries()) {
      const source = (await PDFDocument.load(original)).getPages()[0];
      const page = doc.getPages()[i];
      expect(page.getSize()).toEqual(source.getSize());
      expect(page.getMediaBox()).toEqual(source.getMediaBox());
      expect(page.getCropBox()).toEqual(source.getCropBox());
      const [before, after] = [await renderPdfPage(original, 1), await renderPdfPage(bundle.bytes, i + 1)];
      expect(differingPixelsOutside(before, after, REQUEST_BOXES, 792)).toBe(0);
      // …and inside the boxes something was actually written.
      expect(differingPixelsOutside(before, after, [], 792)).toBeGreaterThan(0);
    }
  }, 30_000);

  it('the saved application\'s bytes are never modified', async () => {
    const template = await buildManateeTemplateFixture();
    const saved = await buildManateeApplicationPdf(template, values('Alpha', ['3', '4']));
    const copy = new Uint8Array(saved);
    await buildFaxBundlePdf([{ bytes: saved }]);
    expect(Buffer.from(saved).equals(Buffer.from(copy))).toBe(true);
  });

  it('refuses rather than guesses: an unflattened form, a page without the boxes, and two drawings at one box', async () => {
    const template = await buildManateeTemplateFixture();
    // Not saved (still a fillable form).
    await expect(inspectApplication(await buildManateeApplicationPdf(template, values('Alpha'), { flatten: false }))).rejects.toBeInstanceOf(RequestBoxError);
    // Some other PDF.
    const other = await PDFDocument.create();
    other.addPage([612, 792]).drawText('Not an application', { x: 72, y: 700, size: 12 });
    await expect(inspectApplication(await other.save())).rejects.toThrow(/"Request ___ of ___" boxes could not be/);
    // A second, different drawing placed exactly at the first box: ambiguous — refused.
    const saved = await PDFDocument.load(await buildManateeApplicationPdf(template, values('Alpha', ['1', '2'])));
    const page = saved.getPages()[0];
    const xobjects = page.node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
    // The drawing placed at the first box, found the way SOLIS finds it.
    const contents = page.node.Contents()!;
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => saved.context.lookup(r) as PDFRawStream) : [contents as PDFRawStream];
    const text = streams.map((st) => Buffer.from(decodePDFRawStream(st).decode()).toString('latin1')).join('\n');
    const name = new RegExp(String.raw`1 0 0 1 ${REQUEST_BOXES[0].x} ${REQUEST_BOXES[0].y} cm\s+(?:1 0 0 1 0 0 cm\s+)*/(\S+) Do`).exec(text)![1];
    const duplicate = (xobjects.lookup(PDFName.of(name)) as PDFRawStream).clone(saved.context);
    xobjects.set(PDFName.of('Duplicate'), saved.context.register(duplicate));
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, 1, REQUEST_BOXES[0].x, REQUEST_BOXES[0].y), drawObject('Duplicate'), popGraphicsState());
    await expect(inspectApplication(await saved.save())).rejects.toThrow(/could not be identified exactly/);
  });
});
