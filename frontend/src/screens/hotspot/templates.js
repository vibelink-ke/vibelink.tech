/** Captive-portal templates, transcribed verbatim from `state.baseTemplates`. */
export const BASE_TEMPLATES = [
  {
    id: 'kadogo', name: 'Kadogo', bg: '#12211d', accent: '#2fbf8f', tile: '#23332e', line: '#3c4f48',
    text: '#eaf3ef', muted: '#8fa79c', isList: true, hasBigCta: true,
    desc: 'Dark, one tap, cheapest bundle first', bestFor: 'Best for KES 10–50 walk-up buyers',
  },
  {
    id: 'duka', name: 'Duka', bg: '#ffffff', accent: '#0f7a5f', tile: '#eef1ee', line: '#c9cec6',
    text: '#161a17', muted: '#8a9186', isList: true, hasCodeBox: true, hasBanner: true,
    desc: 'Light, voucher-code box above the fold', bestFor: 'Best for shops selling printed codes',
  },
  {
    id: 'soko', name: 'Soko', bg: '#f7f8f5', accent: '#0f7a5f', tile: '#e6eae6', line: '#c9cec6',
    text: '#161a17', muted: '#8a9186', isGrid: true, hasBigCta: true,
    desc: 'Bundle cards in a grid', bestFor: 'Best when you run 6+ plans',
  },
  {
    id: 'sponsored', name: 'Sponsored', bg: '#ffffff', accent: '#c9a227', tile: '#eef1ee', line: '#c9cec6',
    text: '#161a17', muted: '#8a9186', hasBanner: true, isList: true,
    desc: 'Ad or promo slot above the bundles', bestFor: 'Best for advertiser-funded hotspots',
  },
  {
    id: 'mwanga', name: 'Mwanga', bg: '#ffffff', accent: '#a5451f', tile: '#f7e2dc', line: '#d9b6aa',
    text: '#161a17', muted: '#7d5b50', isList: true, hasBigCta: true,
    desc: 'High contrast, oversized tap targets', bestFor: 'Best for older phones and low vision',
  },
  {
    id: 'rahisi', name: 'Rahisi', bg: '#f4f4f2', accent: '#12211d', tile: '#e4e4e0', line: '#b9b9b3',
    text: '#161a17', muted: '#7a7a74', isList: true,
    desc: 'Text only, no imagery, ~8 KB', bestFor: 'Best on 2G and weak signal',
  },
  {
    id: 'kijani', name: 'Kijani', bg: '#eef4f1', accent: '#0f7a5f', tile: '#dfeae4', line: '#b6c9c0',
    text: '#12211d', muted: '#6d8579', hasBanner: true, isGrid: true,
    desc: 'Logo lockup, trust badges, brand-led', bestFor: 'Best for established ISP brands',
  },
  {
    id: 'bingwa', name: 'Bingwa', bg: '#1b2430', accent: '#c9a227', tile: '#2a3542', line: '#42505f',
    text: '#eef2f6', muted: '#93a3b3', isList: true, hasBigCta: true,
    desc: 'Premium dark, monthly plans up front', bestFor: 'Best for business and monthly buyers',
  },
  {
    id: 'aurora', name: 'Aurora', bg: 'linear-gradient(160deg,#0b1e2d 0%,#12333f 55%,#0f4c5c 100%)',
    accent: '#22d3ee', tile: '#123244', line: '#2b4a58', text: '#eef6f7', muted: '#9fc1c9',
    isList: true, hasBigCta: true, hasBanner: true,
    desc: 'Modern dark gradient, neon accent', bestFor: 'Best for urban, youth-focused hotspots',
  },
  {
    id: 'citrus', name: 'Citrus', bg: 'linear-gradient(160deg,#fff7ed 0%,#ffe8d6 100%)',
    accent: '#ff6b35', tile: '#fff1e4', line: '#f3d9c4', text: '#241c14', muted: '#8a6a52',
    isGrid: true, hasBanner: true,
    desc: 'Warm modern gradient, grid layout', bestFor: 'Best for cafes and lifestyle brands',
  },
];
