/**
 * Printing a saved Cremation Label without DYMO Connect (2026-11).
 *
 * Print used to appear only when DYMO Connect was running on the computer.
 * Without it, staff could only download the .dymo file. This draws the
 * SAVED label file itself as a page the browser can print: every object
 * (the logo, the Manors name and address, the decedent's name, Tag # and
 * date) at the position, size, font and alignment the file gives it. Nothing
 * is retyped or approximated from the case; it is the same file DYMO
 * Connect would print.
 *
 * The page is a 4" × 2-1/8" shipping label, the size the template is laid
 * out on. Staff pick the DYMO LabelWriter in the print window.
 */
export const LABEL_PAGE_WIDTH_IN = 4;
export const LABEL_PAGE_HEIGHT_IN = 2.125;

type Box = { x: number; y: number; width: number; height: number };
type Align = { horizontal: 'left' | 'center' | 'right'; vertical: 'top' | 'middle' | 'bottom' };

export type DymoLabelObject =
  | ({ kind: 'image'; dataBase64: string } & Box & Align)
  | ({ kind: 'text'; lines: { text: string; fontName: string; fontSizePt: number; bold: boolean; italic: boolean; underline: boolean }[] } & Box & Align);

function childText(parent: Element, tag: string): string | null {
  for (const child of Array.from(parent.children)) {
    if (child.tagName === tag) return child.textContent;
  }
  return null;
}

function directChild(parent: Element, tag: string): Element | null {
  return Array.from(parent.children).find((child) => child.tagName === tag) ?? null;
}

function readBox(object: Element): Box | null {
  const layout = directChild(object, 'ObjectLayout');
  const point = layout && directChild(layout, 'DYMOPoint');
  const size = layout && directChild(layout, 'Size');
  if (!point || !size) return null;
  const box = {
    x: Number(childText(point, 'X')),
    y: Number(childText(point, 'Y')),
    width: Number(childText(size, 'Width')),
    height: Number(childText(size, 'Height')),
  };
  return Object.values(box).every(Number.isFinite) ? box : null;
}

function readAlign(object: Element): Align {
  const h = (childText(object, 'HorizontalAlignment') ?? 'Left').toLowerCase();
  const v = (childText(object, 'VerticalAlignment') ?? 'Top').toLowerCase();
  return {
    horizontal: h === 'center' ? 'center' : h === 'right' ? 'right' : 'left',
    vertical: v === 'middle' ? 'middle' : v === 'bottom' ? 'bottom' : 'top',
  };
}

/** Every printable object in a saved .dymo label, in file order. Throws
    if the file is not a DYMO label at all. */
export function readDymoLabelObjects(labelXml: string): DymoLabelObject[] {
  const doc = new DOMParser().parseFromString(labelXml.replace(/^﻿/, ''), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0 || doc.getElementsByTagName('DYMOLabel').length === 0) {
    throw new Error('The saved label file could not be read.');
  }
  const objects: DymoLabelObject[] = [];
  const all = Array.from(doc.getElementsByTagName('LabelObjects')[0]?.children ?? []);
  for (const object of all) {
    const box = readBox(object);
    if (!box) continue;
    const align = readAlign(object);
    if (object.tagName === 'ImageObject') {
      const data = (childText(object, 'Data') ?? '').replace(/\s+/g, '');
      if (/^[A-Za-z0-9+/=]+$/.test(data)) objects.push({ kind: 'image', dataBase64: data, ...box, ...align });
    } else if (object.tagName === 'TextObject') {
      const lines = Array.from(object.getElementsByTagName('LineTextSpan')).map((line) => {
        const spans = Array.from(line.getElementsByTagName('TextSpan'));
        const font = spans[0]?.getElementsByTagName('FontInfo')[0];
        return {
          text: spans.map((span) => span.getElementsByTagName('Text')[0]?.textContent ?? '').join(''),
          fontName: (font && childText(font, 'FontName')) || 'Times New Roman',
          fontSizePt: Number((font && childText(font, 'FontSize')) || 12) || 12,
          bold: (font && childText(font, 'IsBold')) === 'True',
          italic: (font && childText(font, 'IsItalic')) === 'True',
          underline: (font && childText(font, 'IsUnderline')) === 'True',
        };
      });
      objects.push({ kind: 'text', lines, ...box, ...align });
    }
  }
  return objects;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const JUSTIFY = { top: 'flex-start', middle: 'center', bottom: 'flex-end' } as const;

/** A complete, self-contained page (no network requests) that prints the
    label at its real size. */
export function dymoLabelPrintHtml(labelXml: string, title: string): string {
  const objects = readDymoLabelObjects(labelXml).map((object) => {
    const position = `left:${object.x}in;top:${object.y}in;width:${object.width}in;height:${object.height}in;justify-content:${JUSTIFY[object.vertical]};text-align:${object.horizontal};align-items:${object.horizontal === 'center' ? 'center' : object.horizontal === 'right' ? 'flex-end' : 'flex-start'}`;
    if (object.kind === 'image') {
      return `<div class="o" style="${position}"><img alt="" src="data:image/png;base64,${object.dataBase64}"></div>`;
    }
    const lines = object.lines
      .map(
        (line) =>
          `<div style="font-family:${escapeHtml(JSON.stringify(line.fontName))}, serif;font-size:${line.fontSizePt}pt;font-weight:${line.bold ? 700 : 400};font-style:${line.italic ? 'italic' : 'normal'};text-decoration:${line.underline ? 'underline' : 'none'}">${escapeHtml(line.text) || '&nbsp;'}</div>`,
      )
      .join('');
    return `<div class="o" style="${position}">${lines}</div>`;
  });
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
@page { size: ${LABEL_PAGE_WIDTH_IN}in ${LABEL_PAGE_HEIGHT_IN}in; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; }
.label { position: relative; width: ${LABEL_PAGE_WIDTH_IN}in; height: ${LABEL_PAGE_HEIGHT_IN}in; overflow: hidden; }
.o { position: absolute; display: flex; flex-direction: column; overflow: hidden; line-height: 1.15; white-space: nowrap; }
.o img { max-width: 100%; max-height: 100%; object-fit: contain; }
</style></head><body><div class="label">${objects.join('')}</div></body></html>`;
}
