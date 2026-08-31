// One-off staging test for the settlement payout flow (both the nightly
// sweep's code path and the on-demand "Request payout" route) — see jobs.js's
// payoutTenantNow/settleTenants and server.js's POST /api/settlements/payout.
//
// Runs against whatever Postgres DATABASE_URL points at (the local dev DB by
// default). Only ever touches a fresh, disposable tenant this script creates
// itself — it never modifies the real platform-owner tenant or its staff, and
// it refuses to insert a Daraja config for that owner if one already exists,
// so it can never fire a real, money-moving B2C call by accident.
import 'dotenv/config';
import { pool } from '../src/db.js';
import { payoutTenantNow, settleTenants } from '../src/jobs.js';

const assert = (cond, msg) => {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ok — ${msg}`);
};

async function main() {
  const { rows: [existingOwner] } = await pool.query(
    "select tenant_id from staff where is_super_admin and tenant_id is not null limit 1");
  if (!existingOwner) throw new Error('No is_super_admin staff row exists in this DB — cannot test the owner-account path.');
  const ownerId = existingOwner.tenant_id;

  const { rows: [ownerCfg] } = await pool.query(
    "select id from tenant_payment_config where tenant_id=$1 and provider='daraja'", [ownerId]);
  const ownerHasRealGateway = !!ownerCfg;

  const { rows: [tenant] } = await pool.query(
    `insert into tenants (name, subdomain, platform_collect_enabled, settlement_phone, settlement_commission_pct)
     values ('Gatewayless Tenant (test)', 'ptest-tenant', true, '254712345678', 5) returning id`);
  console.log(`owner=${ownerId} (pre-existing, untouched) tenant=${tenant.id} (seeded, disposable)`);
  console.log(ownerHasRealGateway
    ? 'Owner already has a Daraja gateway configured — skipping the live b2c() boundary tests for safety (won\'t risk a real payout).'
    : 'Owner has no Daraja gateway configured — safe to exercise the real b2c() call up to its own credential checks.');

  let insertedOwnerCfgId = null;
  try {
    console.log('\n1. No pending settlement yet → should reject cleanly');
    await payoutTenantNow(tenant.id).then(
      () => { throw new Error('FAIL: expected rejection, got success'); },
      (e) => assert(e.status === 400 && /nothing pending/i.test(e.message), `rejected as 400: "${e.message}"`)
    );

    console.log('\n2. A pending settlement below the KES 100 minimum → should reject cleanly');
    await pool.query(`insert into settlements (tenant_id, amount, status) values ($1, 50, 'pending')`, [tenant.id]);
    await payoutTenantNow(tenant.id).then(
      () => { throw new Error('FAIL: expected rejection, got success'); },
      (e) => assert(e.status === 400 && /minimum/i.test(e.message), `rejected as 400: "${e.message}"`)
    );
    await pool.query(`delete from settlements where tenant_id=$1`, [tenant.id]);

    console.log('\n3. A real pending settlement, but no settlement_phone → should reject cleanly');
    await pool.query(`update tenants set settlement_phone=null where id=$1`, [tenant.id]);
    await pool.query(`insert into settlements (tenant_id, amount, status) values ($1, 500, 'pending')`, [tenant.id]);
    await payoutTenantNow(tenant.id).then(
      () => { throw new Error('FAIL: expected rejection, got success'); },
      (e) => assert(e.status === 400 && /settlement m-pesa number/i.test(e.message), `rejected as 400: "${e.message}"`)
    );
    await pool.query(`update tenants set settlement_phone='254712345678' where id=$1`, [tenant.id]);

    console.log('\n4. The unique-pending-per-tenant index and accrueSettlement()\'s upsert → repeat accruals sum instead of duplicating');
    const before = (await pool.query(`select amount from settlements where tenant_id=$1 and status='pending'`, [tenant.id])).rows[0].amount;
    await pool.query(
      `insert into settlements (tenant_id, amount, status) values ($1, 250, 'pending')
       on conflict (tenant_id) where status='pending' do update set amount = settlements.amount + excluded.amount`,
      [tenant.id]);
    const after = (await pool.query(`select amount from settlements where tenant_id=$1 and status='pending'`, [tenant.id])).rows[0].amount;
    assert(Number(after) === Number(before) + 250, `accrued onto the same row: ${before} + 250 = ${after}`);
    await pool.query(`update settlements set amount=500 where tenant_id=$1`, [tenant.id]);

    if (!ownerHasRealGateway) {
      console.log('\n5. Everything present, owner tenant has no Daraja gateway at all → the real b2c() call\'s own "no gateway" check');
      await payoutTenantNow(tenant.id).then(
        () => { throw new Error('FAIL: expected rejection, got success — did a real payout somehow fire?!'); },
        (e) => assert(/no m-pesa gateway is configured/i.test(e.message), `rejected with the real b2c() error: "${e.message}"`)
      );

      console.log('\n6. That failed attempt must leave the row exactly as it was — still \'pending\', not stuck \'processing\'');
      const { rows: [row] } = await pool.query(`select status, conversation_id from settlements where tenant_id=$1`, [tenant.id]);
      assert(row.status === 'pending', `status is still 'pending' (got '${row.status}')`);
      assert(row.conversation_id === null, `conversation_id was never set (got ${JSON.stringify(row.conversation_id)})`);

      console.log('\n7. The nightly settleTenants() sweep across all tenants — must not throw, must not crash on our row');
      await settleTenants();
      const { rows: [row2] } = await pool.query(`select status from settlements where tenant_id=$1`, [tenant.id]);
      assert(row2.status === 'pending', `sweep hits the same b2c() boundary and leaves it 'pending' (got '${row2.status}')`);

      console.log('\n8. Giving the owner tenant a Daraja config with no initiator credentials → the next real check (b2c-specific, past "is there a gateway at all")');
      const { rows: [inserted] } = await pool.query(
        `insert into tenant_payment_config (tenant_id, provider, shortcode, credentials)
         values ($1, 'daraja', '999999test', '{"consumer_key":"x","consumer_secret":"y","passkey":"z"}'::jsonb) returning id`,
        [ownerId]);
      insertedOwnerCfgId = inserted.id;
      await payoutTenantNow(tenant.id).then(
        () => { throw new Error('FAIL: expected rejection (no initiator credentials), got success'); },
        (e) => assert(/initiator name and password/i.test(e.message), `rejected with the initiator-credential error: "${e.message}"`)
      );

      console.log('\nEvery reachable code path passed, right up to the real Safaricom B2C call itself. That last step —');
      console.log('an actual money-moving payout and its b2c-result webhook confirmation — needs real Safaricom initiator');
      console.log('credentials for the owner\'s Daraja gateway (Settings → Payment gateways), which nothing here supplies on purpose.');
    } else {
      console.log('\nValidation-only checks (1-4) passed. Skipped the live b2c() boundary (5-8) because the owner tenant');
      console.log('already has a real Daraja gateway configured — running those against it could risk a real payout.');
    }
  } finally {
    console.log('\nCleaning up — only the disposable tenant and, if inserted, the throwaway owner config…');
    await pool.query('delete from settlements where tenant_id=$1', [tenant.id]);
    await pool.query('delete from tenants where id=$1', [tenant.id]);
    if (insertedOwnerCfgId) await pool.query('delete from tenant_payment_config where id=$1', [insertedOwnerCfgId]);
    console.log('done — owner tenant and its staff were never touched.');
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
