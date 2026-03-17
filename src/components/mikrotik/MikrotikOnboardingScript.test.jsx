import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MikrotikOnboardingScript from './MikrotikOnboardingScript';

// Mock vibelinkClient
vi.mock('@/api/vibelinkClient', () => ({
  vibelink: {
    entities: {
      Mikrotik: {
        create: vi.fn(() => Promise.resolve({ id: 'test-id' })),
      }
    }
  }
}));

// Setup query client for tests
const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
});

// Since Radix UI Dialog uses PointerEvent, we need to mock it if it's missing in jest-dom
if (typeof window !== 'undefined') {
  window.PointerEvent = class PointerEvent extends Event {};
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
}

describe('MikrotikOnboardingScript Component', () => {
  let queryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
  });

  const renderComponent = (props = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <MikrotikOnboardingScript open={true} onOpenChange={vi.fn()} {...props} />
      </QueryClientProvider>
    );
  };

  it('renders the initial configuration form (step 1)', () => {
    renderComponent();
    expect(screen.getByText('MikroTik Auto-Onboarding Script')).toBeInTheDocument();
    expect(screen.getByText(/Router Name \*/)).toBeInTheDocument();
    expect(screen.getByText(/Expected IP Address \*/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generate Script/i })).toBeInTheDocument();
  });

  it('prevents script generation if required fields are missing', async () => {
    renderComponent();
    
    const generateBtn = screen.getByRole('button', { name: /Generate Script/i });
    fireEvent.click(generateBtn);
    
    // It should stay on step 1, so the "Copy Script" button should NOT be there
    expect(screen.queryByRole('button', { name: /Copy Script/i })).not.toBeInTheDocument();
  });

  it('generates the script and switches to step 2 when valid data is provided', async () => {
    renderComponent();
    
    const nameInput = screen.getAllByRole('textbox')[0]; // Assuming first textbox is Router Name
    const ipInput = screen.getAllByRole('textbox')[1]; // Assuming second textbox is IP Address
    
    fireEvent.change(nameInput, { target: { value: 'Test Router' } });
    fireEvent.change(ipInput, { target: { value: '10.0.0.1' } });
    
    const generateBtn = screen.getByRole('button', { name: /Generate Script/i });
    fireEvent.click(generateBtn);
    
    // Wait for the UI to update to step 2
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Copy Script/i })).toBeInTheDocument();
    });

    // Check script contents for the values we entered
    expect(screen.getByText(/# Router: Test Router/)).toBeInTheDocument();
    expect(screen.getByText(/\/ip address add address=10.0.0.1\/24/)).toBeInTheDocument();
  });
});
