import React, { useEffect } from 'react';

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

const STEPS = [
  ['Register', 'Choose a name and a subdomain. It takes a minute.'],
  ['Add a router', 'Paste one line into your MikroTik. It connects on its own.'],
  ['Add customers', 'Or import the PPPoE accounts already on the router.'],
  ['Get paid', 'Connect M-Pesa and let the matching run.'],
];

export default function Landing({ onRegister }) {
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
              Stop chasing M-Pesa receipts.<br />Run your ISP from one screen.
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
