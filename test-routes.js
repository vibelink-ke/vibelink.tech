import puppeteer from 'puppeteer';

// All 32 routes extracted from pages.config.js
const routes = [
  '',
  'Administration',
  'Analytics',
  'CustomerOnboarding',
  'CustomerPortal',
  'CustomerProfile',
  'Customers',
  'Dashboard',
  'Finance',
  'Hotspots',
  'IPAddressPool',
  'Invoices',
  'KnowledgeBase',
  'Logs',
  'Messages',
  'Outages',
  'Reports',
  'Roles',
  'SLA',
  'Security',
  'ServicePlans',
  'SetPassword',
  'Settings',
  'Subscriptions',
  'SuperAdmin',
  'TenantBilling',
  'TenantBillingAnalytics',
  'TenantOnboarding',
  'TenantSignup',
  'Tenants',
  'Tickets',
  'HotspotFileManager',
  'MikrotikManagement',
];

(async () => {
  console.log(`Starting automated test for ${routes.length} routes...`);
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  // Intercept and abort API calls to speed up the test (we only care about JS rendering)
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    // Abort external API calls to backend to avoid waiting timeouts
    if (url.includes('base44.app') || url.includes('api.')) {
      req.abort();
    } else {
      req.continue();
    }
  });

  const failedRoutes = [];

  for (const route of routes) {
    const label = `/${route || '(root)'}`;
    process.stdout.write(`Testing ${label} ... `);

    try {
      await page.goto(`http://localhost:5173/${route}`, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });

      // Wait for React to mount - brief pause
      await new Promise((r) => setTimeout(r, 800));

      // Check for Vite error overlay
      const hasViteError = await page.$('vite-error-overlay').catch(() => null);
      if (hasViteError) {
        console.log(`❌ FAILED (Vite build error detected)`);
        failedRoutes.push(route);
        continue;
      }

      // Check if #root has any content
      const rootHtml = await page.$eval('#root', (el) => el.innerHTML).catch(() => '');
      if (!rootHtml || rootHtml.trim() === '') {
        console.log(`❌ FAILED (Blank Screen / Empty root)`);
        failedRoutes.push(route);
        continue;
      }

      console.log(`✅ OK`);
    } catch (err) {
      console.log(`❌ FAILED (${err.message.split('\n')[0]})`);
      failedRoutes.push(route);
    }
  }

  await browser.close();

  console.log('\n--- TEST SUMMARY ---');
  if (failedRoutes.length > 0) {
    console.log(`${routes.length - failedRoutes.length}/${routes.length} pages OK.`);
    console.log(`FAILED routes:`);
    failedRoutes.forEach((r) => console.log(`  - /${r || '(root)'}`));
    process.exit(1);
  } else {
    console.log(`✅ All ${routes.length} pages rendered successfully!`);
    process.exit(0);
  }
})();
