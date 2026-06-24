const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Load environment variables
try {
  const envPath = path.join(__dirname, '../../.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    lines.forEach(line => {
      const parts = line.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const val = parts.slice(1).join('=').trim();
        process.env[key] = val;
      }
    });
  }
} catch(e) {
  console.error('Failed to load .env file:', e);
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const geminiKey = process.env.GEMINI_API_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase credentials missing in process.env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const examples = [
  {
    channel: 'email',
    venue_type: 'Lounge',
    gap_type: 'Product-Only',
    content: `Let me keep this short.

I came across AYA Hookah Lounge and had to reach out. The upscale branding, the specific entertainment like karaoke — you've clearly built a premium experience in New Jersey. But here's what I noticed: your Instagram feels mostly event-focused and product-focused right now. The lounge looks great, but there isn't enough lifestyle content showing real people eating, reacting, posting, and experiencing AYA. That matters because people don't only choose where to go based on what's happening; they choose based on what looks active, trusted, and worth pulling up to. If the feed feels quiet, the lounge feels quiet — even when it's not. That's exactly what BBO Stamped was built to fix. We activate your space with a curated group of creators and a media team. Real people enjoying your atmosphere, reacting to it, posting it, tagging it across social media — turning AYA into the spot people are already talking about. Not staged. Not stiff. Actual lifestyle energy that makes someone stop scrolling and pull up. Would love to schedule a quick 5 minute call to discuss this more. Here are past activations we did:

1Republik in North Arlington, NJ:
https://www.instagram.com/reel/DXvH2HIRf-3/
https://www.instagram.com/p/DX7Ro4jGsnt?img_index=6
https://www.instagram.com/dabboshow/reel/DXzJIMmRKmz/

Hyde and Seek speakeasy in Brooklyn:
https://www.instagram.com/reels/DYYanF-Fr96/
https://www.instagram.com/p/DYiLhhnocst/
https://www.instagram.com/bbohub/p/DZFleqljodX/

BBO Universe | Curated Content Activations
bbouniverse.com
Instagram: @dabboshow`,
    outcome: 'replied',
    outcome_score: 50
  },
  {
    channel: 'email',
    venue_type: 'Restaurant',
    gap_type: 'Flyer-Only Marketing',
    content: `Hey,

I'll keep this short — I run BBO, and we have a content series called BBO Stamped. We bring a curated group of women and creators to a venue and produce lifestyle content around the food, drinks, service, and vibe.

Here's the real reason I reached out — a lot of spots have good food or great service, but the online presence does not show the full experience. Flyers, plain product shots, random reposts — that stuff doesn't move people anymore.

Every day that goes by without the right content is another customer who checked your page, didn't feel it, and went somewhere else. They didn't leave because the product was bad — they left because the page didn't sell the experience.

What actually works is seeing the right crowd in the room — real women posting their real experience, the place feeling like somewhere worth pulling up to. That's the gap. That's what BBO Stamped fills.
You can checkout our work here:

https://www.instagram.com/p/DXvH2HIRf-3/

BBO Universe | Curated Content Activations
bbouniverse.com
Instagram: @dabboshow`,
    outcome: 'replied',
    outcome_score: 50
  },
  {
    channel: 'email',
    venue_type: 'Restaurant',
    gap_type: 'Good Business, Weak Perception',
    content: `Your Lady Fingers concept is truly unique for Bloomfield — I appreciate the blend of sophisticated bakery and cocktail lounge creates a distinct draw. We see a real opportunity to capture the full essence of that experience and bring it to life across social media.

Social presence isn't optional anymore; it's how people discover you, trust you, and decide to spend money with you. Many businesses struggle to consistently produce the kind of high-quality content that truly showcases their unique offering and atmosphere. This is where BBO steps in.

We activate venues like yours. This isn't a single influencer visit. We bring multiple curated creators to Lady Fingers simultaneously that fit your target demographic and generate a full creative production. Our media team curates multiple food review reels, professional photography, skit content and react videos, all in one activation. Our audience is native to NJ and NYC — these are your actual potential customers seeing Lady Fingers through a premium lens. The best part? You get various creators posting tagging and collating with your brand as people buy from recommendations of other real people they know. I can then show you how to run targeted ads with the curated content local to your business to bring in additional foot traffic.
Here are a few content activations we did:
https://www.instagram.com/dabboshow/reel/DXvH2HIRf-3/
https://www.instagram.com/reel/DYYanF-Fr96/
https://www.instagram.com/dabboshow/reel/DXzJIMmRKmz/
https://www.instagram.com/p/DX7Ro4jGsnt/?img_index=2

Would love to talk more about this over a quick call. Please let me know your availability.
BBO Universe | Curated Content Activations
bbouniverse.com
Instagram: @dabboshow`,
    outcome: 'booked',
    outcome_score: 100
  }
];

async function seed() {
  console.log('Seeding initial examples into Supabase...');
  for (const ex of examples) {
    // Check if it already exists to avoid duplicates
    const { data: existing } = await supabase
      .from('pitch_examples')
      .select('id')
      .eq('content', ex.content)
      .maybeSingle();

    if (!existing) {
      const { data, error } = await supabase
        .from('pitch_examples')
        .insert(ex)
        .select()
        .single();

      if (error) {
        console.error(`Failed to insert example:`, error);
      } else {
        console.log(`Inserted example: ${data.id}`);
      }
    } else {
      console.log('Example already exists, skipping.');
    }
  }

  // Trigger voice profile rebuild
  console.log('Running voice profile extraction...');
  const { extractVoiceProfile } = require('./shared');
  const genAI = new GoogleGenerativeAI(geminiKey);
  try {
    const { profile, count } = await extractVoiceProfile(supabase, genAI);
    console.log(`Successfully built voice profile from ${count} examples!`);
    console.log(JSON.stringify(profile, null, 2));
  } catch (err) {
    console.error('Failed to build voice profile:', err);
  }
  console.log('Seeding complete.');
}

seed();
