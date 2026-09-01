import React from 'react';
import { color, font, radius } from '../theme/tokens';

/**
 * The public face of the platform, shown on the root domain only.
 *
 * The root domain belongs to no tenant, so there is nothing here to sign into:
 * an ISP registers, and every day after that they use their own subdomain.
 * Keeping the two apart is what stops an operator landing on vibelink.tech and
 * wondering why their customers are missing.
 *
 * Deliberately plain markup and inline styles, matching the rest of the app.
 * The audience is a network operator, not a consumer — the terminal-style
 * panel and monospace tags below are drawn from the product itself (this is
 * the same JetBrains Mono the real app uses for MAC addresses, routers and
 * money), not decoration borrowed from a generic SaaS template.
 */

const SALES_EMAIL = 'sales@vibelink.co.ke';
const SUPPORT_EMAIL = 'support@vibelink.co.ke';

/**
 * One accent per category, reused where there are more categories than
 * brand hues — a colour here means something (which group a card belongs
 * to), so repeating a hue on two categories is fine; inventing a fifth or
 * sixth off-brand colour just to keep every one distinct would not be.
 */
const CATEGORY_COLOR = {
  PAYMENTS: color.green,
  NETWORK: color.mint,
  HOTSPOT: color.amber,
  OPERATIONS: color.rust,
  SUPPORT: color.mint,
  GROWTH: color.amber,
};

const FEATURES = [
  ['PAYMENTS', 'M-Pesa that reconciles itself',
   'Paybill, till and STK push. Payments match to the account number the customer typed, and the ones that do not are put in front of you rather than lost.'],
  ['PAYMENTS', 'No paybill yet? We collect for you',
   'Turn on collection and your customers pay into our paybill from day one, PPPoE or hotspot — we pay you out nightly, net of a small commission, straight to your own M-Pesa number.'],
  ['NETWORK', 'MikroTik without the console',
   'Point a router at us over a tunnel — no public IP, no port forwarding. RADIUS, PPPoE, hotspot, DHCP and the firewall rules are pushed for you.'],
  ['NETWORK', 'Speed changes that land now',
   'Change a plan and the session changes with it. No waiting for the customer to reconnect, no ringing them to ask.'],
  ['NETWORK', 'Fair use that enforces itself',
   'Set the cap and the throttle. It applies quietly and lifts when the window rolls over.'],
  ['HOTSPOT', 'A captive portal that sells',
   'A captive portal with your name on it. Guests buy a bundle with M-Pesa and get a code by SMS, without an account and without leaving the page.'],
  ['OPERATIONS', 'Every router accounted for',
   'Track gadgets by MAC and serial, issue one to a technician and it comes off the shelf automatically, mark a faulty unit and swap it in one step, and know at a glance whether the customer paid for it or it is still yours.'],
  ['OPERATIONS', 'Answers when something breaks',
   'Which tower is down, who is online, what each port is carrying, and where every customer lives on a map.'],
  ['OPERATIONS', 'A team, not a shared password',
   'Invite cashiers, technicians and support staff by phone or email — they pick their own username and password. Roles are enforced, not just labelled, and only an owner can ever remove another owner.'],
  ['SUPPORT', 'Support that stays out of your DMs',
   'Tickets, a live chat widget on your own portal, and SLA timers that flag a job before it breaches — not a WhatsApp thread nobody can search later.'],
  ['SUPPORT', 'Everyone, on one map',
   'Every site, router and customer plotted where they actually are. Send a technician to a job knowing exactly what is already there.'],
  ['GROWTH', 'Grow the list, not just serve it',
   'Leads, SMS and email campaigns, and the routine follow-ups running themselves — so selling the next customer is not a second full-time job.'],
];

/**
 * What Vibelink sells besides the software.
 *
 * An ISP evaluating a billing system is also deciding who to buy capacity
 * from, and they are the same conversation. Kept separate from the software
 * features so neither reads as filler for the other.
 */
const SERVICES = [
  ['FTTH — homes',
   'Fibre to the home for estates and residential clusters. We build the '
   + 'distribution, you sell the packages and keep the customer.'],
  ['FTTB — buildings and business',
   'Fibre to apartment blocks, offices and business parks, with the capacity '
   + 'and the SLA a paying tenant expects.'],
  ['Bulk internet for ISPs',
   'Wholesale bandwidth and IP transit by the megabit, on your own capacity '
   + 'plan. Burst when your evening peak needs it rather than paying for peak '
   + 'all month.'],
];

const STEPS = [
  ['Register', 'Pick your name and your subdomain. Takes a minute.'],
  ['Add a router', 'Paste one line into your MikroTik. It dials in on its own.'],
  ['Add customers', 'Or import the PPPoE accounts already on the router.'],
  ['Get paid', 'Connect M-Pesa and let the reconciliation run.'],
];

/** The terminal panel's script, typed once, no loop — a demo, not a toy. */
const CONSOLE_LINES = [
  { p: '$', t: 'mikrotik/system  script add source=vibelink-connect' },
  { p: '>', t: 'tunnel up — RB750Gr3 dialed in, no port forward needed', d: true },
  { p: '>', t: '412 PPPoE, 86 hotspot online', d: true },
  { p: '>', t: 'KES 41,200 collected today, 3 unmatched → review', d: true },
];

const Section = ({ children, style }) => (
  <section style={{ maxWidth: 1320, margin: '0 auto', padding: '0 32px', ...style }}>
    {children}
  </section>
);

export default function Landing({ onRegister }) {
  return (
    <div style={{
      minHeight: '100vh', background: color.pageBg, color: color.ink,
      fontFamily: font.sans, fontSize: 15, lineHeight: 1.55,
    }}>
      {/* Scoped to this page. Restrained on purpose: a border-colour change on
          hover, nothing that moves on its own or asks to be noticed. */}
      <style>{`
        .vl-card { transition: background .15s ease; }
        .vl-card:hover { background: ${color.subtleBg}; }
        .vl-btn { transition: background .15s ease, border-color .15s ease, opacity .15s ease; }
        .vl-solid:hover { background: ${color.greenDark}; }
        .vl-ghost:hover { border-color: ${color.green}; color: ${color.green}; }
        .vl-cta-btn:hover { background: #eef2ef; }
      `}</style>

      <header style={{ borderBottom: `1px solid ${color.line}`, background: color.cardBg }}>
        <Section style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          height: 62, padding: '0 22px',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 700, fontSize: 18, letterSpacing: '-.01em' }}>
            <span style={{
              width: 24, height: 24, borderRadius: radius.sm, display: 'grid', placeItems: 'center',
              background: color.green, color: '#fff', fontSize: 13, fontFamily: font.mono,
            }}>V</span>
            Vibelink
          </span>
          {/* No sign-in here. This domain is the website, not the product:
              nobody's customers live on it, and every ISP works on their own
              subdomain. A sign-in button invites people to try signing in
              somewhere that cannot authenticate them. */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <a href={`mailto:${SALES_EMAIL}`} className="vl-btn vl-ghost" style={{ ...ghost, textDecoration: 'none' }}>
              Talk to sales
            </a>
            <button type="button" onClick={onRegister} className="vl-btn vl-solid" style={solid}>Register</button>
          </div>
        </Section>
      </header>

      <div style={{
        position: 'relative',
        backgroundImage: `radial-gradient(${color.line} 1.1px, transparent 1.1px)`,
        backgroundSize: '22px 22px',
        backgroundPosition: '-11px -11px',
      }}>
        {/* Fades the dot texture out toward the bottom of the hero so it reads
            as ground beneath the content, not a tiled pattern stopping at a
            hard edge. */}
        <div aria-hidden style={{
          position: 'absolute', inset: 0,
          background: `linear-gradient(180deg, ${color.pageBg}00 0%, ${color.pageBg} 92%)`,
        }} />
      <Section style={{ position: 'relative', padding: '58px 22px 50px' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,.9fr)',
          gap: 48, alignItems: 'center',
        }}>
          <div>
            <div style={{
              fontFamily: font.mono, fontSize: 12.5, color: color.green, fontWeight: 600,
              letterSpacing: '.02em', marginBottom: 16,
            }}>
              // for Kenyan ISPs
            </div>
            <h1 style={{ fontSize: 42, lineHeight: 1.14, margin: '0 0 16px', letterSpacing: '-.02em' }}>
              Billing, fibre and bandwidth,<br />run like infrastructure.
            </h1>
            <p style={{ fontSize: 16.5, color: color.inkSoft, maxWidth: 480, margin: '0 0 26px' }}>
              Run PPPoE and hotspot customers on your MikroTik, take M-Pesa, and stop
              reconciling payments by hand — and buy your FTTH, FTTB and bulk capacity
              from the same people. Your own portal on your own subdomain.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" onClick={onRegister} className="vl-btn vl-solid" style={{ ...solid, padding: '12px 22px', fontSize: 15 }}>
                Start free
              </button>
              <a href={`mailto:${SALES_EMAIL}`}
                 className="vl-btn vl-ghost"
                 style={{ ...ghost, padding: '12px 22px', fontSize: 15, textDecoration: 'none' }}>
                Talk to sales
              </a>
            </div>
            <p style={{ fontSize: 13, color: color.muted, marginTop: 14 }}>
              No card. Your subdomain is live as soon as you register.
            </p>
          </div>

          {/* A real shape of what "add a router" actually produces, not a stock
              screenshot or an abstract graphic — the same MikroTik-tunnel and
              reconciliation language the rest of the page uses, just shown
              rather than told. */}
          <div style={{
            background: color.ink, borderRadius: radius.md, padding: '18px 20px',
            fontFamily: font.mono, fontSize: 12.8, lineHeight: 1.9,
            boxShadow: '0 1px 0 rgba(0,0,0,.03)',
          }}>
            <div style={{ display: 'flex', gap: 7, marginBottom: 10 }}>
              {['#e6675a', '#e0b64a', '#5cb377'].map((c) => (
                <span key={c} style={{ width: 9, height: 9, borderRadius: '50%', background: c }} />
              ))}
            </div>
            {CONSOLE_LINES.map((l, i) => (
              <div key={i} style={{ color: l.d ? '#8fd6b4' : '#fff', opacity: l.d ? .9 : 1 }}>
                <span style={{ color: color.mint, marginRight: 8 }}>{l.p}</span>{l.t}
              </div>
            ))}
            <div style={{ color: color.mint, marginTop: 2 }}>
              <span style={{ marginRight: 8 }}>$</span>
              <span style={{ borderRight: '2px solid currentColor', paddingRight: 2 }}>&nbsp;</span>
            </div>
          </div>
        </div>
      </Section>
      </div>

      <div style={{ borderTop: `1px solid ${color.line}`, borderBottom: `1px solid ${color.line}` }}>
        <Section style={{ padding: '40px 22px' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: 1,
            background: color.line,
          }}>
            {FEATURES.map(([tag, title, body]) => (
              <div key={title} className="vl-card" style={{
                background: color.cardBg, borderTop: `2.5px solid ${CATEGORY_COLOR[tag]}`,
                padding: '20px 20px 22px',
              }}>
                <div style={{
                  fontFamily: font.mono, fontSize: 11, fontWeight: 700, color: CATEGORY_COLOR[tag],
                  letterSpacing: '.06em', marginBottom: 10,
                }}>
                  {tag}
                </div>
                <h3 style={{ margin: '0 0 6px', fontSize: 15.5 }}>{title}</h3>
                <p style={{ margin: 0, fontSize: 14, color: color.inkSoft }}>{body}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Section style={{ padding: '52px 22px' }}>
        <h2 style={{ fontSize: 22, margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: color.amber, display: 'inline-block' }} />
          Capacity, not just software
        </h2>
        <p style={{ color: color.inkSoft, maxWidth: 620, margin: '0 0 24px', fontSize: 15 }}>
          We build and sell the connectivity too, so the billing and the bandwidth
          come from one place.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
          {SERVICES.map(([title, body]) => (
            <div key={title} className="vl-card" style={{
              border: `1px solid ${color.line}`, borderRadius: radius.md,
              padding: '18px 18px 20px', background: color.cardBg,
            }}>
              <h3 style={{ margin: '0 0 6px', fontSize: 15.5 }}>{title}</h3>
              <p style={{ margin: 0, fontSize: 14, color: color.inkSoft }}>{body}</p>
            </div>
          ))}
        </div>
        <p style={{ marginTop: 18, fontSize: 13.5, color: color.muted }}>
          Talk to us about coverage and pricing: <a href={`mailto:${SALES_EMAIL}`} style={{ color: color.green }}>{SALES_EMAIL}</a>
        </p>
      </Section>

      <div style={{ borderTop: `1px solid ${color.line}`, borderBottom: `1px solid ${color.line}`, background: color.subtleBg }}>
        <Section style={{ padding: '48px 22px' }}>
          <h2 style={{ fontSize: 22, margin: '0 0 24px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: color.green, display: 'inline-block' }} />
            Getting started
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
            {STEPS.map(([title, body], i) => (
              <div key={title}>
                <div style={{
                  fontFamily: font.mono, fontSize: 12.5, color: color.green, fontWeight: 700, marginBottom: 8,
                }}>
                  {String(i + 1).padStart(2, '0')}
                </div>
                <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>{title}</h3>
                <p style={{ margin: 0, fontSize: 13.5, color: color.inkSoft }}>{body}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Section style={{ padding: '54px 22px 64px' }}>
        <div style={{
          background: color.greenDark, borderRadius: radius.md, padding: '38px 34px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 18,
          backgroundImage: `radial-gradient(rgba(255,255,255,.05) 1.1px, transparent 1.1px)`,
          backgroundSize: '18px 18px',
        }}>
          <div>
            <h2 style={{ fontSize: 23, margin: '0 0 6px', color: '#fff' }}>Ready when you are</h2>
            <p style={{ color: 'rgba(255,255,255,.78)', margin: 0, maxWidth: 420 }}>
              Register, add one router, and see your own customers on your own portal.
            </p>
          </div>
          <button
            type="button" onClick={onRegister} className="vl-btn vl-cta-btn"
            style={{ background: '#fff', color: color.greenDark, border: 0, borderRadius: radius.sm,
                     padding: '12px 24px', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
          >
            Create your account
          </button>
        </div>
      </Section>

      <footer style={{ borderTop: `1px solid ${color.line}`, background: color.cardBg }}>
        <Section style={{
          padding: '20px 22px', display: 'flex', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: 10, fontSize: 13, color: color.muted,
        }}>
          <span>© {new Date().getFullYear()} Vibelink</span>
          <span>Nairobi, Kenya · {SUPPORT_EMAIL}</span>
        </Section>
      </footer>
    </div>
  );
}

const solid = {
  background: color.green, color: '#fff', border: 0, borderRadius: radius.sm,
  padding: '9px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
const ghost = {
  background: 'transparent', color: color.ink, border: `1px solid ${color.line}`,
  borderRadius: radius.sm, padding: '9px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
