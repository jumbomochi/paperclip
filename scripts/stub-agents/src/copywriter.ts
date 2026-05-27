import { createDraft, transitionStatus, getDraft } from '@paperclip/drafts-mcp';
import { DraftStatus, Platform } from '@paperclip/db';

const cannedVariants: Record<Platform, string[]> = {
  [Platform.X]: [
    "what if your newsletter could find subscribers while you sleep? the math: 1 post, 5 platforms, ~8 hours of organic.",
    "shipped: an AI agency for my newsletter that posts on x + linkedin, attributes signups via utm, and feeds wins back into next week's copy.",
    "took the 'agent does my marketing' meme literally. 6 weeks in. 3 takeaways:\n\n1) attribution > vanity\n2) hook tagging is the unlock\n3) editors-as-agents catch 4/5 dud drafts",
  ],
  [Platform.LinkedIn]: [
    "I built a marketing agency staffed entirely by AI agents. It runs my newsletter's audience growth on X + LinkedIn, attributes every new subscriber to a specific post, and feeds those learnings back into next week's drafts. Here's what surprised me about week one: the editor agent catches things I would have shipped without thinking — banned phrases, missing CTAs, posts trending too long. Voice consistency improved, not despite the agents, but because of them. The agency now publishes more reliably than I did manually, and the daily approval queue is 5 minutes of work.",
    "Most 'AI for marketing' tools generate posts. None of them close the loop. So I built one that tags every draft with its hook, snapshots performance over 7 days, and surfaces the top-5 winners back to the drafter. The result: every weekly batch of posts learns from the last. Hook leaderboards become a tangible artifact. Themes that drove subscribers get reinforced; themes that didn't, quietly retire. Open-source link in comments.",
    "After 6 weeks of running an AI marketing agency on Paperclip, three patterns: (1) measured posts outperform 'just shipped' posts 4:1, (2) hook taxonomy is the unlock — without it, you're guessing, (3) approval queue UI matters more than the agents. The cognitive load of approving 6 drafts in 5 minutes is the entire human cost of operation. Builds intuition for what works without ever writing copy myself.",
  ],
};

const hookTags: string[] = ['question-opener', 'numbered-list', 'behind-the-scenes'];

export async function draft({ briefId, platform }: { briefId: string; platform: Platform }) {
  const brief = await getDraft({ id: briefId });
  if (!brief) throw new Error('brief not found');
  const variants = cannedVariants[platform];
  const created: string[] = [];
  for (let i = 0; i < variants.length; i++) {
    const v = await createDraft({
      platform,
      parentBriefId: briefId,
      status: DraftStatus.Drafted,
      body: variants[i]!,
      hookTag: hookTags[i % hookTags.length],
    });
    created.push(v.id);
  }
  return created;
}

export async function moveToEditorReview(draftId: string) {
  return transitionStatus({ draftId, to: DraftStatus.EditorReview, actor: 'stub:copywriter' });
}
