import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkflowTemplateList } from './WorkflowTemplateList';

const TEMPLATES = [
  { id: 'template-a', name: 'Standard Cremation Workflow', isEnabled: true, caseTypes: ['cremation'] },
  { id: 'template-b', name: 'Burial Workflow', isEnabled: false, caseTypes: ['burial'] },
];

describe('WorkflowTemplateList (Phase 18)', () => {
  it('shows an empty state when the organization has no templates', () => {
    render(<WorkflowTemplateList templates={[]} selectedTemplateId={null} onSelect={vi.fn()} />);
    expect(screen.getByText(/no workflow templates configured/i)).toBeInTheDocument();
  });

  it('renders every template with its name, case types, and enabled/disabled state', () => {
    render(<WorkflowTemplateList templates={TEMPLATES} selectedTemplateId={null} onSelect={vi.fn()} />);
    expect(screen.getByText('Standard Cremation Workflow')).toBeInTheDocument();
    // SOLIS Tasks/Calendar/Settings phase: case types and status are now
    // separate text/element nodes within one `.sx-cell-sub` row (status is
    // its own `.sx-status` span) — match across both with a function matcher.
    expect(screen.getByText((_, element) => element?.className === 'sx-cell-sub' && /cremation/.test(element.textContent ?? '') && /Enabled/.test(element.textContent ?? ''))).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.className === 'sx-cell-sub' && /burial/.test(element.textContent ?? '') && /Disabled/.test(element.textContent ?? ''))).toBeInTheDocument();
  });

  it('calls onSelect with the clicked template id', () => {
    const onSelect = vi.fn();
    render(<WorkflowTemplateList templates={TEMPLATES} selectedTemplateId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Burial Workflow'));
    expect(onSelect).toHaveBeenCalledWith('template-b');
  });

  it('does not hardcode any specific template name — renders whatever it is given', () => {
    const genericTemplates = [{ id: 'x', name: 'Whatever An Org Calls It', isEnabled: true, caseTypes: ['anything'] }];
    render(<WorkflowTemplateList templates={genericTemplates} selectedTemplateId={null} onSelect={vi.fn()} />);
    expect(screen.getByText('Whatever An Org Calls It')).toBeInTheDocument();
  });
});
