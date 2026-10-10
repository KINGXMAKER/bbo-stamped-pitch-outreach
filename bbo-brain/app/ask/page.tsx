import { PageHead } from '@/components/ui';
import { AskConsole } from './ask-console';
import { aiConfigured } from '@/lib/ai/run';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ask BBO' };

export default function AskPage() {
  return (
    <>
      <PageHead
        kicker="Ask BBO"
        title="Ask what BBO has learned"
        lede={
          <>
            Every answer is calculated from BBO&apos;s own records first, then explained. <em>The evidence sits next to every answer</em> — sample size, dates, baseline, the posts behind it.
          </>
        }
      />
      <AskConsole aiEnabled={aiConfigured()} />
    </>
  );
}
