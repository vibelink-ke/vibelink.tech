import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

describe('Basic Test Setup', () => {
  it('should run successfully', () => {
    expect(1 + 1).toBe(2);
  });
  
  it('should render a basic element if React Testing Library is configured', () => {
    render(<div>Hello Test</div>);
    expect(screen.getByText('Hello Test')).toBeInTheDocument();
  });
});
