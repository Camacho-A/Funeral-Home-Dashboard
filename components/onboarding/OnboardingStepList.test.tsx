import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OnboardingStepList } from './OnboardingStepList';

describe('OnboardingStepList', () => {
  it('renders all nine steps in order', () => {
    render(<OnboardingStepList currentStep="organization_profile" completedSteps={[]} onSelectStep={() => {}} />);
    expect(screen.getByText('Organization Profile')).toBeInTheDocument();
    expect(screen.getByText('Review & Launch')).toBeInTheDocument();
  });

  it('marks completed steps with a checkmark and keeps them clickable', () => {
    render(<OnboardingStepList currentStep="administrator_account" completedSteps={['organization_profile', 'primary_location']} onSelectStep={() => {}} />);
    const button = screen.getByRole('button', { name: /Organization Profile/ });
    expect(button).not.toBeDisabled();
  });

  it('disables a step beyond the current one', () => {
    render(<OnboardingStepList currentStep="organization_profile" completedSteps={[]} onSelectStep={() => {}} />);
    const button = screen.getByRole('button', { name: /Review & Launch/ });
    expect(button).toBeDisabled();
  });

  it('calls onSelectStep with the clicked step\'s key', () => {
    const onSelectStep = vi.fn();
    render(<OnboardingStepList currentStep="primary_location" completedSteps={['organization_profile']} onSelectStep={onSelectStep} />);
    fireEvent.click(screen.getByRole('button', { name: /Organization Profile/ }));
    expect(onSelectStep).toHaveBeenCalledWith('organization_profile');
  });
});
