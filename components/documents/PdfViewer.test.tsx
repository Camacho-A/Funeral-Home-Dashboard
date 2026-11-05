import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * pdf.js stands in for a document of `pages` pages. Which page the viewer
 * asks for is the page it shows; the bytes it was given are recorded so the
 * test can prove the viewer never alters them.
 */
const pdf = vi.hoisted(() => ({ pages: 1, requested: [] as number[], given: [] as Uint8Array[] }));
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: ({ data }: { data: ArrayBuffer }) => {
    pdf.given.push(new Uint8Array(data));
    return {
      promise: Promise.resolve({
        numPages: pdf.pages,
        getPage: async (n: number) => {
          pdf.requested.push(n);
          return { getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }), render: () => ({ promise: Promise.resolve(), cancel: () => undefined }) };
        },
      }),
      destroy: async () => undefined,
    };
  },
}));
const { PdfViewer } = await import('./PdfViewer');

const BYTES = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10, 1, 2, 3, 4, 5]); // "%PDF-1.7\n" + body
const fetchMock = vi.fn(async () => new Response(BYTES.slice(0), { status: 200, headers: { 'Content-Type': 'application/pdf' } }));

/** Applications as the fax dialog labels them: Request n of N, each with its own page count. */
const requests = (pageCounts: number[]) => pageCounts.map((pageCount, i) => ({ label: `Request ${i + 1} of ${pageCounts.length} — Case ${i + 1} (B2026-${900 + i + 1})`, pageCount }));

beforeEach(() => {
  pdf.requested = [];
  pdf.given = [];
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

const prev = () => screen.getByRole('button', { name: /Previous page/ }) as HTMLButtonElement;
const next = () => screen.getByRole('button', { name: /Next page/ }) as HTMLButtonElement;
const shownPage = () => pdf.requested.at(-1);
/** Which request the viewer says this page belongs to — the Go to menu's choice, or the label for a lone request. */
const currentRequest = () => {
  const select = screen.queryByRole('combobox', { name: 'Go to' }) as HTMLSelectElement | null;
  return select ? select.selectedOptions[0].text : screen.getByText(/^Request /, { selector: 'p' }).textContent;
};

async function renderReview(pageCounts: number[]) {
  pdf.pages = pageCounts.reduce((a, b) => a + b, 0);
  render(<PdfViewer url="/api/fax-bundles/fxb-1/pdf?organizationId=org" fileName="DC-TEST01.pdf" variant="review" sections={requests(pageCounts)} />);
  await screen.findByText(`Page 1 of ${pdf.pages}`);
  await waitFor(() => expect(shownPage()).toBe(1));
}

/** Presses Next until the last page, checking every page on the way. */
async function walkForward(pageCounts: number[]) {
  const total = pdf.pages;
  const owner: number[] = pageCounts.flatMap((count, i) => Array.from({ length: count }, () => i + 1));
  for (let page = 1; page <= total; page++) {
    expect(screen.getByText(`Page ${page} of ${total}`)).toBeTruthy();
    await waitFor(() => expect(shownPage()).toBe(page));
    const request = owner[page - 1];
    expect(currentRequest()).toMatch(new RegExp(`^Request ${request} of ${pageCounts.length} — Case ${request} `));
    expect(prev().disabled).toBe(page === 1);
    expect(next().disabled).toBe(page === total);
    if (page < total) await act(async () => void fireEvent.click(next()));
  }
}

describe('PdfViewer — review variant (fax bundle preview)', () => {
  it('one application, one page: Page 1 of 1, both buttons disabled', async () => {
    await renderReview([1]);
    expect(screen.getByText(/^Request 1 of 1/, { selector: 'p' })).toBeTruthy();
    expect(prev().disabled).toBe(true);
    expect(next().disabled).toBe(true);
    // Nothing to jump between.
    expect(screen.queryByRole('combobox', { name: 'Go to' })).toBeNull();
  });

  it('two applications: Request 2 of 2 is reachable, and Previous returns to Request 1 of 2', async () => {
    await renderReview([1, 1]);
    await walkForward([1, 1]);
    expect(screen.getByText('Page 2 of 2')).toBeTruthy();
    await act(async () => void fireEvent.click(prev()));
    expect(screen.getByText('Page 1 of 2')).toBeTruthy();
    await waitFor(() => expect(shownPage()).toBe(1));
    expect(currentRequest()).toMatch(/^Request 1 of 2/);
    // A one-page request is named once, by the menu — no repeated label underneath.
    expect(screen.queryByText(/^Request /, { selector: 'p' })).toBeNull();
  });

  it('several applications, some with more than one page: every page reachable, labelled with its request and its own page', async () => {
    await renderReview([1, 3, 2]);
    await walkForward([1, 3, 2]);
    // Page 6 is the second page of Request 3.
    expect(screen.getByText(/^Request 3 of 3 — Case 3 \(B2026-903\) · its page 2 of 2$/, { selector: 'p' })).toBeTruthy();
  });

  it('Go to jumps to the first page of any request', async () => {
    await renderReview([1, 3, 2]);
    const select = screen.getByRole('combobox', { name: 'Go to' }) as HTMLSelectElement;
    expect([...select.options].map((o) => [o.value, o.text.split(' — ')[0]])).toEqual([['1', 'Request 1 of 3'], ['2', 'Request 2 of 3'], ['5', 'Request 3 of 3']]);
    await act(async () => void fireEvent.change(select, { target: { value: '5' } }));
    expect(screen.getByText('Page 5 of 6')).toBeTruthy();
    await waitFor(() => expect(shownPage()).toBe(5));
    await act(async () => void fireEvent.change(select, { target: { value: '2' } }));
    expect(screen.getByText('Page 2 of 6')).toBeTruthy();
  });

  it('the largest bundle — 20 applications — every page reachable both ways', async () => {
    const counts = Array.from({ length: 20 }, (_, i) => (i % 4 === 3 ? 2 : 1)); // 25 pages
    await renderReview(counts);
    await walkForward(counts);
    expect(screen.getByText('Page 25 of 25')).toBeTruthy();
    for (let page = 25; page > 1; page--) await act(async () => void fireEvent.click(prev()));
    expect(screen.getByText('Page 1 of 25')).toBeTruthy();
    expect(prev().disabled).toBe(true);
    expect((screen.getByRole('combobox', { name: 'Go to' }) as HTMLSelectElement).options).toHaveLength(20);
  });

  it('the PDF page number and the Request number are shown separately', async () => {
    await renderReview([2, 1]);
    await act(async () => void fireEvent.click(next()));
    // PDF page 2 is the second page of Request 1, not Request 2.
    expect(screen.getByText('Page 2 of 3')).toBeTruthy();
    expect(screen.getByText(/^Request 1 of 2 — .* · its page 2 of 2$/, { selector: 'p' })).toBeTruthy();
  });

  it('labels nothing when the requests do not account for exactly the PDF\'s pages — never a wrong label', async () => {
    pdf.pages = 3;
    render(<PdfViewer url="/x.pdf" fileName="DC-TEST01.pdf" variant="review" sections={requests([1, 1])} />);
    await screen.findByText('Page 1 of 3');
    expect(screen.queryByText(/^Request /)).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Go to' })).toBeNull();
    // The pages themselves are all still reachable.
    await act(async () => void fireEvent.click(next()));
    await act(async () => void fireEvent.click(next()));
    expect(screen.getByText('Page 3 of 3')).toBeTruthy();
    expect(next().disabled).toBe(true);
  });

  it('Whole page / Fit width only changes the view', async () => {
    await renderReview([1, 1]);
    const toggle = screen.getByRole('button', { name: 'Whole page' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await act(async () => void fireEvent.click(toggle));
    expect(screen.getByRole('button', { name: 'Fit width' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Page 1 of 2')).toBeTruthy();
  });

  it('shows the exact bytes the server stored: one fetch of the bundle URL, handed to pdf.js unchanged, however much it is paged', async () => {
    await renderReview([1, 2, 1]);
    await walkForward([1, 2, 1]);
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Whole page' })));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/fax-bundles/fxb-1/pdf?organizationId=org', { credentials: 'include' });
    expect(pdf.given).toHaveLength(1);
    expect([...pdf.given[0]]).toEqual([...BYTES]);
  });
});

describe('PdfViewer — compact variant (every other caller) is unchanged', () => {
  it('pager below the page, "Previous" / "Next", hidden for a single page', async () => {
    pdf.pages = 1;
    const { unmount } = render(<PdfViewer url="/x.pdf" fileName="one.pdf" />);
    await waitFor(() => expect(shownPage()).toBe(1));
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    unmount();

    pdf.pages = 2;
    render(<PdfViewer url="/x.pdf" fileName="two.pdf" />);
    await screen.findByText('Page 1 of 2');
    expect(screen.queryByRole('toolbar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Page 2 of 2')).toBeTruthy();
  });
});
