/**
 * Demonstration data — invented, never real (NFR-17). Sinhala and Tamil are in
 * from the start so that rendering problems show up in development (R-05).
 */
import { SYSTEM_ACTOR } from '../audit/actor';
import type { UnitOfWork } from '../audit/unit-of-work';
import { allocateAccessionNumbers } from '../catalogue/accession';
import { branch, branchSetting, category, copy, library, title } from './schema';

const LIBRARY = 'Pothgula Demonstration Library';

const BRANCHES = [
  { code: 'KS', name: 'Kesbewa', address: '12 Temple Road, Kesbewa', phone: '0112000001' },
  { code: 'GL', name: 'Galle', address: '5 Fort Street, Galle', phone: '0912000002' },
] as const;

/** The starting scheme proposed in requirements v3.1 §5. */
const COLLECTIONS = [
  ['A', 'Sinhala'],
  ['B', 'English'],
  ['C', 'Tamil'],
] as const;
const KINDS = [
  'Novels',
  'Short stories',
  'Poetry and drama',
  'Translated fiction',
  'Biography and history',
  'Religion and philosophy',
  'Science, technology and health',
  'Education and exam guides',
  'General and other',
];
const CHILDREN = [
  ['D1', "Children's — picture books"],
  ['D2', "Children's — stories for young readers"],
  ['D3', "Children's — learning and activity books"],
  ['D9', "Children's — other"],
] as const;

const TITLES: {
  title: string;
  writer: string;
  publisher: string;
  categoryCode: string;
  copies: Partial<Record<'KS' | 'GL', number>>;
}[] = [
  {
    title: 'ගම් මඟ',
    writer: 'සුනිල් රත්නායක',
    publisher: 'දිනමිණ ප්‍රකාශන',
    categoryCode: 'A1',
    copies: { KS: 3, GL: 1 },
  },
  {
    title: 'කඳුකර කතා',
    writer: 'නිරෝෂා පෙරේරා',
    publisher: 'සරසවි',
    categoryCode: 'A2',
    copies: { KS: 2 },
  },
  {
    title: 'ශ්‍රී ලංකා ඉතිහාසය: කෙටි හැඳින්වීමක්',
    writer: 'ප්‍රියන්ත ද සිල්වා',
    publisher: 'ගොඩගේ',
    categoryCode: 'A5',
    copies: { GL: 2 },
  },
  {
    title: 'கடலோரக் கிராமம்',
    writer: 'சோமசுந்தரம் ராஜன்',
    publisher: 'குமரன் புத்தக இல்லம்',
    categoryCode: 'C1',
    copies: { KS: 1, GL: 2 },
  },
  {
    title: 'தமிழ் இலக்கண எளிமை',
    writer: 'கௌரி நடராஜா',
    publisher: 'சேமமடு',
    categoryCode: 'C8',
    copies: { GL: 1 },
  },
  {
    title: 'The Lighthouse Keeper',
    writer: 'Anne Fernando',
    publisher: 'Vijitha Yapa',
    categoryCode: 'B1',
    copies: { KS: 1, GL: 1 },
  },
  {
    title: 'Everyday Science',
    writer: 'R. Jayasuriya',
    publisher: 'Sarasavi',
    categoryCode: 'B7',
    copies: { KS: 2 },
  },
  {
    title: 'පුංචි හාවා',
    writer: 'දිල්හානි කුමාරි',
    publisher: 'සරසවි',
    categoryCode: 'D1',
    copies: { KS: 2, GL: 1 },
  },
];

export interface SeedResult {
  skipped: boolean;
  branches: number;
  categories: number;
  titles: number;
  copies: number;
}

/** Loads the demonstration data into an empty database; does nothing otherwise. */
export async function seedDemo(uow: UnitOfWork): Promise<SeedResult> {
  return uow.run(SYSTEM_ACTOR, async (tx, log) => {
    const existing = await tx.select({ id: branch.id }).from(branch).limit(1);
    if (existing.length > 0) {
      await log({ action: 'seed.skip', entity: 'database', after: { reason: 'not empty' } });
      return { skipped: true, branches: 0, categories: 0, titles: 0, copies: 0 };
    }

    await tx.update(library).set({ name: LIBRARY });
    await log({
      action: 'library.rename',
      entity: 'library',
      entityId: 1,
      after: { name: LIBRARY },
    });

    const branchIds: Record<string, number> = {};
    for (const b of BRANCHES) {
      const [row] = await tx
        .insert(branch)
        .values({
          branchName: b.name,
          branchCode: b.code,
          address: b.address,
          phone: b.phone,
        })
        .returning();
      if (!row) throw new Error('branch insert returned nothing');
      branchIds[b.code] = row.id;
      await tx.insert(branchSetting).values({ branchId: row.id, annualFeeCents: 50_000 });
      await log({
        action: 'branch.create',
        entity: 'branch',
        entityId: row.id,
        branchId: row.id,
        after: row,
      });
    }

    const categories = [
      ...COLLECTIONS.flatMap(([letter, language]) =>
        KINDS.map((kind, i) => ({
          code: `${letter}${i + 1}`,
          name: `${language} — ${kind.toLowerCase()}`,
        })),
      ),
      ...CHILDREN.map(([code, name]) => ({ code, name })),
    ];
    await tx.insert(category).values(categories);
    await log({ action: 'category.create', entity: 'category', after: categories });

    let copyCount = 0;
    for (const t of TITLES) {
      const [row] = await tx
        .insert(title)
        .values({
          title: t.title,
          writer: t.writer,
          publisher: t.publisher,
          categoryCode: t.categoryCode,
        })
        .returning();
      if (!row) throw new Error('title insert returned nothing');
      await log({
        action: 'title.create',
        entity: 'title',
        entityId: row.id,
        branchId: null,
        after: row,
      });

      for (const [code, count] of Object.entries(t.copies)) {
        const branchId = branchIds[code]!;
        const numbers = await allocateAccessionNumbers(tx, branchId, t.categoryCode, count);
        const rows = await tx
          .insert(copy)
          .values(
            numbers.map((accessionNo) => ({
              accessionNo,
              titleId: row.id,
              branchId,
              accessionedBranchId: branchId,
              source: 'Purchase',
            })),
          )
          .returning();
        copyCount += rows.length;
        await log({ action: 'copy.create', entity: 'copy', branchId, after: rows });
      }
    }

    return {
      skipped: false,
      branches: BRANCHES.length,
      categories: categories.length,
      titles: TITLES.length,
      copies: copyCount,
    };
  });
}
