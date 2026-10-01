import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CaseListTabs, type CaseListTabDef } from './CaseListTabs';
import { STAGES } from '@/domain/cases/stages';

const TABS: CaseListTabDef[] = [
  { key: null, label: 'All Cases', count: 142 },
  ...STAGES.map((label, i) => ({ key: label, label, count: i })),
];

describe('CaseListTabs (Case list scalability, Phase 3)', () => {
  it('1. renders exactly 8 tabs', () => {
    render(<CaseListTabs tabs={TABS} activeTab={null} onSelectTab={vi.fn()} panelId="panel" />);
    expect(screen.getAllByRole('tab')).toHaveLength(8);
  });

  it('3. the seven stage tabs come from canonical STAGES, in order, plus "All Cases" first', () => {
    render(<CaseListTabs tabs={TABS} activeTab={null} onSelectTab={vi.fn()} panelId="panel" />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent?.replace(/\d+$/, '').trim())).toEqual(['All Cases', ...STAGES]);
  });

  it('marks the active tab as aria-selected and others as not', () => {
    render(<CaseListTabs tabs={TABS} activeTab="Completed" onSelectTab={vi.fn()} panelId="panel" />);
    expect(screen.getByRole('tab', { name: /Completed/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /All Cases/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('8. renders each tab\'s server-provided count', () => {
    render(<CaseListTabs tabs={TABS} activeTab={null} onSelectTab={vi.fn()} panelId="panel" />);
    expect(screen.getByRole('tab', { name: /All Cases/ }).textContent).toContain('142');
  });

  it('renders no count suffix while counts are still loading (count: null)', () => {
    const loadingTabs: CaseListTabDef[] = [{ key: null, label: 'All Cases', count: null }];
    render(<CaseListTabs tabs={loadingTabs} activeTab={null} onSelectTab={vi.fn()} panelId="panel" />);
    expect(screen.getByRole('tab', { name: 'All Cases' }).textContent).toBe('All Cases');
  });

  it('calls onSelectTab with the clicked tab\'s key', () => {
    const onSelectTab = vi.fn();
    render(<CaseListTabs tabs={TABS} activeTab={null} onSelectTab={onSelectTab} panelId="panel" />);
    screen.getByRole('tab', { name: /Completed/ }).click();
    expect(onSelectTab).toHaveBeenCalledWith('Completed');
  });

  it('every tab is aria-controls-linked to the shared panel id', () => {
    render(<CaseListTabs tabs={TABS} activeTab={null} onSelectTab={vi.fn()} panelId="case-list-panel" />);
    screen.getAllByRole('tab').forEach((tab) => {
      expect(tab).toHaveAttribute('aria-controls', 'case-list-panel');
    });
  });

  it('only the active tab is keyboard-focusable by default (roving tabindex)', () => {
    render(<CaseListTabs tabs={TABS} activeTab={null} onSelectTab={vi.fn()} panelId="panel" />);
    expect(screen.getByRole('tab', { name: /All Cases/ })).toHaveAttribute('tabIndex', '0');
    expect(screen.getByRole('tab', { name: /Completed/ })).toHaveAttribute('tabIndex', '-1');
  });

  it('ArrowRight moves selection to the next tab', () => {
    const onSelectTab = vi.fn();
    render(<CaseListTabs tabs={TABS} activeTab={null} onSelectTab={onSelectTab} panelId="panel" />);
    screen.getByRole('tab', { name: /All Cases/ }).focus();
    screen.getByRole('tab', { name: /All Cases/ }).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(onSelectTab).toHaveBeenCalledWith('First Call & Payment');
  });
});
