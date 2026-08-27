/**
 * Sidebar structure, transcribed from the <aside> in BILLING.SYSTEM.dc.html.
 * `count` picks the monospace figure the mockup shows on the right of a row.
 */
export const NAV_SECTIONS = [
  {
    heading: 'OPERATIONS',
    items: [
      { to: '/', label: 'Dashboard', end: true },
      { to: '/clients', label: 'Clients', count: (s) => s.clients.length },
      { to: '/communications', label: 'Communications' },
      { to: '/hotspot', label: 'Hotspot', count: (s) => s.vouchers.length },
      { to: '/networks', label: 'Networks' },
      { to: '/tariffs', label: 'Internet tariffs' },
      { to: '/fair-use', label: 'Fair use policy', count: (s) => s.fupPolicies.length },
      { to: '/routers', label: 'Routers', count: (s) => s.routers.length },
      { to: '/map', label: 'Map' },
      { to: '/analytics', label: 'Analytics' },
    ],
  },
  {
    heading: 'SUPPORT',
    items: [
      // Tickets, Live support, Service outages and SLA management collapse
      // under one "Support" group instead of sitting as four separate rows —
      // the same pages, just nested rather than each claiming its own line
      // in an already-long sidebar.
      {
        label: 'Support',
        children: [
          { to: '/tickets', label: 'Tickets', count: (s) => s.tickets.length },
          { to: '/live-support', label: 'Live support', dot: true },
          { to: '/outages', label: 'Service outages', count: (s) => s.outages.length },
          { to: '/sla', label: 'SLA management', count: (s) => s.slaPolicies.length },
        ],
      },
      // Referrals lives inside Leads itself now (a "Referrers" tab on the
      // same screen) rather than as a separate page — a referrer is where a
      // lead's "referral" channel actually points, not a separate concern,
      // so one count covers both.
      { to: '/leads', label: 'Leads', count: (s) => s.leads.length + s.referrers.length },
      { to: '/messaging', label: 'Messaging' },
      { to: '/knowledge-base', label: 'Knowledge base', count: (s) => s.articles.length },
    ],
  },
  {
    heading: 'MONEY',
    items: [
      { to: '/payments', label: 'Payments', badge: (s) => s.unmatched.length },
      { to: '/site-profiles', label: 'Site payment profiles', count: (s) => s.siteProfiles.length },
      { to: '/automation', label: 'Automation' },
    ],
  },
  {
    heading: 'PLATFORM OWNER',
    ownerOnly: true,
    items: [
      { to: '/platform', label: 'Platform monitor' },
      { to: '/tenants', label: 'ISP tenants', count: (s) => s.tenants.length },
      { to: '/saas-revenue', label: 'SaaS revenue' },
    ],
  },
  {
    heading: 'SYSTEM',
    items: [
      { to: '/staff', label: 'Staff & roles', count: (s) => s.staff.length },
      { to: '/settings', label: 'Settings' },
    ],
  },
];
