import { db, digests } from '@paperclip/db';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import Markdown from 'react-markdown';

export const dynamic = 'force-dynamic';

export default async function DigestDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [row] = await db.select().from(digests).where(eq(digests.id, id));
  if (!row) notFound();
  return (
    <main className="mx-auto max-w-3xl p-6 space-y-4">
      <header className="space-y-1">
        <p className="text-xs uppercase text-zinc-500">{row.kind} digest</p>
        <p className="font-mono text-xs text-zinc-500">{row.createdAt.toISOString()}</p>
      </header>
      <article className="prose prose-zinc dark:prose-invert max-w-none">
        <Markdown>{row.contentMd}</Markdown>
      </article>
    </main>
  );
}
