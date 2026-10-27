/**
 * Print Label (2026-10). Talks to DYMO Connect's web service on the staff
 * member's own computer — the same local service DYMO's JavaScript SDK
 * uses, called directly so no third-party script is loaded. A browser
 * cannot print a .dymo label by itself: DYMO Connect for Desktop (which
 * installs the web service) must be installed and running, with a DYMO
 * LabelWriter attached. Nothing here reaches any server but 127.0.0.1.
 */
const SERVICE_PORTS = [41951, 41952, 41953, 41954, 41955];
const SERVICE_PATH = '/DYMO/DLS/Printing';

export type DymoPrinter = { name: string; isConnected: boolean };

export class DymoUnavailableError extends Error {
  constructor() {
    super('DYMO Connect is not running on this computer. Open DYMO Connect (or its Web Service), then try again — or download the label instead.');
    this.name = 'DymoUnavailableError';
  }
}

async function call(base: string, endpoint: string, form?: Record<string, string>): Promise<string> {
  const response = await fetch(`${base}${SERVICE_PATH}/${endpoint}`, form ? { method: 'POST', body: new URLSearchParams(form) } : undefined);
  const text = await response.text();
  if (!response.ok) throw new Error(`DYMO Connect could not ${endpoint === 'PrintLabel' ? 'print' : 'read'} the label (${text.trim() || response.status}).`);
  // Some responses are JSON-quoted strings, some are bare.
  return text.startsWith('"') ? (JSON.parse(text) as string) : text;
}

/** The address of the running web service, trying DYMO's ports in order. */
export async function findDymoService(): Promise<string> {
  for (const port of SERVICE_PORTS) {
    const base = `https://127.0.0.1:${port}`;
    try {
      if ((await call(base, 'StatusConnected')).trim() === 'true') return base;
    } catch {
      // Not on this port; try the next one.
    }
  }
  throw new DymoUnavailableError();
}

export async function listDymoPrinters(base: string): Promise<DymoPrinter[]> {
  const xml = await call(base, 'GetPrinters');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return Array.from(doc.querySelectorAll('LabelWriterPrinter')).map((printer) => ({
    name: printer.querySelector('Name')?.textContent ?? '',
    isConnected: printer.querySelector('IsConnected')?.textContent === 'True',
  })).filter((printer) => printer.name !== '');
}

/** A PNG (data URL) of the label exactly as DYMO Connect will print it. */
export async function renderDymoPreview(base: string, labelXml: string): Promise<string> {
  const png = await call(base, 'RenderLabel', { printerName: '', renderParamsXml: '', labelXml });
  return `data:image/png;base64,${png.trim()}`;
}

export async function printDymoLabel(base: string, printerName: string, labelXml: string): Promise<void> {
  const result = await call(base, 'PrintLabel', { printerName, printParamsXml: '', labelXml, labelSetXml: '' });
  if (result.trim() !== 'true') throw new Error('DYMO Connect did not confirm the label was printed.');
}
