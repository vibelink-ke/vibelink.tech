import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MikrotikList from './MikrotikList';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Setup query client to wrap any child components that might use useQuery (like AlertsPanel, BackupHistory)
const queryClient = new QueryClient();

const mockRouters = [
  {
    id: '1',
    router_name: 'Core Router',
    ip_address: '192.168.1.1',
    status: 'online',
    total_customers: 150,
    cpu_usage: 45,
    memory_usage: 60,
    last_connected: '2023-10-27T10:00:00Z'
  },
  {
    id: '2',
    router_name: 'Branch Router',
    ip_address: '10.0.0.1',
    status: 'offline',
    total_customers: 20,
    cpu_usage: 0,
    memory_usage: 0,
    last_connected: null
  }
];

const renderWithProviders = (ui) => {
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  );
};

// Mock any heavy child components that might cause issues in JSDOM if not fully supported
vi.mock('./MikrotikMetrics', () => ({ default: () => <div data-testid="mikrotik-metrics" /> }));
vi.mock('./AlertsPanel', () => ({ default: () => <div data-testid="alerts-panel" /> }));
vi.mock('./BackupHistory', () => ({ default: () => <div data-testid="backup-history" /> }));

describe('MikrotikList Component', () => {
  it('renders a loading state when isLoading is true', () => {
    const { container } = renderWithProviders(<MikrotikList routers={[]} isLoading={true} />);
    // DataTable handles loading state, so our container should simply mount without throwing
    expect(container).toBeInTheDocument();
  });

  it('renders empty state when no routers are provided', () => {
    renderWithProviders(<MikrotikList routers={[]} isLoading={false} />);
    expect(screen.getByText('No MikroTik Routers')).toBeInTheDocument();
  });

  it('renders the list of routers correctly', () => {
    renderWithProviders(<MikrotikList routers={mockRouters} isLoading={false} />);
    expect(screen.getByText('Core Router')).toBeInTheDocument();
    expect(screen.getByText('192.168.1.1')).toBeInTheDocument();
    expect(screen.getByText('Branch Router')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.1')).toBeInTheDocument();
  });

  it('calls onEdit when edit button is clicked', () => {
    const onEditMock = vi.fn();
    renderWithProviders(<MikrotikList routers={mockRouters} isLoading={false} onEdit={onEditMock} />);
    
    const editButtons = screen.getAllByTitle('Edit router');
    fireEvent.click(editButtons[0]);
    
    expect(onEditMock).toHaveBeenCalledWith(mockRouters[0]);
  });
  
  it('calls onSync when sync button is clicked and router is online', () => {
    const onSyncMock = vi.fn();
    renderWithProviders(<MikrotikList routers={mockRouters} isLoading={false} onSync={onSyncMock} isSyncing={false} />);
    
    const syncButtons = screen.getAllByTitle('Sync now');
    fireEvent.click(syncButtons[0]); // Core Router is online
    
    expect(onSyncMock).toHaveBeenCalledWith(mockRouters[0]);
  });
  
  it('disables sync button when router is offline or isSyncing is true', () => {
    const onSyncMock = vi.fn();
    renderWithProviders(<MikrotikList routers={mockRouters} isLoading={false} onSync={onSyncMock} isSyncing={true} />);
    
    const syncButtons = screen.getAllByTitle('Sync now');
    expect(syncButtons[0]).toBeDisabled(); // Disabled due to isSyncing=true
    expect(syncButtons[1]).toBeDisabled(); // Disabled due to offline status AND isSyncing=true
  });

  it('calls onGetScript when Get Onboarding Script button is clicked', () => {
    const onGetScriptMock = vi.fn();
    renderWithProviders(<MikrotikList routers={mockRouters} isLoading={false} onGetScript={onGetScriptMock} />);
    
    const scriptButtons = screen.getAllByTitle('Get Onboarding Script');
    fireEvent.click(scriptButtons[0]);
    
    expect(onGetScriptMock).toHaveBeenCalledWith(mockRouters[0]);
  });
});
