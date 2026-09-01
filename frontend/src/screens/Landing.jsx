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
 * This page is read once by each visitor and needs no framework of its own —
 * the one injected <style> block below exists only for the hover/entrance
 * motion nothing else on this page needs.
 */

// The phone number was removed at the owner's request. Email carries the same
// "talk to a person" intent without publishing a number that rings one handset.
const SALES_EMAIL = 'sales@vibelink.co.ke';
const SUPPORT_EMAIL = 'support@vibelink.co.ke';

/**
 * Small hand-drawn icon set — no icon library is a dependency of this app, and
 * one glyph each is not worth adding one for. Same stroke weight and viewBox
 * throughout so a 4-column grid of them reads as a set, not a grab-bag.
 */
const ICONS = {
  coin: <><circle cx="9" cy="9" r="6.2" /><circle cx="15" cy="15" r="6.2" /></>,
  router: <><rect x="3.5" y="14" width="17" height="6.5" rx="1.6" />
    <path d="M8 14v-2.2M12 14v-3.4M16 14V9.5" strokeLinecap="round" />
    <circle cx="7" cy="17.3" r=".9" fill="currentColor" stroke="none" /></>,
  wifi: <><path d="M4.5 9.8a11 11 0 0 1 15 0M7.6 13a6.8 6.8 0 0 1 8.8 0M10.8 16.2a2.6 2.6 0 0 1 2.4 0" strokeLinecap="round" />
    <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" /></>,
  gauge: <><path d="M4 16a8 8 0 1 1 16 0" /><path d="M12 16l4.2-5" strokeLinecap="round" />
    <circle cx="12" cy="16" r="1.1" fill="currentColor" stroke="none" /></>,
  shield: <path d="M12 3.5l7 2.6v5.4c0 4.6-3 7.7-7 9-4-1.3-7-4.4-7-9V6.1l7-2.6z M9 12l2.1 2.1L15.3 9.8" strokeLinecap="round" strokeLinejoin="round" />,
  pulse: <><circle cx="12" cy="12" r="8.5" />
    <path d="M8 12h1.6l1.4-3.4 2 6.8 1.4-3.4H17" strokeLinecap="round" strokeLinejoin="round" /></>,
  wallet: <><rect x="3.3" y="6.5" width="17.4" height="12" rx="2.2" />
    <path d="M3.3 10.2h17.4" /><circle cx="16.3" cy="14.2" r="1.15" fill="currentColor" stroke="none" /></>,
  box: <><path d="M12 3.6l8 4.2v8.4l-8 4.2-8-4.2V7.8l8-4.2z" strokeLinejoin="round" />
    <path d="M4 7.9L12 12l8-4.1M12 12v9" strokeLinecap="round" /></>,
  users: <><circle cx="9" cy="9" r="3" /><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" strokeLinecap="round" />
    <circle cx="17" cy="9.8" r="2.4" /><path d="M15.3 14.3c2.4.2 4.2 2 4.2 4.7" strokeLinecap="round" /></>,
  headset: <><path d="M4 13v-1a8 8 0 0 1 16 0v1" strokeLinecap="round" />
    <rect x="3.2" y="13" width="4" height="6" rx="1.6" /><rect x="16.8" y="13" width="4" height="6" rx="1.6" />
    <path d="M20.8 19v1a2.4 2.4 0 0 1-2.4 2.4h-2.6" strokeLinecap="round" /></>,
  pin: <><path d="M12 21s6.5-6.1 6.5-11.2a6.5 6.5 0 1 0-13 0C5.5 14.9 12 21 12 21z" strokeLinejoin="round" />
    <circle cx="12" cy="9.6" r="2.3" /></>,
  megaphone: <><path d="M4 10.5v3.4a1.4 1.4 0 0 0 1.4 1.4H6l1.6 4.4h2l-1.2-4.4h.9L18 19V5.8l-8.7 3.3H5.4A1.4 1.4 0 0 0 4 10.5z" strokeLinejoin="round" />
    <path d="M18 8.6a3.4 3.4 0 0 1 0 6.6" strokeLinecap="round" /></>,
};

const Icon = ({ name, size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    {ICONS[name]}
  </svg>
);

const FEATURES = [
  ['coin', 'M-Pesa that reconciles itself',
   'Paybill, till and STK push. Payments match to the account number the customer typed, and the ones that do not are put in front of you rather than lost.'],
  ['router', 'MikroTik without the console',
   'Point a router at us over a tunnel — no public IP, no port forwarding. RADIUS, PPPoE, hotspot, DHCP and the firewall rules are pushed for you.'],
  ['wifi', 'Hotspot that sells',
   'A captive portal with your name on it. Guests buy a bundle with M-Pesa and get a code by SMS, without an account and without leaving the page.'],
  ['gauge', 'Speed changes that land now',
   'Change a plan and the session changes with it. No waiting for the customer to reconnect, no ringing them to ask.'],
  ['shield', 'Fair use that enforces itself',
   'Set the cap and the throttle. It applies quietly and lifts when the window rolls over.'],
  ['pulse', 'Answers when something breaks',
   'Which tower is down, who is online, what each port is carrying, and where every customer lives on a map.'],
  ['wallet', 'No paybill yet? We collect for you',
   'Turn on collection and your customers pay into our paybill from day one, PPPoE or hotspot — we pay you out nightly, net of a small commission, straight to your own M-Pesa number.'],
  ['box', 'Every router accounted for',
   'Track gadgets by MAC and serial, issue one to a technician and it comes off the shelf automatically, mark a faulty unit and swap it in one step, and know at a glance whether the customer paid for it or it is still yours.'],
  ['users', 'A team, not a shared password',
   'Invite cashiers, technicians and support staff by phone or email — they pick their own username and password. Roles are enforced, not just labelled, and only an owner can ever remove another owner.'],
  ['headset', 'Support that stays out of your DMs',
   'Tickets, a live chat widget on your own portal, and SLA timers that flag a job before it breaches — not a WhatsApp thread nobody can search later.'],
  ['pin', 'Everyone, on one map',
   'Every site, router and customer plotted where they actually are. Send a technician to a job knowing exactly what is already there.'],
  ['megaphone', 'Grow the list, not just serve it',
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

const STACK = ['MikroTik RouterOS', 'Safaricom Daraja', 'KopoKopo', 'RADIUS / PPPoE'];

const Section = ({ children, style }) => (
  <section style={{ maxWidth: 1440, margin: '0 auto', padding: '0 32px', ...style }}>
    {children}
  </section>
);

export default function Landing({ onRegister }) {
  return (
    <div style={{
      minHeight: '100vh', background: color.pageBg, color: color.ink,
      fontFamily: font.sans, fontSize: 15, lineHeight: 1.55,
    }}>
      {/* Scoped to this page only — everything else in the app keeps its own
          plain, motion-free style; a marketing page read once by a visitor
          deciding whether to trust the product is the one place a little
          polish earns its keep. */}
      <style>{`
        @keyframes vlFadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes vlDrift { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(-2%, 3%) scale(1.05); } }
        .vl-fade { animation: vlFadeUp .6s cubic-bezier(.16,1,.3,1) both; }
        .vl-card { transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease; }
        .vl-card:hover { transform: translateY(-3px); box-shadow: 0 12px 28px -14px rgba(15,122,95,.28); border-color: ${color.mint}66; }
        .vl-btn { transition: transform .15s ease, box-shadow .15s ease, background .15s ease; }
        .vl-btn:hover { transform: translateY(-1px); }
        .vl-solid:hover { box-shadow: 0 10px 22px -8px rgba(15,122,95,.55); background: ${color.greenDark}; }
        .vl-ghost:hover { background: ${color.tileBg}; border-color: ${color.green}; }
        @media (prefers-reduced-motion: reduce) {
          .vl-fade { animation: none; }
          .vl-card:hover, .vl-btn:hover { transform: none; }
        }
      `}</style>

      <header style={{
        position: 'sticky', top: 0, zIndex: 20,
        borderBottom: `1px solid ${color.line}`,
        background: 'rgba(255,255,255,.82)', backdropFilter: 'blur(10px)',
      }}>
        <Section style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          height: 62, padding: '0 22px',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 18, letterSpacing: '-.01em' }}>
            <span style={{
              width: 26, height: 26, borderRadius: 8, display: 'grid', placeItems: 'center',
              background: `linear-gradient(135deg, ${color.green}, ${color.mint})`, color: '#fff', fontSize: 13,
            }}>V</span>
            Vibelink
          </span>
          {/* No sign-in here. This domain is the website, not the product:
              nobody's customers live on it, and every ISP works on their own
              subdomain. A sign-in button invites people to try signing in
              somewhere that cannot authenticate them. */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {/* An ISP buying capacity is making a relationship decision, not a
                checkout one, so there is a way to reach a person here. */}
            <a href={`mailto:${SALES_EMAIL}`} className="vl-btn vl-ghost" style={{ ...ghost, textDecoration: 'none' }}>
              Talk to sales
            </a>
            <button type="button" onClick={onRegister} className="vl-btn vl-solid" style={solid}>Register</button>
          </div>
        </Section>
      </header>

      <div style={{ position: 'relative', overflow: 'hidden' }}>
        {/* Purely decorative colour, clipped to this wrapper so it never
            affects layout or steals focus/hit-testing from the content
            sitting on top of it. */}
        <div aria-hidden style={{
          position: 'absolute', inset: '-20% -10% auto -10%', height: 520, zIndex: 0,
          background: `radial-gradient(60% 60% at 30% 20%, ${color.mint}2e, transparent 70%),
                       radial-gradient(50% 50% at 80% 10%, ${color.green}22, transparent 70%)`,
          animation: 'vlDrift 16s ease-in-out infinite',
        }} />

        <Section style={{ position: 'relative', padding: '76px 22px 46px', textAlign: 'center' }}>
          <span className="vl-fade" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600,
            color: color.green, background: '#e2ebe5', border: `1px solid ${color.mint}55`,
            borderRadius: radius.pill, padding: '5px 13px', marginBottom: 18,
          }}>
            Built for Kenyan ISPs
          </span>
          <h1 className="vl-fade" style={{
            fontSize: 44, lineHeight: 1.12, margin: '0 0 14px', letterSpacing: '-.025em',
            animationDelay: '.05s',
          }}>
            Billing, fibre and bandwidth<br />
            for{' '}
            <span style={{
              background: `linear-gradient(100deg, ${color.green}, ${color.mint})`,
              WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
            }}>
              Kenyan ISPs
            </span>
          </h1>
          <p className="vl-fade" style={{ fontSize: 17, color: color.inkSoft, maxWidth: 640, margin: '0 auto 26px', animationDelay: '.1s' }}>
            Run PPPoE and hotspot customers on your MikroTik, take M-Pesa, and stop
            reconciling payments by hand — and buy your FTTH, FTTB and bulk capacity
            from the same people. Your own portal on your own subdomain.
          </p>
          <div className="vl-fade" style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', animationDelay: '.15s' }}>
            <button type="button" onClick={onRegister} className="vl-btn vl-solid" style={{ ...solid, padding: '12px 24px', fontSize: 15 }}>
              Start free
            </button>
            <a href={`mailto:${SALES_EMAIL}`}
               className="vl-btn vl-ghost"
               style={{ ...ghost, padding: '12px 24px', fontSize: 15, textDecoration: 'none' }}>
              Talk to sales
            </a>
          </div>
          <p className="vl-fade" style={{ fontSize: 13, color: color.muted, marginTop: 12, animationDelay: '.2s' }}>
            No card. Your subdomain is live as soon as you register.
          </p>

          <div className="vl-fade" style={{
            display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap',
            marginTop: 34, animationDelay: '.25s',
          }}>
            {STACK.map((s) => (
              <span key={s} style={{
                fontSize: 12.5, color: color.muted, border: `1px solid ${color.line}`,
                borderRadius: radius.pill, padding: '5px 12px', background: color.cardBg,
              }}>
                {s}
              </span>
            ))}
          </div>
        </Section>
      </div>

      <Section style={{ padding: '20px 22px 60px' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 14,
        }}>
          {FEATURES.map(([icon, title, body]) => (
            <div key={title} className="vl-card" style={{
              background: color.cardBg, border: `1px solid ${color.line}`,
              borderRadius: radius.lg ?? 12, padding: '18px 18px 20px',
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center',
                background: '#e2ebe5', color: color.green, marginBottom: 12,
              }}>
                <Icon name={icon} />
              </div>
              <h3 style={{ margin: '0 0 6px', fontSize: 15.5 }}>{title}</h3>
              <p style={{ margin: 0, fontSize: 14, color: color.inkSoft }}>{body}</p>
            </div>
          ))}
        </div>
      </Section>

      <div style={{
        background: `linear-gradient(180deg, ${color.greenDark}, ${color.green})`,
        color: '#fff',
      }}>
        <Section style={{ padding: '52px 22px' }}>
          <h2 style={{ fontSize: 24, margin: '0 0 6px', textAlign: 'center' }}>
            Capacity, not just software
          </h2>
          <p style={{
            textAlign: 'center', color: 'rgba(255,255,255,.82)', maxWidth: 620,
            margin: '0 auto 24px', fontSize: 15,
          }}>
            We build and sell the connectivity too, so the billing and the bandwidth
            come from one place.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
            {SERVICES.map(([title, body]) => (
              <div key={title} className="vl-card" style={{
                border: '1px solid rgba(255,255,255,.18)', borderRadius: radius.lg ?? 12,
                padding: '18px 18px 20px', background: 'rgba(255,255,255,.06)',
              }}>
                <h3 style={{ margin: '0 0 6px', fontSize: 15.5, color: '#fff' }}>{title}</h3>
                <p style={{ margin: 0, fontSize: 14, color: 'rgba(255,255,255,.82)' }}>{body}</p>
              </div>
            ))}
          </div>
          <p style={{ textAlign: 'center', marginTop: 18, fontSize: 13.5, color: 'rgba(255,255,255,.72)' }}>
            Talk to us about coverage and pricing:{' '}
            <a href={`mailto:${SALES_EMAIL}`} style={{ color: '#fff' }}>{SALES_EMAIL}</a>
          </p>
        </Section>
      </div>

      <div style={{ borderBottom: `1px solid ${color.line}` }}>
        <Section style={{ padding: '52px 22px' }}>
          <h2 style={{ fontSize: 24, margin: '0 0 22px', textAlign: 'center' }}>Getting started</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            {STEPS.map(([title, body], i) => (
              <div key={title}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: `linear-gradient(135deg, ${color.green}, ${color.mint})`, color: '#fff',
                  display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700, marginBottom: 8,
                }}>{i + 1}</div>
                <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>{title}</h3>
                <p style={{ margin: 0, fontSize: 13.5, color: color.inkSoft }}>{body}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Section style={{ padding: '58px 22px 68px', textAlign: 'center' }}>
        <h2 style={{ fontSize: 26, margin: '0 0 10px', letterSpacing: '-.01em' }}>Ready when you are</h2>
        <p style={{ color: color.inkSoft, maxWidth: 520, margin: '0 auto 20px' }}>
          Register, add one router, and see your own customers on your own portal.
        </p>
        <button type="button" onClick={onRegister} className="vl-btn vl-solid" style={{ ...solid, padding: '13px 26px', fontSize: 15.5 }}>
          Create your account
        </button>
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
  background: color.green, color: '#fff', border: 0, borderRadius: 9,
  padding: '9px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
const ghost = {
  background: 'transparent', color: color.ink, border: `1px solid ${color.line}`,
  borderRadius: 9, padding: '9px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
