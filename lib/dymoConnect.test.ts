import { afterEach, describe, expect, it, vi } from 'vitest';
import { DymoUnavailableError, findDymoService, listDymoPrinters, printDymoLabel, renderDymoPreview } from './dymoConnect';

/** Print Label (2026-10). The DYMO Connect web service, faked. */
afterEach(() => vi.unstubAllGlobals());

const PRINTERS =
  '<Printers><LabelWriterPrinter><Name>DYMO LabelWriter 550</Name><IsConnected>True</IsConnected></LabelWriterPrinter>' +
  '<LabelWriterPrinter><Name>Back Office LW</Name><IsConnected>False</IsConnected></LabelWriterPrinter></Printers>';

describe('dymoConnect', () => {
  it('finds the service on the first port that answers, only ever on 127.0.0.1', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.startsWith('https://127.0.0.1:41953/')) return new Response('true');
      throw new TypeError('connection refused');
    });
    vi.stubGlobal('fetch', fetch);
    expect(await findDymoService()).toBe('https://127.0.0.1:41953');
    expect(fetch.mock.calls.every(([url]) => String(url).startsWith('https://127.0.0.1:'))).toBe(true);
  });

  it('says DYMO Connect is not running when no port answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('connection refused'); }));
    await expect(findDymoService()).rejects.toBeInstanceOf(DymoUnavailableError);
  });

  it('lists printers with their connection state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(PRINTERS)));
    expect(await listDymoPrinters('https://127.0.0.1:41951')).toEqual([
      { name: 'DYMO LabelWriter 550', isConnected: true },
      { name: 'Back Office LW', isConnected: false },
    ]);
  });

  it('prints the label XML unchanged to the chosen printer', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response('true'));
    vi.stubGlobal('fetch', fetch);
    await printDymoLabel('https://127.0.0.1:41951', 'DYMO LabelWriter 550', '<DesktopLabel>x &amp; y</DesktopLabel>');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://127.0.0.1:41951/DYMO/DLS/Printing/PrintLabel');
    const form = init!.body as URLSearchParams;
    expect(form.get('printerName')).toBe('DYMO LabelWriter 550');
    expect(form.get('labelXml')).toBe('<DesktopLabel>x &amp; y</DesktopLabel>');
  });

  it('reports a print the service did not confirm, and a refused label', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('false')));
    await expect(printDymoLabel('https://127.0.0.1:41951', 'P', '<x/>')).rejects.toThrow('did not confirm');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Xml_InvalidRootData, 1, 1', { status: 500 })));
    await expect(printDymoLabel('https://127.0.0.1:41951', 'P', '<x/>')).rejects.toThrow('could not print the label (Xml_InvalidRootData, 1, 1)');
  });

  it('turns the rendered preview (JSON-quoted base64) into an image URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('"iVBORw0KGgo="')));
    expect(await renderDymoPreview('https://127.0.0.1:41951', '<x/>')).toBe('data:image/png;base64,iVBORw0KGgo=');
  });
});
