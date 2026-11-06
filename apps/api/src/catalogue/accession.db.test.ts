import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDb } from '../../test/db';
import { makeBranch, makeCategory } from '../../test/fixtures';
import type { DbHandle } from '../db/client';
import { AccessionRangeExhaustedError, allocateAccessionNumbers } from './accession';

let h: DbHandle;
let ks: number;
let gl: number;

beforeAll(async () => {
  h = await freshDb();
  ks = (await makeBranch(h.db, 'KS')).id;
  gl = (await makeBranch(h.db, 'GL')).id;
  await makeCategory(h.db, 'A1');
  await makeCategory(h.db, 'A2');
  await makeCategory(h.db, 'B1');
});

afterAll(async () => {
  await h.close();
});

const allocate = (branchId: number, category: string, count = 1) =>
  h.db.transaction((tx) => allocateAccessionNumbers(tx, branchId, category, count));

describe('allocateAccessionNumbers (FR-CAT-02)', () => {
  it('counts up from 00001 per branch and category', async () => {
    expect(await allocate(ks, 'A1')).toEqual(['KS-A1-00001']);
    expect(await allocate(ks, 'A1', 3)).toEqual(['KS-A1-00002', 'KS-A1-00003', 'KS-A1-00004']);
    expect(await allocate(ks, 'A2')).toEqual(['KS-A2-00001']);
    expect(await allocate(gl, 'A1')).toEqual(['GL-A1-00001']);
  });

  it('gives the numbers back if the transaction rolls back', async () => {
    await expect(
      h.db.transaction(async (tx) => {
        await allocateAccessionNumbers(tx, gl, 'A2', 5);
        throw new Error('cataloguing cancelled');
      }),
    ).rejects.toThrow('cataloguing cancelled');
    expect(await allocate(gl, 'A2')).toEqual(['GL-A2-00001']);
  });

  it('never hands the same number to two counters at once', async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => allocate(gl, 'B1')));
    const numbers = results.flat();
    expect(new Set(numbers).size).toBe(25);
    expect(numbers.sort()).toEqual(
      Array.from({ length: 25 }, (_, i) => `GL-B1-${String(i + 1).padStart(5, '0')}`),
    );
  });

  it('stops at 99999', async () => {
    await h.db.execute(
      sql`INSERT INTO accession_counter (branch_id, category_code, next_running) VALUES (${ks}, 'B1', 99999)`,
    );
    expect(await allocate(ks, 'B1')).toEqual(['KS-B1-99999']);
    await expect(allocate(ks, 'B1')).rejects.toBeInstanceOf(AccessionRangeExhaustedError);
  });
});
