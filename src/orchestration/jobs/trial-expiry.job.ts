/**
 * DEMO-1: Trial lifecycle sweep.
 *
 * A global (not per-tenant) daily job — mirrors idempotency-expiry.job.ts —
 * that does two things for every tenant on a self-serve trial
 * (`subscriptions.status = 'trialing'`):
 *
 *   1. Fires nurture emails at day 7 and day 13 of the 14-day trial, reusing
 *      the existing shared/email.ts sendEmail() mechanism (the same one
 *      password-reset uses). Each is sent at most once per tenant, tracked by
 *      `nurture_day7_sent_at` / `nurture_day13_sent_at` markers so re-running
 *      the job (it is re-enqueued every 24h, and can also be triggered via
 *      POST /api/jobs/tick) never double-sends.
 *   2. Soft-expires trials whose trial_ends_at has passed and which never
 *      converted to a paid plan — flips status to 'expired'. This never
 *      touches tenant data; IdentityService.issueLoginSession() is what
 *      actually rejects logins for an expired tenant (trial_expired error).
 *
 * A tenant that converted to a paid plan before its trial lapsed has
 * `status` moved off 'trialing' (e.g. to 'active') by that upgrade action, so
 * every query below — scoped to `status = 'trialing'` — naturally skips it.
 */
import type { DB } from "../../shared/db.js";
import type { JobRow } from "../types.js";
import { sendEmail } from "../../shared/email.js";
import { moduleLogger } from "../../shared/logger.js";

const log = moduleLogger("trial-expiry");

const DAY_MS = 24 * 60 * 60 * 1000;
// Trials run 14 days (see TRIAL_DURATION_MS in identity/service.ts). The
// nurture marks are day-7 and day-13 *elapsed*, i.e. offsets *before*
// trial_ends_at of (14 - 7) = 7 days and (14 - 13) = 1 day respectively.
const DAY7_OFFSET_MS = 7 * DAY_MS;
const DAY13_OFFSET_MS = 1 * DAY_MS;

/** Re-enqueue interval for the self-rescheduling job registration. */
export const TRIAL_EXPIRY_INTERVAL_MS = DAY_MS;

interface TrialingSubscriptionRow {
  id: string;
  tenant_id: string;
}

async function sendTrialNurtureEmail(db: DB, tenantId: string, daysLeft: number): Promise<void> {
  const owner = await db.one<{ email: string }>(
    "SELECT email FROM users WHERE tenant_id = @tenantId AND role = 'owner' ORDER BY created_at ASC LIMIT 1",
    { tenantId },
  );
  if (!owner) return; // no owner to notify (shouldn't happen — register() always creates one)

  const tenant = await db.one<{ name: string }>("SELECT name FROM tenants WHERE id = @tenantId", { tenantId });
  const storeName = tenant?.name ?? "your store";
  const appUrl = process.env["APP_URL"] ?? "https://finder-pos.vercel.app";
  const upgradeLink = `${appUrl}/settings/billing`;
  const dayWord = daysLeft === 1 ? "day" : "days";

  await sendEmail({
    to: owner.email,
    from: process.env["EMAIL_FROM"] ?? "noreply@finder-pos.app",
    subject: `${daysLeft} ${dayWord} left in your Ascend trial`,
    text:
      `Hi,\n\nYour Ascend trial for ${storeName} ends in ${daysLeft} ${dayWord}. ` +
      `Upgrade any time to keep everything running without interruption:\n${upgradeLink}\n`,
    html:
      `<p>Your Ascend trial for <strong>${storeName}</strong> ends in ${daysLeft} ${dayWord}.</p>` +
      `<p><a href="${upgradeLink}">Upgrade now</a> to keep everything running without interruption.</p>`,
  }).catch((err) => {
    // A failed nurture email must never fail the sweep or block expiry.
    log.warn({ err, tenantId }, "trial nurture email failed to send");
  });
}

export async function trialExpiryJob(job: JobRow, db: DB): Promise<{ nurtureDay7: number; nurtureDay13: number; expired: number }> {
  const now = Date.now();

  // ── 1. Day-7 nurture: trial started at least 7 days ago, not yet sent ─────
  const day7Due = await db.query<TrialingSubscriptionRow>(
    `SELECT id, tenant_id FROM subscriptions
      WHERE status = 'trialing'
        AND trial_ends_at IS NOT NULL
        AND nurture_day7_sent_at IS NULL
        AND trial_ends_at - @day7Offset <= @now`,
    { now, day7Offset: DAY7_OFFSET_MS },
  );
  for (const sub of day7Due) {
    await sendTrialNurtureEmail(db, sub.tenant_id, 7);
    await db.query(
      "UPDATE subscriptions SET nurture_day7_sent_at = @now, updated_at = @now WHERE id = @id",
      { id: sub.id, now },
    );
  }

  // ── 2. Day-13 nurture: one day left, not yet sent ──────────────────────────
  const day13Due = await db.query<TrialingSubscriptionRow>(
    `SELECT id, tenant_id FROM subscriptions
      WHERE status = 'trialing'
        AND trial_ends_at IS NOT NULL
        AND nurture_day13_sent_at IS NULL
        AND trial_ends_at - @day13Offset <= @now`,
    { now, day13Offset: DAY13_OFFSET_MS },
  );
  for (const sub of day13Due) {
    await sendTrialNurtureEmail(db, sub.tenant_id, 1);
    await db.query(
      "UPDATE subscriptions SET nurture_day13_sent_at = @now, updated_at = @now WHERE id = @id",
      { id: sub.id, now },
    );
  }

  // ── 3. Soft-expire trials past trial_ends_at that never converted ─────────
  // A SOFT state only — never deletes or mutates any tenant business data.
  const expired = await db.query<{ id: string; tenant_id: string }>(
    `UPDATE subscriptions
        SET status = 'expired', updated_at = @now
      WHERE status = 'trialing'
        AND trial_ends_at IS NOT NULL
        AND trial_ends_at <= @now
      RETURNING id, tenant_id`,
    { now },
  );

  if (day7Due.length || day13Due.length || expired.length) {
    log.info(
      { jobId: job.id, nurtureDay7: day7Due.length, nurtureDay13: day13Due.length, expired: expired.length },
      "trial lifecycle sweep complete",
    );
  }

  return { nurtureDay7: day7Due.length, nurtureDay13: day13Due.length, expired: expired.length };
}
