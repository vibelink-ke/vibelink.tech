import React, { useEffect, useState } from 'react';

/**
 * The public page of the platform, shown on the root domain only (an ISP registers here, then works on their own
 * subdomain). Laid out in the manner of wifipay.co.ke: a bright blue hero, white cards, a feature grid, pricing with a
 * toggle, a country list and a closing call to action. Everything it states is true of Vibelink; there are no user counts
 * or testimonials because we have none to quote.
 */

const PHONE = '0112 009 226';
const PHONE_LINK = 'tel:+254112009226';
const WHATSAPP = 'https://wa.me/254112009226';
const SALES_EMAIL = 'sales@vibelink.co.ke';

const B = { sky: '#0ea5e9', deep: '#0369a1', teal: '#0e7490', ink: '#0f172a', slate: '#475569', line: '#e2e8f0', mist: '#f1f5f9' };

const FEATURES = [
  ['Automated billing', ['Invoices and renewals raised on their own', 'Reminders by SMS before a line expires', 'Part payments, top-ups and wallet credit']],
  ['Hotspot and PPPoE', ['Routers set up for you over a tunnel', 'Speed changes and cut-offs applied at once', 'Fair-use caps that apply themselves']],
  ['Customer portal', ['Customers see their balance and invoices', 'Pay with M-Pesa from the same page', 'Tickets and live chat on your own address']],
  ['Money that matches', ['M-Pesa matched to the right account', 'Unmatched payments put in front of you', 'We can collect for you if you have no paybill']],
  ['Your team', ['A login for each cashier and technician', 'A field app with jobs, photos and shifts', 'A calendar to book installations and repairs']],
  ['Reports', ['Collections by day, site and channel', 'Who is online and who owes', 'Payroll, expenses and commissions']],
];

const COUNTRIES = [
  ['Kenya', 'KES', 'M-Pesa paybill and till, STK push, KopoKopo, bank STK push'],
  ['Uganda', 'UGX', 'MTN and Airtel mobile money through Flutterwave or Yo! Payments'],
  ['Tanzania', 'TZS', 'M-Pesa, Tigo Pesa, Airtel Money and Halopesa through AzamPay or Flutterwave'],
  ['Rwanda', 'RWF', 'Mobile money through Flutterwave'],
  ['Ghana', 'GHS', 'MTN, Vodafone and AirtelTigo mobile money through Flutterwave or Paystack'],
  ['Nigeria', 'NGN', 'Card, bank transfer and USSD through Paystack'],
  ['Zambia', 'ZMW', 'Mobile money through Flutterwave'],
  ['South Africa', 'ZAR', 'Card and bank payments through Paystack'],
];

const FAQ = [
  ['Do I need a public IP address for my routers?',
   'No. The router connects out to us over a tunnel, so there is no port forwarding and nothing to open on your side. You paste one line into a MikroTik and it dials in.'],
  ['Which routers does it work with?', 'MikroTik. We set up RADIUS, PPPoE, hotspot, DHCP and the firewall rules for you.'],
  ['Can customers pay a way you do not support?',
   'Yes. Cash, a till with no API or a bank deposit can be recorded by hand against the customer and goes through the same matching as an automatic payment.'],
  ['Whose customers are they?', 'Yours. Their details and payments sit in your own account on your own address. We do not contact them.'],
  ['What does it cost to start?',
   'Nothing up front. Register and use it free until the 5th of the month after you sign up, then you are billed each month as shown above. No card is needed.'],
  ['Is there somebody to ring if it goes wrong?', 'Yes. We run an ISP ourselves and use this every day. Call or WhatsApp ' + PHONE + '.'],
];

/** What the platform charges in each billing mode, worked out for a given ISP. */
function platformFee({ pppoe, avgFee, hotspot }) {
  const usage = Math.round(hotspot * 0.035 + pppoe * 20);
  const takings = pppoe * avgFee + hotspot;
  const tier = takings < 10000 ? 1000 : takings <= 20000 ? 2000 : 3000;
  return { usage, tier, takings };
}

const STEPS = [
  ['Register', 'Pick a name and a subdomain. It takes a minute.'],
  ['Add a router', 'Paste one line into your MikroTik. It connects on its own.'],
  ['Add customers', 'Or import the PPPoE accounts already on the router.'],
  ['Get paid', 'Connect M-Pesa and let the matching run.'],
];

export default function Landing({ onRegister }) {
  const [mode, setMode] = useState('usage');
  const [calc, setCalc] = useState({ pppoe: '120', avgFee: '2000', hotspot: '30000' });
  const num = (v) => Math.max(0, Number(v) || 0);
  const fee = platformFee({ pppoe: num(calc.pppoe), avgFee: num(calc.avgFee), hotspot: num(calc.hotspot) });
  const cheaper = fee.usage <= fee.tier ? 'usage' : 'tier';
  const best = Math.min(fee.usage, fee.tier);
  const kes = (n) => 'KES ' + Math.round(n).toLocaleString('en-KE');

  // Set here rather than in index.html: that file is also served to every tenant's sign-in page.
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'canonical';
    link.href = `https://${window.location.hostname.replace(/^www\./, '')}/`;
    document.head.appendChild(link);
    return () => link.remove();
  }, []);

  const wrap = { maxWidth: 1200, margin: '0 auto', padding: '0 24px' };
  const heading = { fontSize: 34, fontWeight: 800, margin: '0 0 10px', letterSpacing: '-.02em', color: B.ink };
  const btn = { border: 0, borderRadius: 10, padding: '14px 26px', fontSize: 16, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none', display: 'inline-block' };
  const card = { background: '#fff', border: `1px solid ${B.line}`, borderRadius: 16, padding: 24, boxShadow: '0 6px 20px -12px rgba(15,23,42,.18)' };

  return (
    <div style={{ minHeight: '100vh', background: '#fff', color: B.ink, fontFamily: "'Inter', system-ui, sans-serif", fontSize: 16, lineHeight: 1.6 }}>
      <style>{`
        .vl-grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 22px; }
        .vl-grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px; }
        .vl-grid4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 22px; }
        @media (max-width: 880px) {
          .vl-grid3, .vl-grid2, .vl-grid4 { grid-template-columns: minmax(0, 1fr); }
          .vl-h1 { font-size: 36px !important; }
          .vl-hide { display: none !important; }
        }
      `}</style>

      {/* top bar */}
      <header style={{ position: 'sticky', top: 0, zIndex: 20, background: '#fff', borderBottom: `1px solid ${B.line}` }}>
        <div style={{ ...wrap, height: 66, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 24, fontWeight: 800, color: B.deep }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={B.sky} strokeWidth="2.4" strokeLinecap="round">
              <path d="M2 9a15 15 0 0 1 20 0" /><path d="M5.5 12.8a10 10 0 0 1 13 0" /><path d="M9 16.5a5 5 0 0 1 6 0" /><circle cx="12" cy="20" r="1" fill={B.sky} />
            </svg>
            Vibelink
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
            <a className="vl-hide" href="#pricing" style={{ color: B.slate, textDecoration: 'none', fontWeight: 600 }}>Pricing</a>
            <a className="vl-hide" href="#countries" style={{ color: B.slate, textDecoration: 'none', fontWeight: 600 }}>Countries</a>
            <a className="vl-hide" href="#faq" style={{ color: B.slate, textDecoration: 'none', fontWeight: 600 }}>Questions</a>
            <button type="button" onClick={onRegister} style={{ ...btn, background: B.deep, color: '#fff', padding: '10px 20px', fontSize: 15 }}>Register free</button>
          </span>
        </div>
      </header>

      {/* hero */}
      <section style={{ background: `linear-gradient(135deg, ${B.sky} 0%, ${B.teal} 100%)`, color: '#fff' }}>
        <div style={{ ...wrap, padding: '84px 24px 72px', textAlign: 'center' }}>
          <h1 className="vl-h1" style={{ fontSize: 56, lineHeight: 1.08, fontWeight: 800, margin: '0 auto 18px', maxWidth: 820, letterSpacing: '-.03em' }}>
            Run your ISP from one screen, and get paid on time
          </h1>
          <p style={{ fontSize: 20, maxWidth: 700, margin: '0 auto 30px', opacity: .95 }}>
            Billing for hotspot and PPPoE internet providers: invoices, M-Pesa and mobile-money matching, router control
            and a portal your customers can pay from.
          </p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button type="button" onClick={onRegister} style={{ ...btn, background: '#fff', color: B.deep }}>Register free</button>
            <a href="https://demo.vibelink.tech" target="_blank" rel="noreferrer" style={{ ...btn, background: 'transparent', color: '#fff', border: '2px solid rgba(255,255,255,.8)' }}>Try the demo</a>
          </div>
          <p style={{ marginTop: 18, fontSize: 15, opacity: .9 }}>No card needed. Free until the 5th of the month after you register.</p>

          {/* the facts, in place of invented numbers */}
          <div className="vl-grid4" style={{ marginTop: 48, textAlign: 'left' }}>
            {[['MikroTik', 'RADIUS, PPPoE and hotspot pushed for you'], ['5 ways to take M-Pesa', 'paybill, till, STK, KopoKopo, bank'], ['8 countries', 'Kenya and seven more, in their own currency'], ['Built by an ISP', 'in Kabarnet, Baringo, and used there daily']].map(([t, s]) => (
              <div key={t} style={{ background: 'rgba(255,255,255,.14)', border: '1px solid rgba(255,255,255,.28)', borderRadius: 14, padding: '16px 18px' }}>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{t}</div>
                <div style={{ fontSize: 14.5, opacity: .92 }}>{s}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* features */}
      <section style={{ ...wrap, padding: '72px 24px 40px' }}>
        <h2 style={{ ...heading, textAlign: 'center' }}>Everything an ISP needs to run and grow</h2>
        <p style={{ color: B.slate, textAlign: 'center', maxWidth: 640, margin: '0 auto 40px' }}>
          From the invoice to the router, in one place.
        </p>
        <div className="vl-grid3">
          {FEATURES.map(([title, bullets]) => (
            <div key={title} style={card}>
              <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 10 }}>{title}</div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
                {bullets.map((b) => (
                  <li key={b} style={{ display: 'flex', gap: 9, color: B.slate, fontSize: 15 }}>
                    <span style={{ color: B.sky, fontWeight: 800 }}>✓</span>{b}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* screens */}
      <section style={{ background: B.mist, padding: '60px 0' }}>
        <div style={wrap}>
          <h2 style={{ ...heading, textAlign: 'center' }}>See the real screens</h2>
          <p style={{ color: B.slate, textAlign: 'center', margin: '0 0 28px' }}>Made-up customers, the real app. Or open the live demo and click around.</p>
          <div className="vl-grid2">
            {[['/screens/dashboard.png', 'Dashboard'], ['/screens/clients.png', 'Clients']].map(([src, title]) => (
              <figure key={src} style={{ margin: 0 }}>
                <img src={src} alt={`${title} screen`} loading="lazy" width="1440" height="900"
                     style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 14, border: `1px solid ${B.line}`, boxShadow: '0 14px 30px -18px rgba(15,23,42,.35)' }} />
                <figcaption style={{ marginTop: 8, color: B.slate, fontSize: 15, textAlign: 'center' }}>{title}</figcaption>
              </figure>
            ))}
          </div>
          <div style={{ ...card, marginTop: 28, display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>Live demo ISP</div>
              <div style={{ color: B.slate, fontSize: 15 }}>Full of made-up routers and customers. Resets every hour, so click anything.</div>
            </div>
            <div style={{ fontSize: 15 }}>
              <div><b>Address:</b> <a href="https://demo.vibelink.tech" target="_blank" rel="noreferrer" style={{ color: B.deep }}>demo.vibelink.tech</a></div>
              <div><b>Email:</b> demo@vibelink.tech · <b>Password:</b> demo@123</div>
            </div>
          </div>
        </div>
      </section>

      {/* pricing */}
      <section id="pricing" style={{ ...wrap, padding: '72px 24px 30px' }}>
        <h2 style={{ ...heading, textAlign: 'center' }}>Simple, transparent pricing</h2>
        <p style={{ color: B.slate, textAlign: 'center', maxWidth: 640, margin: '0 auto 24px' }}>
          Pick how you are billed, and ask us to change it any time. Nothing is charged until the 5th of the month after you register.
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 28 }}>
          {[['usage', 'Pay by use'], ['tier', 'Flat tier']].map(([k, label]) => (
            <button key={k} type="button" onClick={() => setMode(k)}
                    style={{ ...btn, padding: '10px 22px', fontSize: 15, borderRadius: 999, background: mode === k ? B.deep : B.mist, color: mode === k ? '#fff' : B.slate }}>
              {label}
            </button>
          ))}
        </div>
        {mode === 'usage' ? (
          <div className="vl-grid3">
            {[['KES 20', 'per active PPPoE customer, each month', 'Only customers active that month count. A suspended customer does not.'],
              ['3.5%', 'of your hotspot sales', 'Taken from the vouchers you sell that month. Nothing in a month with no sales.'],
              ['KES 0', 'to set up', 'No setup fee, no contract, no card. Leave whenever you like.']].map(([big, title, text]) => (
              <div key={big} style={{ ...card, textAlign: 'center' }}>
                <div style={{ fontSize: 42, fontWeight: 800, color: B.deep }}>{big}</div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{title}</div>
                <div style={{ color: B.slate, fontSize: 15 }}>{text}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="vl-grid3">
            {[['KES 1,000', 'Under KES 10,000 collected a month'], ['KES 2,000', 'KES 10,000 to 20,000 collected a month'], ['KES 3,000', 'Over KES 20,000 collected a month']].map(([price, when]) => (
              <div key={price} style={{ ...card, textAlign: 'center' }}>
                <div style={{ fontSize: 42, fontWeight: 800, color: B.deep }}>{price}</div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>a month</div>
                <div style={{ color: B.slate, fontSize: 15 }}>{when}, hotspot and PPPoE together. It stops at KES 3,000 however much you grow.</div>
              </div>
            ))}
          </div>
        )}
        <p style={{ color: B.slate, fontSize: 14.5, textAlign: 'center', marginTop: 14 }}>
          Standard rates. If your business fits neither, ask us for a flat monthly fee.
        </p>

        <div style={{ ...card, marginTop: 34, padding: '28px 30px' }}>
          <h3 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 4px' }}>Work out what it would cost you</h3>
          <p style={{ margin: '0 0 18px', color: B.slate }}>Type in your own numbers. Nothing is saved.</p>
          <div className="vl-grid3" style={{ marginBottom: 20 }}>
            {[['pppoe', 'Active PPPoE customers'], ['avgFee', 'Average monthly fee (KES)'], ['hotspot', 'Hotspot sales a month (KES)']].map(([k, label]) => (
              <label key={k} style={{ display: 'grid', gap: 5, fontSize: 14.5, fontWeight: 700 }}>
                {label}
                <input type="number" min="0" value={calc[k]} onChange={(e) => setCalc((c) => ({ ...c, [k]: e.target.value }))}
                       style={{ font: 'inherit', fontWeight: 500, padding: '11px 13px', border: `1.5px solid ${B.line}`, borderRadius: 10 }} />
              </label>
            ))}
          </div>
          <div className="vl-grid2">
            {[['usage', 'Pay by use', fee.usage], ['tier', 'Flat tier', fee.tier]].map(([k, label, amount]) => (
              <div key={k} style={{ padding: '14px 18px', borderRadius: 12, background: cheaper === k ? '#e0f2fe' : B.mist, border: cheaper === k ? `2px solid ${B.sky}` : '2px solid transparent' }}>
                <div style={{ fontSize: 14, color: B.slate }}>{label}{cheaper === k ? ' · the lower of the two' : ''}</div>
                <div style={{ fontSize: 30, fontWeight: 800 }}>{kes(amount)} <span style={{ fontSize: 15, fontWeight: 500, color: B.slate }}>a month</span></div>
              </div>
            ))}
          </div>
          <p style={{ margin: '14px 0 0', color: B.slate, fontSize: 15 }}>
            On about {kes(fee.takings)} collected a month, that is roughly {fee.takings ? (best / fee.takings * 100).toFixed(1) : '0'}% of what you take in.
          </p>
        </div>
      </section>

      {/* countries */}
      <section id="countries" style={{ background: B.mist, padding: '64px 0', marginTop: 40 }}>
        <div style={wrap}>
          <h2 style={{ ...heading, textAlign: 'center' }}>Built for Africa, one country at a time</h2>
          <p style={{ color: B.slate, textAlign: 'center', maxWidth: 680, margin: '0 auto 30px' }}>
            Each ISP picks its country, so phone numbers, prices and payment methods follow it. Kenya has been running for a long time;
            the others are newer, so tell us when you register and we will help you switch on and test your payments.
          </p>
          <div className="vl-grid2">
            {COUNTRIES.map(([name, currency, how]) => (
              <div key={name} style={{ ...card, padding: '16px 20px' }}>
                <div style={{ fontWeight: 800 }}>{name} <span style={{ color: B.slate, fontWeight: 600, fontSize: 14 }}>· {currency}</span></div>
                <div style={{ color: B.slate, fontSize: 15 }}>{how}</div>
              </div>
            ))}
          </div>
          <p style={{ textAlign: 'center', marginTop: 24 }}>
            Somewhere else in Africa? <a href={`mailto:${SALES_EMAIL}?subject=Vibelink%20in%20my%20country`} style={{ color: B.deep, fontWeight: 700 }}>Tell us the country</a>.
          </p>
        </div>
      </section>

      {/* getting started */}
      <section style={{ ...wrap, padding: '64px 24px' }}>
        <h2 style={{ ...heading, textAlign: 'center', marginBottom: 32 }}>Getting started takes four steps</h2>
        <div className="vl-grid4">
          {STEPS.map(([title, text], i) => (
            <div key={title} style={{ ...card, textAlign: 'center' }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: B.sky, color: '#fff', fontWeight: 800, fontSize: 20, display: 'grid', placeItems: 'center', margin: '0 auto 10px' }}>{i + 1}</div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{title}</div>
              <div style={{ color: B.slate, fontSize: 15 }}>{text}</div>
            </div>
          ))}
        </div>
      </section>

      {/* faq */}
      <section id="faq" style={{ ...wrap, padding: '0 24px 64px' }}>
        <h2 style={{ ...heading, textAlign: 'center', marginBottom: 24 }}>Questions people ask first</h2>
        <div style={{ maxWidth: 800, margin: '0 auto', display: 'grid', gap: 10 }}>
          {FAQ.map(([q, a]) => (
            <details key={q} style={{ ...card, padding: '14px 20px' }}>
              <summary style={{ fontWeight: 700, cursor: 'pointer', fontSize: 17 }}>{q}</summary>
              <p style={{ margin: '8px 0 0', color: B.slate }}>{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* closing */}
      <section style={{ background: `linear-gradient(135deg, ${B.teal} 0%, ${B.sky} 100%)`, color: '#fff', textAlign: 'center' }}>
        <div style={{ ...wrap, padding: '64px 24px' }}>
          <h2 style={{ fontSize: 38, fontWeight: 800, margin: '0 0 10px', letterSpacing: '-.02em' }}>Ready to run your ISP properly?</h2>
          <p style={{ fontSize: 18, opacity: .95, margin: '0 0 26px' }}>Register in a minute, add a router, and start getting paid. Or talk to us first.</p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button type="button" onClick={onRegister} style={{ ...btn, background: '#fff', color: B.deep }}>Register free</button>
            <a href={PHONE_LINK} style={{ ...btn, background: 'transparent', color: '#fff', border: '2px solid rgba(255,255,255,.8)' }}>Call {PHONE}</a>
            <a href={WHATSAPP} target="_blank" rel="noreferrer" style={{ ...btn, background: 'transparent', color: '#fff', border: '2px solid rgba(255,255,255,.8)' }}>WhatsApp</a>
          </div>
        </div>
      </section>

      <footer style={{ background: B.ink, color: '#cbd5e1' }}>
        <div style={{ ...wrap, padding: '24px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, fontSize: 14 }}>
          <span>
            © {new Date().getFullYear()} Vibelink Telecommunications Ltd ·{' '}
            <a href="#cookies" style={{ color: 'inherit' }}
               onClick={(e) => { e.preventDefault(); window.dispatchEvent(new Event('vibelink:cookie-settings')); }}>
              Cookie settings
            </a>
          </span>
          <span>Kabarnet, Baringo County, Kenya · <a href={`mailto:${SALES_EMAIL}`} style={{ color: 'inherit' }}>{SALES_EMAIL}</a></span>
        </div>
      </footer>
    </div>
  );
}
