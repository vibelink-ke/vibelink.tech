import { mockApi } from './src/api/mockData';

async function testMultiTenancy() {
  console.log('Starting Multi-tenancy Verification...');

  // 1. Register Tenant A
  console.log('Registering Tenant A...');
  const userA = await mockApi.auth.register('admin@tenantA.com', 'password', 'Tenant A');
  const tenantIdA = userA.tenant_id;
  
  // 2. Create Customer in Tenant A
  console.log('Creating Customer A in Tenant A...');
  await mockApi.entities.Customer.create({ name: 'Customer A' });
  
  // 3. Verify Customer A exists for Tenant A
  const customersA = await mockApi.entities.Customer.list();
  if (customersA.length === 1 && customersA[0].name === 'Customer A') {
    console.log('✅ Tenant A can see its own customer.');
  } else {
    console.log('❌ Tenant A failed to see its own customer.');
  }

  // 4. Register Tenant B
  console.log('Registering Tenant B...');
  const userB = await mockApi.auth.register('admin@tenantB.com', 'password', 'Tenant B');
  const tenantIdB = userB.tenant_id;
  
  // 5. Verify Tenant B CANNOT see Tenant A's customer
  const customersB = await mockApi.entities.Customer.list();
  if (customersB.length === 0) {
    console.log('✅ Tenant B cannot see Tenant A\'s data.');
  } else {
    console.log('❌ Isolation failure: Tenant B can see Tenant A\'s customer.');
  }

  // 6. Create Customer in Tenant B
  console.log('Creating Customer B in Tenant B...');
  await mockApi.entities.Customer.create({ name: 'Customer B' });
  
  // 7. Verify Tenant B can see Customer B
  const customersB_after = await mockApi.entities.Customer.list();
  if (customersB_after.length === 1 && customersB_after[0].name === 'Customer B') {
    console.log('✅ Tenant B can see its own customer.');
  }

  // 8. Re-login as Tenant A
  console.log('Switching back to Tenant A...');
  localStorage.setItem('vibelink_user', JSON.stringify(userA));
  const customersA_final = await mockApi.entities.Customer.list();
  if (customersA_final.length === 1 && customersA_final[0].name === 'Customer A') {
    console.log('✅ Tenant A isolation preserved after switching back.');
  } else {
    console.log('❌ Tenant A data lost or corrupted.');
  }

  console.log('Verification Complete!');
}

// Mock localStorage for the test if running in Node
if (typeof localStorage === 'undefined') {
  global.localStorage = {
    _data: {},
    setItem(key, val) { this._data[key] = val; },
    getItem(key) { return this._data[key]; },
    removeItem(key) { delete this._data[key]; }
  };
}

testMultiTenancy();
