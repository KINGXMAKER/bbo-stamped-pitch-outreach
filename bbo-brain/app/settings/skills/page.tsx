import { editSkillAction } from '@/app/actions';
import { SubmitButton } from '@/components/client';
import { Notice } from '@/components/notice';
import { fmtDate, PageHead, Section } from '@/components/ui';
import { getDb } from '@/lib/db/client';
import { activeSkill, SKILL_SLUGS, skillHistory } from '@/lib/ai/skills';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Skills' };

export default async function Skills({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const db = getDb();
  return (
    <>
      <Notice searchParams={sp as Record<string, string>} />
      <PageHead kicker="Settings · Skills" title="Skills" lede={<>The operating instructions the AI workflows follow. Every save is a new version, mirrored to the <span className="mono">skills/</span> folder, and every AI run records the version it used.</>} />
      {SKILL_SLUGS.map((slug) => {
        const active = activeSkill(db, slug);
        const history = skillHistory(db, slug);
        return (
          <Section key={slug} title={slug} note={active ? `v${active.version} active` : 'not imported'}>
            <div className="split">
              <form action={editSkillAction} className="card stack-sm">
                <input type="hidden" name="slug" value={slug} />
                <textarea className="textarea mono xs" name="body" defaultValue={active?.body ?? ''} style={{ minHeight: '28rem' }} />
                <input className="input" name="notes" placeholder="What changed and why" required />
                <SubmitButton className="btn btn-primary">Save new version</SubmitButton>
              </form>
              <div className="card stack-xs">
                <div className="kicker kicker-muted">Versions</div>
                {history.map((h) => (
                  <div key={h.id} className="spread xs">
                    <span>
                      <span className={`mono ${h.is_active ? 'pink' : 'muted'}`}>v{h.version}</span> {h.notes}
                    </span>
                    <span className="muted nowrap">{fmtDate(h.created_at, true)}</span>
                  </div>
                ))}
              </div>
            </div>
          </Section>
        );
      })}
    </>
  );
}
