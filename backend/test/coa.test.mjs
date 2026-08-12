// Stands up a fake MikroTik that speaks RADIUS, so the CoA client is checked
// against a real decoder rather than against itself.
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import * as coa from '../src/coa.js';

const SECRET = 'testing123';

function parse(pkt) {
  const out = { code: pkt.readUInt8(0), id: pkt.readUInt8(1), attrs: {}, vsa: {} };
  let i = 20;
  while (i < pkt.length) {
    const type = pkt.readUInt8(i), len = pkt.readUInt8(i + 1);
    const val = pkt.subarray(i + 2, i + len);
    if (type === 26) {
      const vendorId = val.readUInt32BE(0);
      let j = 4;
      while (j < val.length) {
        const vt = val.readUInt8(j), vl = val.readUInt8(j + 1);
        out.vsa[`${vendorId}:${vt}`] = val.subarray(j + 2, j + vl).toString();
        j += vl;
      }
    } else {
      out.attrs[type] = val;
    }
    i += len;
  }
  return out;
}

// Recompute the Request Authenticator the way RFC 5176 specifies.
function requestAuthOk(pkt, secret) {
  const zeroed = Buffer.concat([pkt.subarray(0, 4), Buffer.alloc(16), pkt.subarray(20)]);
  const expect = crypto.createHash('md5').update(zeroed).update(secret).digest();
  return expect.equals(pkt.subarray(4, 20));
}

function reply(code, req, secret) {
  const header = Buffer.alloc(4);
  header.writeUInt8(code, 0);
  header.writeUInt8(req.readUInt8(1), 1);
  header.writeUInt16BE(20, 2);
  const auth = crypto.createHash('md5')
    .update(header).update(req.subarray(4, 20)).update(secret).digest();
  return Buffer.concat([header, auth]);
}

function nas({ port, respond, secret = SECRET }) {
  const sock = dgram.createSocket('udp4');
  const seen = [];
  sock.on('message', (msg, rinfo) => {
    seen.push({ parsed: parse(msg), authOk: requestAuthOk(msg, secret) });
    const code = respond(seen.length);
    if (code !== null) sock.send(reply(code, msg, secret), rinfo.port, rinfo.address);
  });
  return new Promise((res) => sock.bind(port, '127.0.0.1', () => res({ sock, seen })));
}

const results = [];
const check = (name, pass, detail = '') =>
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);

// 1. Happy path: ACK, and the NAS can verify everything we sent.
{
  const { sock, seen } = await nas({ port: 13799, respond: () => 44 });
  const r = await coa.send({
    host: '127.0.0.1', port: 13799, secret: SECRET,
    username: 'jane@vibelink', rate: '1024k/2048k', sessionId: '81f00019',
  });
  sock.close();
  const p = seen[0];
  check('ACK accepted', r.ok === true, JSON.stringify(r));
  check('request authenticator valid', p.authOk);
  check('code is CoA-Request (43)', p.parsed.code === 43, `got ${p.parsed.code}`);
  check('User-Name', p.parsed.attrs[1]?.toString() === 'jane@vibelink');
  check('Acct-Session-Id', p.parsed.attrs[44]?.toString() === '81f00019');
  check('Mikrotik-Rate-Limit VSA', p.parsed.vsa['14988:8'] === '1024k/2048k',
    JSON.stringify(p.parsed.vsa));
}

// 2. Walled garden adds the address-list VSA.
{
  const { sock, seen } = await nas({ port: 13800, respond: () => 44 });
  await coa.send({ host: '127.0.0.1', port: 13800, secret: SECRET,
    username: 'bob', rate: '2048k/2048k', addressList: 'walled' });
  sock.close();
  check('Mikrotik-Address-List VSA', seen[0].parsed.vsa['14988:19'] === 'walled');
}

// 3. NAK is reported as a failure, not swallowed.
{
  const { sock } = await nas({ port: 13801, respond: () => 45 });
  const r = await coa.send({ host: '127.0.0.1', port: 13801, secret: SECRET,
    username: 'x', rate: '1k/1k' });
  sock.close();
  check('NAK reported as failure', r.ok === false && /NAK/.test(r.error), JSON.stringify(r));
}

// 4. A reply signed with the wrong secret must be rejected, not trusted.
{
  const { sock } = await nas({ port: 13802, respond: () => 44, secret: 'wrong-secret' });
  const r = await coa.send({ host: '127.0.0.1', port: 13802, secret: SECRET,
    username: 'x', rate: '1k/1k' });
  sock.close();
  check('forged reply rejected', r.ok === false && /authenticator/.test(r.error), JSON.stringify(r));
}

// 5. Silence: retried, then reported. This is the real-world "router unreachable".
{
  const { sock, seen } = await nas({ port: 13803, respond: () => null });
  const t0 = Date.now();
  const r = await coa.send({ host: '127.0.0.1', port: 13803, secret: SECRET,
    username: 'x', rate: '1k/1k', timeoutMs: 150, retries: 2 });
  sock.close();
  check('timeout reported', r.ok === false && /no response/.test(r.error), JSON.stringify(r));
  check('retried 3 times', seen.length === 3, `sent ${seen.length}`);
  check('gave up promptly', Date.now() - t0 < 2000, `${Date.now() - t0}ms`);
}

// 6. Disconnect-Request carries no rate attributes.
{
  const { sock, seen } = await nas({ port: 13804, respond: () => 41 });
  const r = await coa.send({ host: '127.0.0.1', port: 13804, secret: SECRET,
    username: 'x', rate: '1k/1k', disconnect: true });
  sock.close();
  check('Disconnect-ACK accepted', r.ok === true);
  check('Disconnect code is 40', seen[0].parsed.code === 40, `got ${seen[0].parsed.code}`);
  check('no rate on disconnect', Object.keys(seen[0].parsed.vsa).length === 0);
}

// 7. An inet with a prefix, the way routers.host comes back from Postgres.
{
  const { sock } = await nas({ port: 13805, respond: () => 44 });
  const r = await coa.send({ host: '10.50.1.2/32'.replace('10.50.1.2', '127.0.0.1'),
    port: 13805, secret: SECRET, username: 'x', rate: '1k/1k' });
  sock.close();
  check('inet prefix stripped', r.ok === true, JSON.stringify(r));
}

console.log(results.join('\n'));
console.log(results.every((r) => r.startsWith('PASS')) ? '\nall green' : '\nFAILURES');
process.exit(results.every((r) => r.startsWith('PASS')) ? 0 : 1);
