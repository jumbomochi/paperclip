import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, drafts, DraftStatus, Platform } from '@paperclip/db';

const createSchema = z.object({
  platform: z.enum([Platform.X, Platform.LinkedIn]),
  status: z.string().default(DraftStatus.ApprovalQueue),
  body: z.string().default(''),
  hookTag: z.string().optional(),
});

export async function POST(req: Request) {
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  const [row] = await db.insert(drafts).values(parsed.data).returning();
  return NextResponse.json(row, { status: 201 });
}
