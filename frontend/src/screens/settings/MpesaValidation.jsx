import React, { useEffect, useState } from 'react';
import { color, font } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { Card, Toggle } from '../../ui/primitives';

/**
 * M-Pesa validation. Switched on, Safaricom checks the account number with us before it takes a customer's
 * money, and a number that belongs to no client is refused on the customer's phone — they keep their money
 * and retype it, instead of paying into the void and waiting for an unmatched payment to be sorted out.
 */
export default function MpesaValidation() {
  const store = useStore();
  const canEdit = !!store.session?.perms?.['payment_gateways.edit'];
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.mpesaValidation().then(setInfo).catch((e) => store.toast(e.message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const flip = async (enabled) => {
    setBusy(true);
    try {
      await api.setMpesaValidation(enabled);
      setInfo((i) => ({ ...i, enabled }));
      store.toast(enabled ? 'M-Pesa validation is on' : 'M-Pesa validation is off');
    } catch (e) {
      store.toast(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!info) return <Card><div style={{ color: color.muted }}>Loading…</div></Card>;
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <Card title="M-Pesa validation" subtitle="Turn away payments made to an account number that does not exist.">
        <div style={{ opacity: busy ? 0.6 : 1, pointerEvents: canEdit && !busy ? 'auto' : 'none' }}>
          <Toggle
            checked={info.enabled}
            onChange={flip}
            label="Refuse payments to an unknown account number"
            detail={info.enabled ? 'On — a wrong account number is refused before the customer pays.' : 'Off — every payment is accepted, and a wrong number shows up as an unmatched payment.'}
          />
        </div>
        {!canEdit && <div style={{ fontSize: 12.5, color: color.muted, marginTop: 8 }}>You can see this but not change it.</div>}
        {info.enabled && (
          <div style={{ marginTop: 12, fontSize: 13 }}>
            Refused in the last 30 days: <b>{info.refused30d}</b>. Each one is listed in the Audit log.
          </div>
        )}
      </Card>

      <Card title="Before you switch it on">
        <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 8, fontSize: 13.5, lineHeight: 1.55 }}>
          <li>
            <b>Safaricom must enable External Validation on your paybill.</b> It is off by default and Safaricom turns it on
            on request (email <span style={{ fontFamily: font.mono }}>apisupport@safaricom.co.ke</span> or ask through the M-Pesa portal, quoting your
            paybill{info.shortcodes?.length ? ` ${info.shortcodes.join(', ')}` : ''}). Until they do, this switch has no effect.
          </li>
          <li>
            Register the URLs once under <b>Payment gateways → Register URLs</b>, so Safaricom knows where to ask:
            <div style={{ fontFamily: font.mono, fontSize: 12, color: color.muted, wordBreak: 'break-all' }}>{info.validationUrl}</div>
          </li>
          <li>
            A payment is refused only when its account number matches no client. Anything we cannot check is accepted,
            so a fault on our side never blocks a paying customer. Account numbers are compared ignoring case and dashes.
          </li>
          <li>Payments for SMS credit, hotspot purchases and platform fees are never refused.</li>
        </ol>
      </Card>
    </div>
  );
}
