import type { DB } from "../../shared/db.js";
import type { JobRow } from "../types.js";

type JobHandler = (job: JobRow) => Promise<void>;

/**
 * Postgres-backed job consumer.
 *
 * Pull model: `poll()` claims the next ready job with FOR UPDATE SKIP LOCKED
 * so multiple workers (or restart scenarios) don't double-process.
 * In Year 1 this runs in-process on a setInterval. In Year 2 it's replaced
 * by a proper queue worker (BullMQ / pg-boss) without changing handler signatures.
 */
export class QueueConsumer {
  private handlers = new Map<string, JobHandler>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly db: DB) {}

  register(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  /** Claim and process up to `batchSize` due jobs. Returns the number processed. */
  async poll(batchSize = 5): Promise<number> {
    // Claim eligible jobs atomically.
    const jobs = await this.db.query<JobRow>(
      `UPDATE job_queue
         SET status = 'running', attempts = attempts + 1
       WHERE id IN (
         SELECT id FROM job_queue
         WHERE status IN ('pending', 'failed')
           AND run_at <= @now
           AND attempts < max_attempts
         ORDER BY run_at ASC
         LIMIT @batchSize
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      { now: Date.now(), batchSize },
    );

    for (const job of jobs) {
      const handler = this.handlers.get(job.type);
      if (!handler) {
        await this.markFailed(job.id, `No handler registered for job type '${job.type}'`);
        continue;
      }
      try {
        const parsed: JobRow = { ...job, payload: job.payload };
        await handler(parsed);
        await this.markCompleted(job.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.markFailed(job.id, msg);
      }
    }

    return jobs.length;
  }

  /** Start a recurring poll interval (in-process background worker). */
  start(intervalMs = 10_000): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      this.poll().catch((err) =>
        console.error("[job-queue] poll error", err instanceof Error ? err.message : err),
      );
    }, intervalMs);
    // Don't block process exit.
    if (this.pollTimer.unref) this.pollTimer.unref();
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async markCompleted(id: string): Promise<void> {
    await this.db.query(
      "UPDATE job_queue SET status = 'completed', completed_at = @now WHERE id = @id",
      { id, now: Date.now() },
    );
  }

  private async markFailed(id: string, error: string): Promise<void> {
    const now = Date.now();
    // Check if we've exhausted attempts.
    const job = await this.db.one<{ attempts: number; max_attempts: number }>(
      "SELECT attempts, max_attempts FROM job_queue WHERE id = @id",
      { id },
    );
    const status = job && job.attempts >= job.max_attempts ? "failed" : "pending";
    const backoff = job ? Math.min(Math.pow(2, job.attempts) * 1000, 60_000) : 5_000;
    await this.db.query(
      "UPDATE job_queue SET status = @status, error = @error, run_at = @runAt WHERE id = @id",
      { id, status, error, runAt: now + backoff },
    );
  }
}
