import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockApi } from './mockData';

describe('Multi-tenancy Data Isolation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should isolate data between different tenants', async () => {
    // 1. Register Tenant A
    const userA = await mockApi.auth.register('adminA@test.com', 'pass', 'Tenant A');
    expect(userA.tenant_id).toBeDefined();

    // 2. Create customer in Tenant A
    await mockApi.entities.Customer.create({ name: 'Customer A' });
    const customersA = await mockApi.entities.Customer.list();
    expect(customersA).toHaveLength(1);
    expect(customersA[0].name).toBe('Customer A');

    // 3. Register Tenant B
    const userB = await mockApi.auth.register('adminB@test.com', 'pass', 'Tenant B');
    expect(userB.tenant_id).not.toBe(userA.tenant_id);

    // 4. Verify Tenant B sees NO customers initially
    const customersB_initial = await mockApi.entities.Customer.list();
    expect(customersB_initial).toHaveLength(0);

    // 5. Create customer in Tenant B
    await mockApi.entities.Customer.create({ name: 'Customer B' });
    const customersB_after = await mockApi.entities.Customer.list();
    expect(customersB_after).toHaveLength(1);
    expect(customersB_after[0].name).toBe('Customer B');

    // 6. Switch back to Tenant A manually (simulating session restore)
    localStorage.setItem('vibelink_user', JSON.stringify(userA));
    const customersA_final = await mockApi.entities.Customer.list();
    expect(customersA_final).toHaveLength(1);
    expect(customersA_final[0].name).toBe('Customer A');
  });

  it('should automatically inject tenant_id on creation', async () => {
    const user = await mockApi.auth.register('admin@test.com', 'pass', 'My ISP');
    const newPlan = await mockApi.entities.ServicePlan.create({ name: 'Gold Plan' });
    
    expect(newPlan.tenant_id).toBe(user.tenant_id);
    
    const plans = await mockApi.entities.ServicePlan.list();
    expect(plans[0].tenant_id).toBe(user.tenant_id);
  });
});
