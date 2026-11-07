/**
 * FR-AUT-20, NFR-09: the personal details of people who never became members
 * are removed once the branch's period (default 90 days from applying) has
 * passed — pending applications nobody approved, and rejected ones.
 *
 * Nothing is deleted (R12): the account stays, anonymised, and its activity
 * log entries stay, with their recorded values replaced. That replacement is
 * the single change the log's trigger permits, and only inside a transaction
 * that has switched `pothgula.redacting` on (drizzle/0001_rules.sql).
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { SYSTEM_ACTOR } from '../audit/actor';
import type { UnitOfWork } from '../audit/unit-of-work';
import type { Db } from '../db/client';
import { activityLog, appUser, branchSetting, session } from '../db/schema';

const REDACTED = sql`'{"redacted": true}'::jsonb`;

/** Anonymises every application past its period; returns the ids it changed. */
export async function anonymiseUnsuccessfulApplications(
  db: Db,
  uow: UnitOfWork,
  now: Date = new Date(),
): Promise<number[]> {
  const due = await db
    .select({ id: appUser.id, branchId: appUser.branchId, status: appUser.status })
    .from(appUser)
    .innerJoin(branchSetting, eq(branchSetting.branchId, appUser.branchId))
    .where(
      and(
        eq(appUser.userType, 'member'),
        inArray(appUser.status, ['pending', 'rejected']),
        sql`${appUser.appliedAt} < ${now.toISOString()}::timestamptz
            - make_interval(days => ${branchSetting.applicationAnonymiseDays})`,
      ),
    );

  const done: number[] = [];
  for (const applicant of due) {
    const changed = await uow.run(SYSTEM_ACTOR, async (tx, log) => {
      const [row] = await tx
        .update(appUser)
        .set({
          fullName: 'Removed applicant',
          whatsappPhone: null,
          otherPhone: null,
          address: null,
          dateOfBirth: null,
          organisation: null,
          introducedByName: null,
          introducedByPhone: null,
          rejectionReason: null,
          passwordHash: '!', // can never match a password
          status: 'anonymised',
          anonymisedAt: now,
        })
        // Re-checked here, so an application approved meanwhile is left alone.
        .where(and(eq(appUser.id, applicant.id), inArray(appUser.status, ['pending', 'rejected'])))
        .returning({ id: appUser.id });
      if (!row) {
        await log({
          action: 'application.anonymise_skipped',
          entity: 'app_user',
          entityId: applicant.id,
        });
        return false;
      }
      await tx.update(session).set({ revokedAt: now }).where(eq(session.userId, applicant.id));

      await tx.execute(sql`SET LOCAL pothgula.redacting = 'on'`);
      await tx
        .update(activityLog)
        .set({
          beforeData: sql`CASE WHEN ${activityLog.beforeData} IS NULL THEN NULL ELSE ${REDACTED} END`,
          afterData: sql`CASE WHEN ${activityLog.afterData} IS NULL THEN NULL ELSE ${REDACTED} END`,
          redactedAt: now,
        })
        .where(
          and(
            eq(activityLog.entity, 'app_user'),
            eq(activityLog.entityId, String(applicant.id)),
            isNull(activityLog.redactedAt),
          ),
        );
      await tx.execute(sql`SET LOCAL pothgula.redacting = 'off'`);

      await log({
        action: 'application.anonymise',
        entity: 'app_user',
        entityId: applicant.id,
        branchId: applicant.branchId,
        after: { previousStatus: applicant.status },
      });
      return true;
    });
    if (changed) done.push(applicant.id);
  }
  return done;
}
