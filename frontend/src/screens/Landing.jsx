import React, { useEffect, useState } from 'react';

/**
 * The public page of the platform, shown on the root domain only.
 *
 * The root domain belongs to no tenant, so there is nothing here to sign into: an ISP registers, and every day after
 * that works on their own subdomain.
 *
 * Written to read like a company that runs an ISP and sells the tool it uses, not a SaaS template: warm paper instead of
 * white-and-blue, one typeface family, hard rules instead of shadowed cards, no icons-on-tiles grid, no scroll
 * animation, no gradients. Plain sentences about what happens, real screens, and a phone number. The palette is the one
 * the vibelink.co.ke site uses (taken from the logo), so the two read as the same company.
 */

const PHONE = '0112 009 226';
const PHONE_LINK = 'tel:+254112009226';
const WHATSAPP = 'https://wa.me/254112009226';
const SALES_EMAIL = 'sales@vibelink.co.ke';

const C = {
  paper: '#FBF8F2', sand: '#F0EADF', ink: '#1A211C', stone: '#5D645C', rule: '#D9D2C3',
  green: '#0D6E43', deep: '#093B27', tint: '#E3EFE8', red: '#D81E28',
};

const WHAT_IT_DOES = [
  ['Money', [
    ['M-Pesa lands on the right account.',
     'Paybill, till and STK push. A payment is matched to the account number the customer typed. The ones that do not match are put in front of you instead of being lost.'],
    ['No paybill yet? We collect for you.',
     'Customers pay into our paybill from day one, PPPoE or hotspot. We pay you out in full, daily or weekly, to your own M-Pesa number. Nothing is taken from the payout.'],
    ['The SMS says what actually happened.',
     'Full payment, part payment, a voucher or a top-up each get their own message, with the balance owed on it.'],
  ]],
  ['Routers', [
    ['MikroTik without the console.',
     'Point a router at us over a tunnel. No public IP and no port forwarding. RADIUS, PPPoE, hotspot, DHCP and the firewall rules are pushed for you.'],
    ['Plan changes and cut-offs happen at once.',
     'Change a plan and the live session changes with it. An expired line is cut without anyone ringing the customer.'],
    ['Fair use that applies itself.',
     'Set the cap and the throttle. It lifts on its own when the window rolls over.'],
  ]],
  ['Customers', [
    ['A portal with your name on it.',
     'Guests buy a bundle with M-Pesa and get a code by SMS without making an account. Customers see their own balance and invoices.'],
    ['Tickets, chat and installs.',
     'Support tickets with timers, a chat window on your portal, and a calendar to book technicians for installations and repairs.'],
    ['Leads that credit the right person.',
     'A new customer credits whoever brought them in, and the commission is worked out on the package they chose.'],
  ]],
  ['Your team', [
    ['A login for everyone, not a shared password.',
     'Cashiers, technicians and support staff each have their own login. What they can see and do is enforced, not just labelled.'],
    ['Technicians on the phone.',
     'A field app for jobs, photos, equipment and customer look-up, with the location recorded only while they are on shift.'],
    ['Payroll and expenses.',
     'Salaries and commissions worked out each cycle. Expenses logged with a receipt and approved before anyone is paid.'],
  ]],
];

const SERVICES = [
  ['Fibre to the home',
   'For estates and residential clusters. We build the distribution; you sell the packages and keep the customer.'],
  ['Fibre to buildings and business',
   'Apartment blocks, offices and business parks, with the capacity and the service level a paying tenant expects.'],
  ['Bulk bandwidth for ISPs',
   'Wholesale bandwidth and IP transit by the megabit. Burst when your evening peak needs it instead of paying for the peak all month.'],
];

/** Captured from the real app against made-up customers. */
const SCREENS = [
  ['/screens/dashboard.png', 'Dashboard', "Today's collections, who is online, and the last seven days by payment channel."],
  ['/screens/clients.png', 'Clients', 'Every PPPoE customer, whether they are paid up, and when they last connected.'],
  ['/screens/routers.png', 'Routers', 'Each MikroTik, whether it is up, and one click to set it up again.'],
];

/** Where payments already work, and how customers pay there. Kenya is long-established; the rest are newer. */
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
  ['Which routers does it work with?',
   'MikroTik. We set up RADIUS, PPPoE, hotspot, DHCP and the firewall rules for you.'],
  ['Can customers pay a way you do not support?',
   'Yes. Cash, a till with no API or a bank deposit can be recorded by hand against the customer, and it goes through the same matching as an automatic payment.'],
  ['Whose customers are they?',
   'Yours. Your customers, their numbers and their payments sit in your own account on your own address. We do not contact them.'],
  ['What does it cost to start?',
   'Nothing up front. Register and use it free until the 5th of the month after you sign up; from then you are billed each month as shown above. There is no card to enter.'],
  ['Is there somebody to ring if it goes wrong?',
   'Yes. We run an ISP ourselves and use this every day. Call or WhatsApp ' + PHONE + '.'],
];

const STEPS = [
  ['Register', 'Choose a name and a subdomain. It takes a minute.'],
  ['Add a router', 'Paste one line into your MikroTik. It connects on its own.'],
  ['Add customers', 'Or import the PPPoE accounts already on the router.'],
  ['Get paid', 'Connect M-Pesa and let the matching run.'],
];

/** What the platform charges in each billing mode, worked out for a given ISP. */
function platformFee({ pppoe, avgFee, hotspot }) {
  const usage = Math.round(hotspot * 0.035 + pppoe * 20);
  const takings = pppoe * avgFee + hotspot;
  const tier = takings < 10000 ? 1000 : takings <= 20000 ? 2000 : 3000;
  return { usage, tier, takings };
}

export default function Landing({ onRegister }) {
  const [mode, setMode] = useState('usage');
  const [calc, setCalc] = useState({ pppoe: '120', avgFee: '2000', hotspot: '30000' });
  const num = (v) => Math.max(0, Number(v) || 0);
  const fee = platformFee({ pppoe: num(calc.pppoe), avgFee: num(calc.avgFee), hotspot: num(calc.hotspot) });
  const cheaper = fee.usage <= fee.tier ? 'usage' : 'tier';
  const best = Math.min(fee.usage, fee.tier);
  const kes = (n) => 'KES ' + Math.round(n).toLocaleString('en-KE');

  // Set here rather than in index.html: that file is also served to every tenant's sign-in page, and a canonical
  // pointing them at this page would tell Google those pages are duplicates of it.
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'canonical';
    link.href = `https://${window.location.hostname.replace(/^www\./, '')}/`;
    document.head.appendChild(link);
    const font = document.createElement('link');
    font.rel = 'stylesheet';
    font.href = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;500;600;700&display=swap';
    document.head.appendChild(font);
    return () => { link.remove(); font.remove(); };
  }, []);

  const wrap = { maxWidth: 1180, margin: '0 auto', padding: '0 24px' };
  const display = { fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif", fontWeight: 700, letterSpacing: '.005em', lineHeight: 1.04 };
  const btn = {
    display: 'inline-block', border: 0, borderRadius: 3, padding: '13px 22px', fontSize: 16, fontWeight: 600,
    fontFamily: 'inherit', cursor: 'pointer', textDecoration: 'none',
  };

  return (
    <div style={{ minHeight: '100vh', background: C.paper, color: C.ink, fontFamily: "'Barlow', system-ui, sans-serif", fontSize: 17, lineHeight: 1.6 }}>
      <style>{`
        .vl-two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 56px; align-items: start; }
        .vl-quad { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 56px; }
        .vl-tri { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 40px; }
        .vl-steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 32px; }
        .vl-nav-phone { display: inline; }
        a.vl-link { color: ${C.green}; }
        a.vl-link:hover { color: ${C.deep}; }
        .vl-btn-solid:hover { background: ${C.deep} !important; }
        .vl-btn-line:hover { background: ${C.sand} !important; }
        @media (max-width: 880px) {
          .vl-two, .vl-quad, .vl-tri, .vl-steps { grid-template-columns: minmax(0, 1fr); gap: 28px; }
          .vl-nav-phone { display: none; }
          .vl-h1 { font-size: 44px !important; }
        }
      `}</style>

      {/* top bar */}
      <header style={{ background: C.paper, borderBottom: `1px solid ${C.rule}` }}>
        <div style={{ ...wrap, display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64 }}>
          <span style={{ ...display, fontSize: 28, color: C.green }}>Vibelink</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <a href={PHONE_LINK} className="vl-nav-phone" style={{ color: C.ink, textDecoration: 'none', fontWeight: 600 }}>Call {PHONE}</a>
            <button type="button" onClick={onRegister} className="vl-btn-solid" style={{ ...btn, background: C.green, color: '#fff', padding: '9px 18px', fontSize: 15 }}>
              Register your ISP
            </button>
          </span>
        </div>
      </header>

      {/* opening */}
      <section style={{ ...wrap, padding: '64px 24px 56px' }}>
        <div className="vl-two" style={{ alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600, color: C.red, marginBottom: 12, letterSpacing: '.04em', textTransform: 'uppercase', fontSize: 14 }}>
              Billing for ISPs in Kenya
            </div>
            <h1 className="vl-h1" style={{ ...display, fontSize: 64, margin: '0 0 20px' }}>
              Stop chasing <span style={{ whiteSpace: 'nowrap' }}>M-Pesa</span> receipts.<br />Run your ISP from one screen.
            </h1>
            <p style={{ color: C.stone, fontSize: 19, margin: '0 0 28px', maxWidth: 520 }}>
              Vibelink bills your PPPoE and hotspot customers, matches every M-Pesa payment to the right account, and
              talks to your MikroTik routers so speeds and cut-offs happen by themselves. We built it to run our own
              network in Baringo, and now other ISPs use it too.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button type="button" onClick={onRegister} className="vl-btn-solid" style={{ ...btn, background: C.green, color: '#fff' }}>
                Register your ISP
              </button>
              <a href={PHONE_LINK} className="vl-btn-line" style={{ ...btn, background: 'transparent', color: C.ink, border: `1.5px solid ${C.ink}` }}>
                Call {PHONE}
              </a>
            </div>
            <p style={{ fontSize: 15, color: C.stone, margin: '16px 0 0' }}>
              No card needed. Your own address, like <b>yourname.vibelink.tech</b>, works as soon as you register.
            </p>
          </div>
          <figure style={{ margin: 0 }}>
            <img src="/screens/dashboard.png" alt="The Vibelink dashboard" width="1440" height="900"
                 style={{ display: 'block', width: '100%', height: 'auto', border: `1px solid ${C.rule}`, borderRadius: 3 }} />
            <figcaption style={{ fontSize: 14, color: C.stone, marginTop: 8 }}>
              The dashboard, with made-up customers. Collections, who is online, and takings by channel.
            </figcaption>
          </figure>
        </div>
      </section>

      {/* what it does */}
      <section style={{ background: C.sand, borderTop: `1px solid ${C.rule}`, borderBottom: `1px solid ${C.rule}` }}>
        <div style={{ ...wrap, padding: '56px 24px 40px' }}>
          <h2 style={{ ...display, fontSize: 40, margin: '0 0 8px' }}>What it does for you</h2>
          <p style={{ color: C.stone, margin: '0 0 36px', maxWidth: 620 }}>
            The jobs that eat an ISP's week, in the order they usually hurt.
          </p>
          <div className="vl-quad">
            {WHAT_IT_DOES.map(([group, items]) => (
              <div key={group} style={{ marginBottom: 36 }}>
                <div style={{ ...display, fontSize: 24, color: C.green, borderBottom: `2px solid ${C.green}`, paddingBottom: 6, marginBottom: 6 }}>{group}</div>
                {items.map(([lead, text]) => (
                  <div key={lead} style={{ padding: '14px 0', borderBottom: `1px solid ${C.rule}` }}>
                    <div style={{ fontWeight: 700 }}>{lead}</div>
                    <div style={{ color: C.stone, fontSize: 16 }}>{text}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* try it */}
      <section style={{ ...wrap, padding: '44px 24px' }}>
        <div className="vl-two" style={{ alignItems: 'center', border: `1.5px solid ${C.ink}`, padding: '26px 30px', borderRadius: 3, background: '#fff' }}>
          <div>
            <h3 style={{ ...display, fontSize: 30, margin: '0 0 6px' }}>Try it before you register</h3>
            <p style={{ margin: 0, color: C.stone, fontSize: 16 }}>
              A demo ISP full of made-up routers, customers and leads. It resets itself every hour, so click anything.
            </p>
          </div>
          <div style={{ fontSize: 16 }}>
            <div><b>Address:</b> <a className="vl-link" href="https://demo.vibelink.tech" target="_blank" rel="noreferrer">demo.vibelink.tech</a></div>
            <div><b>Email:</b> demo@vibelink.tech</div>
            <div><b>Password:</b> demo@123</div>
          </div>
        </div>
      </section>

      {/* screens */}
      <section style={{ ...wrap, padding: '20px 24px 56px' }}>
        <h2 style={{ ...display, fontSize: 40, margin: '0 0 8px' }}>What you will be looking at</h2>
        <p style={{ color: C.stone, margin: '0 0 32px' }}>Real screens from the app. The customers are made up.</p>
        <div style={{ display: 'grid', gap: 44 }}>
          {SCREENS.slice(1).map(([src, title, caption]) => (
            <figure key={src} style={{ margin: 0 }}>
              <img src={src} alt={`${title} screen`} loading="lazy" width="1440" height="900"
                   style={{ display: 'block', width: '100%', height: 'auto', border: `1px solid ${C.rule}`, borderRadius: 3 }} />
              <figcaption style={{ marginTop: 10, color: C.stone, fontSize: 16 }}>
                <b style={{ color: C.ink }}>{title}.</b> {caption}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* pricing */}
      <section style={{ ...wrap, padding: '20px 24px 56px' }}>
        <h2 style={{ ...display, fontSize: 40, margin: '0 0 8px' }}>What it costs</h2>
        <p style={{ color: C.stone, margin: '0 0 22px', maxWidth: 640 }}>
          You choose how you are billed, and can ask us to change it. Nothing is charged until the 5th of the month after you register.
        </p>
        <div style={{ display: 'flex', gap: 0, marginBottom: 22 }}>
          {[['usage', 'Pay by use'], ['tier', 'Flat tier']].map(([k, label]) => (
            <button key={k} type="button" onClick={() => setMode(k)}
                    style={{ ...btn, padding: '9px 20px', fontSize: 15, borderRadius: 0, border: `1.5px solid ${C.ink}`,
                             background: mode === k ? C.ink : 'transparent', color: mode === k ? '#fff' : C.ink }}>
              {label}
            </button>
          ))}
        </div>
        {mode === 'usage' ? (
          <div className="vl-tri">
            <div style={{ borderTop: `2px solid ${C.green}`, paddingTop: 12 }}>
              <div style={{ ...display, fontSize: 40 }}>KES 20</div>
              <div style={{ fontWeight: 700 }}>per active PPPoE customer, each month</div>
              <div style={{ color: C.stone, fontSize: 16 }}>Only customers who are active that month count. Someone you have suspended does not.</div>
            </div>
            <div style={{ borderTop: `2px solid ${C.green}`, paddingTop: 12 }}>
              <div style={{ ...display, fontSize: 40 }}>3.5%</div>
              <div style={{ fontWeight: 700 }}>of your hotspot sales</div>
              <div style={{ color: C.stone, fontSize: 16 }}>Taken from the hotspot vouchers you sell that month. Nothing on a month with no sales.</div>
            </div>
            <div style={{ borderTop: `2px solid ${C.green}`, paddingTop: 12 }}>
              <div style={{ ...display, fontSize: 40 }}>KES 0</div>
              <div style={{ fontWeight: 700 }}>to set up</div>
              <div style={{ color: C.stone, fontSize: 16 }}>No setup fee, no contract, no card. Leave whenever you like.</div>
            </div>
          </div>
        ) : (
          <div className="vl-tri">
            {[['KES 1,000', 'Under KES 10,000 collected a month'], ['KES 2,000', 'KES 10,000 to 20,000 collected a month'], ['KES 3,000', 'Over KES 20,000 collected a month']].map(([price, when]) => (
              <div key={price} style={{ borderTop: `2px solid ${C.green}`, paddingTop: 12 }}>
                <div style={{ ...display, fontSize: 40 }}>{price}</div>
                <div style={{ fontWeight: 700 }}>a month</div>
                <div style={{ color: C.stone, fontSize: 16 }}>{when}, hotspot and PPPoE together. It stops at KES 3,000 however much you grow.</div>
              </div>
            ))}
          </div>
        )}
        <p style={{ color: C.stone, fontSize: 14.5, marginTop: 14 }}>
          These are the standard rates. If your business does not fit either, ask us for a flat monthly fee.
        </p>

        {/* calculator */}
        <div style={{ marginTop: 34, border: `1.5px solid ${C.ink}`, background: '#fff', padding: '24px 28px', borderRadius: 3 }}>
          <h3 style={{ ...display, fontSize: 28, margin: '0 0 4px' }}>Work out what it would cost you</h3>
          <p style={{ margin: '0 0 18px', color: C.stone, fontSize: 16 }}>Type in your own numbers. Nothing is saved.</p>
          <div className="vl-tri" style={{ gap: 20, marginBottom: 20 }}>
            {[['pppoe', 'Active PPPoE customers'], ['avgFee', 'Average monthly fee (KES)'], ['hotspot', 'Hotspot sales a month (KES)']].map(([k, label]) => (
              <label key={k} style={{ display: 'grid', gap: 4, fontSize: 15, fontWeight: 600 }}>
                {label}
                <input type="number" min="0" value={calc[k]} onChange={(e) => setCalc((c) => ({ ...c, [k]: e.target.value }))}
                       style={{ font: 'inherit', fontWeight: 500, padding: '10px 12px', border: `1.5px solid ${C.rule}`, borderRadius: 3, background: C.paper }} />
              </label>
            ))}
          </div>
          <div className="vl-two" style={{ gap: 20 }}>
            {[['usage', 'Pay by use', fee.usage], ['tier', 'Flat tier', fee.tier]].map(([k, label, amount]) => (
              <div key={k} style={{ padding: '14px 16px', background: cheaper === k ? C.tint : C.sand, borderRadius: 3, border: cheaper === k ? `1.5px solid ${C.green}` : '1.5px solid transparent' }}>
                <div style={{ fontSize: 14, color: C.stone }}>{label}{cheaper === k ? ' · the lower of the two' : ''}</div>
                <div style={{ ...display, fontSize: 34 }}>{kes(amount)} <span style={{ fontSize: 17, fontFamily: 'Barlow, sans-serif', fontWeight: 500, color: C.stone }}>a month</span></div>
              </div>
            ))}
          </div>
          <p style={{ margin: '14px 0 0', color: C.stone, fontSize: 15 }}>
            On about {kes(fee.takings)} collected a month, that is roughly {fee.takings ? (best / fee.takings * 100).toFixed(1) : '0'}% of what you take in.
          </p>
        </div>
      </section>

      {/* countries */}
      <section style={{ background: C.sand, borderTop: `1px solid ${C.rule}`, borderBottom: `1px solid ${C.rule}` }}>
        <div style={{ ...wrap, padding: '52px 24px' }}>
          <h2 style={{ ...display, fontSize: 40, margin: '0 0 8px' }}>Not only Kenya</h2>
          <p style={{ color: C.stone, margin: '0 0 28px', maxWidth: 640 }}>
            Each ISP picks its country, so phone numbers, prices and payment methods follow it. Kenya has been running for a long time.
            The countries below are newer, so tell us when you register and we will help you switch your payments on and test them.
          </p>
          <div className="vl-quad" style={{ gap: '0 56px' }}>
            {COUNTRIES.map(([name, currency, how]) => (
              <div key={name} style={{ padding: '12px 0', borderBottom: `1px solid ${C.rule}`, display: 'grid', gridTemplateColumns: '130px 1fr', gap: 12 }}>
                <div><b>{name}</b> <span style={{ color: C.stone, fontSize: 14 }}>{currency}</span></div>
                <div style={{ color: C.stone, fontSize: 16 }}>{how}</div>
              </div>
            ))}
          </div>
          <p style={{ marginTop: 22 }}>
            Somewhere else in Africa? <a className="vl-link" href={`mailto:${SALES_EMAIL}?subject=Vibelink%20in%20my%20country`}>Tell us the country</a> and which payment methods your customers use.
          </p>
        </div>
      </section>

      {/* questions */}
      <section style={{ ...wrap, padding: '52px 24px 20px' }}>
        <h2 style={{ ...display, fontSize: 40, margin: '0 0 22px' }}>Questions people ask first</h2>
        <div style={{ maxWidth: 820 }}>
          {FAQ.map(([q, a]) => (
            <details key={q} style={{ borderTop: `1px solid ${C.rule}`, padding: '14px 0' }}>
              <summary style={{ fontWeight: 700, cursor: 'pointer', fontSize: 18 }}>{q}</summary>
              <p style={{ margin: '8px 0 0', color: C.stone }}>{a}</p>
            </details>
          ))}
          <div style={{ borderTop: `1px solid ${C.rule}` }} />
        </div>
      </section>

      {/* capacity */}
      <section style={{ background: C.deep, color: '#fff' }}>
        <div style={{ ...wrap, padding: '56px 24px' }}>
          <h2 style={{ ...display, fontSize: 40, margin: '0 0 8px' }}>We sell the bandwidth too</h2>
          <p style={{ color: 'rgba(255,255,255,.75)', margin: '0 0 32px', maxWidth: 620 }}>
            We run a network, so the billing and the capacity can come from the same people.
          </p>
          <div className="vl-tri">
            {SERVICES.map(([title, text]) => (
              <div key={title} style={{ borderTop: '2px solid rgba(255,255,255,.5)', paddingTop: 14 }}>
                <div style={{ ...display, fontSize: 26, marginBottom: 6 }}>{title}</div>
                <div style={{ color: 'rgba(255,255,255,.78)', fontSize: 16 }}>{text}</div>
              </div>
            ))}
          </div>
          <p style={{ marginTop: 30, color: 'rgba(255,255,255,.8)' }}>
            Coverage and prices: <a href={`mailto:${SALES_EMAIL}`} style={{ color: '#fff', fontWeight: 600 }}>{SALES_EMAIL}</a>
          </p>
        </div>
      </section>

      {/* steps */}
      <section style={{ ...wrap, padding: '56px 24px' }}>
        <h2 style={{ ...display, fontSize: 40, margin: '0 0 28px' }}>Getting started</h2>
        <div className="vl-steps">
          {STEPS.map(([title, text], i) => (
            <div key={title} style={{ borderTop: `2px solid ${C.ink}`, paddingTop: 12 }}>
              <div style={{ ...display, fontSize: 44, color: C.red }}>{i + 1}</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{title}</div>
              <div style={{ color: C.stone, fontSize: 16 }}>{text}</div>
            </div>
          ))}
        </div>
      </section>

      {/* a person to ring */}
      <section style={{ background: C.sand, borderTop: `1px solid ${C.rule}` }}>
        <div style={{ ...wrap, padding: '44px 24px' }}>
          <div className="vl-two" style={{ alignItems: 'center' }}>
            <div>
              <h2 style={{ ...display, fontSize: 36, margin: '0 0 8px' }}>Questions? Ring us.</h2>
              <p style={{ margin: 0, color: C.stone }}>
                We are an ISP in Kabarnet, Baringo County. If something in the app does not make sense, ask the people who use it every day.
              </p>
            </div>
            <div style={{ fontSize: 18 }}>
              <div><a className="vl-link" href={PHONE_LINK} style={{ fontWeight: 700 }}>{PHONE}</a> <span style={{ color: C.stone }}>(call or WhatsApp)</span></div>
              <div><a className="vl-link" href={WHATSAPP} target="_blank" rel="noreferrer">Message us on WhatsApp</a></div>
              <div><a className="vl-link" href={`mailto:${SALES_EMAIL}`}>{SALES_EMAIL}</a></div>
            </div>
          </div>
        </div>
      </section>

      <footer style={{ borderTop: `1px solid ${C.rule}` }}>
        <div style={{ ...wrap, padding: '20px 24px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, fontSize: 14, color: C.stone }}>
          <span>
            © {new Date().getFullYear()} Vibelink Telecommunications Ltd ·{' '}
            <a href="#cookies" style={{ color: 'inherit' }}
               onClick={(e) => { e.preventDefault(); window.dispatchEvent(new Event('vibelink:cookie-settings')); }}>
              Cookie settings
            </a>
          </span>
          <span>Kabarnet, Baringo County, Kenya · <a href="mailto:support@vibelink.co.ke" style={{ color: 'inherit' }}>support@vibelink.co.ke</a></span>
        </div>
      </footer>
    </div>
  );
}
