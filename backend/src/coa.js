// RADIUS Change-of-Authorization, spoken directly over UDP (RFC 5176).
//
// This used to shell out to `radclient`, which is not installed here and does
// not exist on Windows at all — so every CoA silently failed and speed changes
// only took effect when the subscriber redialled. The packet is small and fully
// specified, so we build it ourselves and depend on nothing.
import dgram from 'node:dgram';
import crypto from 'node:crypto';

const CODE = { COA_REQUEST: 43, COA_ACK: 44, COA_NAK: 45, DISCONNECT_REQUEST: 40, DISCONNECT_ACK: 41, DISCONNECT_NAK: 42 };

// Standard attribute types we send.
const ATTR = { USER_NAME: 1, NAS_IP_ADDRESS: 4, VENDOR_SPECIFIC: 26, ACCT_SESSION_ID: 44 };

// MikroTik's vendor space. Rate-Limit is the attribute that actually changes the
// speed of a live session; the format is "upload/download" in bits, e.g. 5000k/10000k.
const MIKROTIK = 14988;
const MT = { RATE_LIMIT: 8, ADDRESS_LIST: 19 };

let nextId = crypto.randomInt(0, 256);
const newId = () => (nextId = (nextId + 1) % 256);

const tlv = (type, value) => {
  const v = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  // An attribute carries its own length in one byte, so 253 is the hard ceiling.
  if (v.length > 253) throw new Error(`radius attribute ${type} too long (${v.length})`);
  return Buffer.concat([Buffer.from([type, v.length + 2]), v]);
};

// A vendor attribute is an ordinary attribute 26 wrapping vendor id + inner TLV.
const vendor = (vendorId, type, value) => {
  const inner = tlv(type, value);
  const id = Buffer.alloc(4);
  id.writeUInt32BE(vendorId);
  return tlv(ATTR.VENDOR_SPECIFIC, Buffer.concat([id, inner]));
};

/**
 * The Request Authenticator for CoA and Disconnect is not random — it is
 * MD5(code + id + length + sixteen zero bytes + attributes + secret). Getting
 * this wrong looks exactly like a wrong shared secret: the NAS drops the packet
 * without answering.
 */
function encode(code, id, attrs, secret) {
  const body = Buffer.concat(attrs);
  const header = Buffer.alloc(4);
  header.writeUInt8(code, 0);
  header.writeUInt8(id, 1);
  header.writeUInt16BE(20 + body.length, 2);

  const digest = crypto.createHash('md5')
    .update(header).update(Buffer.alloc(16)).update(body).update(secret)
    .digest();

  return Buffer.concat([header, digest, body]);
}

/** Confirms the reply really came from something holding the shared secret. */
function authentic(reply, request, secret) {
  if (reply.length < 20) return false;
  const expected = crypto.createHash('md5')
    .update(reply.subarray(0, 4))
    .update(request.subarray(4, 20))   // the Request Authenticator
    .update(reply.subarray(20))
    .update(secret)
    .digest();
  return expected.equals(reply.subarray(4, 20));
}

/**
 * Send one CoA (or Disconnect) and wait for the ACK/NAK.
 *
 * Resolves to { ok, code } — never throws for a network problem, because every
 * caller is in the middle of something more important (applying a payment,
 * running the fair-use sweep) and the database is already correct. A failed CoA
 * costs a delay until the subscriber reconnects, not a wrong bill.
 */
export function send({ host, secret, username, rate, addressList, sessionId, nasIp,
                       disconnect = false, port, timeoutMs = 3000, retries = 2 }) {
  // routers.host is an inet and may carry a prefix; the wire wants the address.
  const target = String(host).split('/')[0];
  const dstPort = Number(port ?? process.env.RADIUS_COA_PORT ?? 3799);
  const key = Buffer.from(String(secret ?? ''), 'utf8');

  const attrs = [tlv(ATTR.USER_NAME, username)];
  // Naming the session makes the NAS match one login rather than guessing when a
  // subscriber is connected twice.
  if (sessionId) attrs.push(tlv(ATTR.ACCT_SESSION_ID, sessionId));
  if (nasIp) {
    const ip = Buffer.from(String(nasIp).split('/')[0].split('.').map(Number));
    if (ip.length === 4) attrs.push(tlv(ATTR.NAS_IP_ADDRESS, ip));
  }
  if (!disconnect) {
    if (rate) attrs.push(vendor(MIKROTIK, MT.RATE_LIMIT, rate));
    if (addressList) attrs.push(vendor(MIKROTIK, MT.ADDRESS_LIST, addressList));
  }

  const id = newId();
  const packet = encode(disconnect ? CODE.DISCONNECT_REQUEST : CODE.COA_REQUEST, id, attrs, key);

  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    let attempt = 0;
    let timer = null;
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { sock.close(); } catch { /* already closing */ }
      resolve(result);
    };

    sock.on('message', (msg) => {
      if (msg.length < 20 || msg.readUInt8(1) !== id) return;   // not our reply
      if (!authentic(msg, packet, key)) return finish({ ok: false, error: 'bad response authenticator — wrong shared secret?' });
      const code = msg.readUInt8(0);
      const ok = code === CODE.COA_ACK || code === CODE.DISCONNECT_ACK;
      finish({ ok, code, error: ok ? undefined : (code === CODE.COA_NAK || code === CODE.DISCONNECT_NAK
        ? 'NAK — the NAS has no such session, or rejected the attributes'
        : `unexpected response code ${code}`) });
    });

    sock.on('error', (e) => finish({ ok: false, error: e.message }));

    // UDP has no delivery guarantee and CoA is idempotent, so a lost packet is
    // worth retrying rather than waiting for the next reconnect.
    const attemptSend = () => {
      if (settled) return;
      if (attempt++ > retries) return finish({ ok: false, error: `no response from ${target}:${dstPort} after ${retries + 1} attempts` });
      sock.send(packet, dstPort, target, (e) => { if (e) finish({ ok: false, error: e.message }); });
      timer = setTimeout(attemptSend, timeoutMs);
    };
    attemptSend();
  });
}

export const codes = CODE;
