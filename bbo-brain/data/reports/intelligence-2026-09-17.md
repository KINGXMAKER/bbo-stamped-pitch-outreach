# BBO intelligence review — Core interview content

Generated 2026-09-17 17:57 UTC

> **PROVISIONAL — HUMAN LABEL VALIDATION PENDING.** Every finding below rests on model-assigned attribute labels that no human has checked yet.
> None of it may become a BBO rule until the Coding Validation batch is reviewed.

## Catalogue accounting

All 951 posts, counted once each. "Comparable" is the subset with a peer baseline — the only posts any comparison can use.

| Bucket | Posts | Comparable | Too recent | No baseline | With media | Structurally coded | Analysed |
|---|---|---|---|---|---|---|---|
| Core interview content | 714 | 708 | 4 | 2 | 613 | 143 | yes |
| BBO Stamped | 37 | 36 | 1 | 0 | 33 | 7 | yes |
| Other (ignored) | 165 | 161 | 0 | 4 | 115 | 12 | no |
| Not yet bucketed | 35 | 35 | 0 | 0 | 0 | 0 | no |
| **Total** | **951** | 940 | 5 | 6 | 761 | 162 | |

Inside core interview content, 614 are podcast clips and 97 street interviews, with 3 not yet sub-typed (614 + 97 + 3 = 714). Podcast and street interview are subtypes **inside** this one bucket, not buckets of their own.

**This review's scope.** 708 comparable core interview content posts; 139 of them carry structured coding (143 coded in this bucket in total). Excluded: Other (ignored) 161 comparable, BBO Stamped 36 comparable, 35 not yet bucketed, and the 11 posts of any bucket that have no peer baseline yet. Performance is never pooled across buckets.

**Corpus.** 162 posts structurally coded out of 951 in the catalogue (761 with media, 708 comparable, 0 human-validated). By class: winner 45/40, loser 37/40, average 39/30, unusual 20/20. Coded by: openrouter/qwen/qwen3-vl-32b-instruct 152, openrouter/qwen/qwen3-vl-235b-a22b-instruct 8.

Every claim below is an association measured against BBO's own era-normalised baseline — not a causal statement. Effect is the group median divided by the baseline median.

**Read this with two caveats.**

1. *The coded corpus was sampled on the outcome.* Winners, losers, average controls and unusual posts were selected to fixed quotas, so extremes are over-represented relative to the catalogue. Within such a sample the direction of an association is informative, but median ratios for coded attributes are distorted — treat them as hypotheses to test, not effect sizes. Topic comparisons span the whole catalogue; duration is only known where media was fetched, which followed the same outcome-based priority, so it shares this caveat.
2. *Coded attributes are model labels, none of them human-validated yet.* qwen/qwen3-vl-32b-instruct agrees with its own rerun on 85% of labels and with the earlier coding it replaced on 48% (valid structured output 100%, 1 taxonomy violations in 25) — agreement between models is a consistency signal, not ground truth; human review decides. Fields listed in AI_CODING_UNTRUSTED_FIELDS (franchise) are not written by the model, so comparisons on them rest on heuristics and audits.

## 1. Which hook types currently show the strongest performance association?

| Group | n | Baseline n | Median | Baseline | Effect | Consistency | p | Confidence | Holds in both halves | Date range |
|---|---|---|---|---|---|---|---|---|---|---|
| controversial statement | 40 | 98 | 1.29 | 1.03 | 1.25× | 65% | 0.054 | MODERATE_SIGNAL | yes | 2022-01-26 → 2026-09-10 |
| surprising fact | 24 | 114 | 1.27 | 1.04 | 1.22× | 63% | 0.020 | MODERATE_SIGNAL | yes | 2022-01-26 → 2026-09-10 |
| ⚠ direct opinion | 6 | 132 | 1.11 | 1.06 | 1.05× | 67% | 0.861 | INSUFFICIENT_DATA | no | 2022-01-26 → 2026-09-10 |
| confession | 11 | 127 | 0.96 | 1.10 | 0.88× | 64% | 0.526 | EARLY_SIGNAL | — | 2022-01-26 → 2026-09-10 |
| curiosity gap | 17 | 121 | 0.96 | 1.13 | 0.85× | 65% | 0.381 | MODERATE_SIGNAL | yes | 2022-01-26 → 2026-09-10 |
| ⚠ question | 31 | 107 | 0.93 | 1.13 | 0.82× | 58% | 0.053 | MODERATE_SIGNAL | no | 2022-01-26 → 2026-09-10 |
| ⚠ story opening | 6 | 132 | 0.49 | 1.09 | 0.45× | 67% | 0.113 | EARLY_SIGNAL | — | 2022-01-26 → 2026-09-10 |

⚠ **Era-confounded:** direct opinion, question, story opening — the group and its baseline come from different eras or the direction does not hold in both halves of the data. Direction unproven.

- **controversial statement** — supporting: #942 New clip from my show @fboychroniclesfunny .. @omgitssmil… (4.59); #117 Is that bad communication or are men supposed to just fig… (2.68); #220 Yams on the first night ain’t really a bad thing.. led to… (2.44)
  - contradicting: #597 We continue a conversation from yesterday’s topic about p… (0.42); #673 “I OWE YOU AND YA SIS A DRINK?!” lol classic BBO show cli… (0.43); #676 “YOU LOST ME THERE!” @arinidoll shares her opinion on let… (0.47)
- **surprising fact** — supporting: #51 Not everybody you say ya friend is ya friend cause how th… (2.70); #103 “Wait... 6 guys is a LIGHT day?! 🤯🎙️” (2.58); #29 The double massage while getting d***ed down… @wetkittyci… (2.56)
  - contradicting: #671 Today @famous_briiii shares her crazy ATLANTA skrip club … (0.45); #72 She saw the red flag and and almost made it a lifestyle �… (0.87); #61 This interview started off wild, and only got wilder lmfa… (0.97)
- **direct opinion** — supporting: #206 “That’s why certain people explore...”. The truth nobody … (2.25); #190 Cut or uncut?  Is being circumcised a deal breaker to you… (1.83); #11 We’ve all been there—taking a mental note of a weird mome… (1.13)
  - contradicting: #97 So during our last podcast episode in DC, we talked about… (0.90); #135 Nah JOE from YOU is CRAZY 💀💀💀 (0.93); #154 @wallo267 said it best: “People only subscribe to hot.” T… (1.10)

**Insufficient evidence.** Too few posts to judge: challenge (n=1), payoff first (n=1), emotional statement (n=1).

## 2. Which opening types appear strongest?

| Group | n | Baseline n | Median | Baseline | Effect | Consistency | p | Confidence | Holds in both halves | Date range |
|---|---|---|---|---|---|---|---|---|---|---|
| text first | 32 | 106 | 1.38 | 1.05 | 1.31× | 56% | 0.564 | EARLY_SIGNAL | yes | 2022-01-26 → 2026-09-10 |
| ⚠ visual first | 10 | 128 | 1.33 | 1.06 | 1.25× | 60% | 0.268 | EARLY_SIGNAL | no | 2022-01-26 → 2026-09-10 |
| ⚠ guest answer | 44 | 94 | 1.20 | 1.05 | 1.15× | 57% | 0.229 | MODERATE_SIGNAL | no | 2022-01-26 → 2026-09-10 |
| host statement | 21 | 117 | 1.07 | 1.17 | 0.91× | 67% | 0.687 | MODERATE_SIGNAL | yes | 2022-01-26 → 2026-09-10 |
| interviewer question | 31 | 107 | 0.91 | 1.18 | 0.77× | 65% | 0.060 | MODERATE_SIGNAL | yes | 2022-01-26 → 2026-09-10 |

⚠ **Era-confounded:** visual first, guest answer — the group and its baseline come from different eras or the direction does not hold in both halves of the data. Direction unproven.

- **text first** — supporting: #942 New clip from my show @fboychroniclesfunny .. @omgitssmil… (4.59); #29 The double massage while getting d***ed down… @wetkittyci… (2.56); #258 First date at the crib with Moms is CRAZY. 💀Ladies, what… (2.39)
  - contradicting: #360 Just when you’ve thought you’ve heard it all and seen it … (0.23); #677 Shoutout to all the girls who work nightlife cause yall b… (0.26); #637 When do you know it’s time to let go of someone?  @ohhthi… (0.30)
- **visual first** — supporting: #51 Not everybody you say ya friend is ya friend cause how th… (2.70); #1 Women say effort matters… until the man they’re actually … (1.84); #176 Dating Tip: If the physical chemistry isn’t there, no amo… (1.73)
  - contradicting: #665 Today we get into proper skrippa club etiquette and how i… (0.40); #649 Our latest contestant came through proper as you can see!… (0.50); #44 Let’s be real: Is $80,000 enough to sign an NDA and keep … (0.94)
- **guest answer** — supporting: #117 Is that bad communication or are men supposed to just fig… (2.68); #103 “Wait... 6 guys is a LIGHT day?! 🤯🎙️” (2.58); #220 Yams on the first night ain’t really a bad thing.. led to… (2.44)
  - contradicting: #664 Today we sit with @mala_.ve to talk about what got her in… (0.44); #661 Today we sit with Yatti and she shares her craziest “chea… (0.46); #553 Today 6ix9ine BM ROZ speaks on how she swooped in on 6ix9… (0.48)

## 3. How do interviewer-question openings compare with guest-answer openings?

| Group | n | Baseline n | Median | Baseline | Effect | Consistency | p | Confidence | Holds in both halves | Date range |
|---|---|---|---|---|---|---|---|---|---|---|
| Interviewer question vs guest answer (head-to-head) | 31 | 44 | 0.91 | 1.20 | 0.76× | 65% | 0.041 | MODERATE_SIGNAL | yes | 2024-05-01 → 2026-09-09 |

- **Interviewer question vs guest answer (head-to-head)** — supporting: #682 Today we sit down with rising New York artist @itsgennyge… (0.31); #646 “I’ll break into your house!” Lol @ant.will.made.it has m… (0.37); #623 Today we sit with @ohhthistiana_ as she breaks down what … (0.38)
  - contradicting: #218 Eating and farting is a wild job description if I ever he… (4.15); #209 Look, the streets have been waiting for a format this raw… (2.70); #77 Nah I def wasn’t familiar with your game @desirae.perry.7… (2.68)

## 4. Which topics generate disproportionate shares?

| Group | n | Baseline n | Median | Baseline | Effect | Consistency | p | Confidence | Holds in both halves | Date range |
|---|---|---|---|---|---|---|---|---|---|---|
| Sex | 55 | 448 | 2.33 | 0.98 | 2.37× | 85% | 0.000 | STRONG_SIGNAL | yes | 2022-01-26 → 2026-09-10 |
| ⚠ Communication | 6 | 497 | 1.63 | 1.06 | 1.53× | 67% | 0.203 | EARLY_SIGNAL | — | 2022-01-26 → 2026-09-10 |
| ⚠ Cheating | 28 | 475 | 1.52 | 1.06 | 1.44× | 64% | 0.181 | EARLY_SIGNAL | no | 2022-01-26 → 2026-09-10 |
| ⚠ Gender roles | 55 | 448 | 1.45 | 1.02 | 1.42× | 73% | 0.002 | MODERATE_SIGNAL | no | 2022-01-26 → 2026-09-10 |
| ⚠ Relationships | 143 | 360 | 1.16 | 1.02 | 1.14× | 58% | 0.111 | MODERATE_SIGNAL | no | 2022-01-26 → 2026-09-10 |
| ⚠ Social media | 11 | 492 | 1.18 | 1.06 | 1.11× | 55% | 0.715 | EARLY_SIGNAL | — | 2022-01-26 → 2026-09-10 |
| ⚠ Dating | 91 | 412 | 1.13 | 1.05 | 1.08× | 56% | 0.911 | MODERATE_SIGNAL | no | 2022-01-26 → 2026-09-10 |
| Pop culture & celebrities | 6 | 497 | 1.02 | 1.06 | 0.96× | 50% | 0.919 | INSUFFICIENT_DATA | — | 2022-01-26 → 2026-09-10 |

⚠ **Era-confounded:** Communication, Cheating, Gender roles, Relationships, Social media, Dating — the group and its baseline come from different eras or the direction does not hold in both halves of the data. Direction unproven.

- **Sex** — supporting: #51 Not everybody you say ya friend is ya friend cause how th… (10.00); #206 “That’s why certain people explore...”. The truth nobody … (10.00); #695 Today Steph shares a crazy bedroom story.. never heard of… (10.00)
  - contradicting: #609 Today we get into a CRAZY 1-Night stand story.. enjoy y’a… (0.10); #665 Today we get into proper skrippa club etiquette and how i… (0.10); #199 Today we’re locked in with the one and only @thetriximont… (0.19)
- **Communication** — supporting: #107 She gave the whole manual 😭🔊 (7.44); #193 Talking in the bedroom…  yay or nay?  We discuss… (2.82); #117 Is that bad communication or are men supposed to just fig… (2.18)
  - contradicting: #689 Lol does @itsgennygenn have a point?  Let us know (0.10); #94 Let’s be real. If you know you aren’t packing your bags w… (0.59); #152 Snapple fact of the day, sometimes ya intuition can be wr… (1.09)
- **Cheating** — supporting: #204 “NY to Philly to pop up on a 🥷 is crazy!” (10.00); #209 Look, the streets have been waiting for a format this raw… (10.00); #608 @thedroppagency sits down with us and shares a story abou… (9.96)
  - contradicting: #661 Today we sit with Yatti and she shares her craziest “chea… (0.10); #690 Today’s topic.. what counts as cheating?  @rekbangaa sits… (0.10); #441 Today we do an on the spot interview with rising Boston a… (0.15)

**Insufficient evidence.** Too few posts to judge: Dating with clout (n=1), Exes (n=3).

## 5. Which topics generate disproportionate comments?

| Group | n | Baseline n | Median | Baseline | Effect | Consistency | p | Confidence | Holds in both halves | Date range |
|---|---|---|---|---|---|---|---|---|---|---|
| ⚠ Gender roles | 56 | 652 | 1.29 | 0.88 | 1.47× | 68% | 0.002 | MODERATE_SIGNAL | no | 2022-01-26 → 2026-09-10 |
| Clout & fame | 58 | 650 | 1.10 | 0.88 | 1.25× | 66% | 0.068 | MODERATE_SIGNAL | yes | 2022-01-26 → 2026-09-10 |
| Sex | 66 | 642 | 1.05 | 0.88 | 1.19× | 64% | 0.105 | MODERATE_SIGNAL | yes | 2022-01-26 → 2026-09-10 |
| ⚠ Relationships | 157 | 551 | 1.01 | 0.88 | 1.15× | 57% | 0.162 | MODERATE_SIGNAL | no | 2022-01-26 → 2026-09-10 |
| ⚠ Friendships | 14 | 694 | 1.04 | 0.91 | 1.14× | 50% | 0.586 | EARLY_SIGNAL | no | 2022-01-26 → 2026-09-10 |
| Dating | 136 | 572 | 1.01 | 0.88 | 1.14× | 56% | 0.050 | MODERATE_SIGNAL | yes | 2022-01-26 → 2026-09-10 |
| ⚠ Cheating | 36 | 672 | 0.95 | 0.91 | 1.05× | 50% | 0.677 | MODERATE_SIGNAL | no | 2022-01-26 → 2026-09-10 |
| ⚠ Social media | 14 | 694 | 0.94 | 0.91 | 1.03× | 50% | 0.885 | EARLY_SIGNAL | no | 2022-01-26 → 2026-09-10 |

⚠ **Era-confounded:** Gender roles, Relationships, Friendships, Cheating, Social media — the group and its baseline come from different eras or the direction does not hold in both halves of the data. Direction unproven.

- **Gender roles** — supporting: #218 Eating and farting is a wild job description if I ever he… (10.00); #942 New clip from my show @fboychroniclesfunny .. @omgitssmil… (10.00); #185 Bad s*x = He likes men? Is she onto something or reaching… (5.39)
  - contradicting: #637 When do you know it’s time to let go of someone?  @ohhthi… (0.10); #671 Today @famous_briiii shares her crazy ATLANTA skrip club … (0.10); #590 Once a cheater are they always a cheater?  What yall think? (0.15)
- **Clout & fame** — supporting: #125 Did Nicki copy Lil’ Kim… or just take the blueprint to an… (5.84); #913 Hometown Syndrome, as creatives and entrepreneurs we feel… (5.83); #871 This probably one of the wildest stories ever lol.. surpr… (5.79)
  - contradicting: #360 Just when you’ve thought you’ve heard it all and seen it … (0.10); #602 Today we sit with @dtay_blackie who shares the story on h… (0.10); #734 Today we sit down with the one and only @majorgalore for … (0.10)
- **Sex** — supporting: #813 “I want to get in a headstand!” Today we talk stuff in th… (10.00); #942 New clip from my show @fboychroniclesfunny .. @omgitssmil… (10.00); #185 Bad s*x = He likes men? Is she onto something or reaching… (5.39)
  - contradicting: #743 “Men over performing in the bedroom is a turnoff.” Thats … (0.10); #199 Today we’re locked in with the one and only @thetriximont… (0.11); #598 Today we sit with @roz.verde as she shares her surgery ex… (0.17)

**Insufficient evidence.** Too few posts to judge: Dating with clout (n=2), Exes (n=3).

## 6. Which topics generate comments but weak retention?

Both sides of each pair are measured on era-normalised peer ratios.

**Insufficient evidence.** No topic currently shows above-baseline comments together with below-baseline retention at the minimum sample size.

## 7. Which duration ranges currently perform best?

| Group | n | Baseline n | Median | Baseline | Effect | Consistency | p | Confidence | Holds in both halves | Date range |
|---|---|---|---|---|---|---|---|---|---|---|
| 16-30s | 199 | 407 | 1.02 | 0.98 | 1.04× | 53% | 0.225 | MODERATE_SIGNAL | yes | 2022-01-26 → 2026-09-10 |
| ⚠ 31-45s | 259 | 347 | 1.01 | 0.98 | 1.03× | 52% | 0.929 | MODERATE_SIGNAL | no | 2022-01-26 → 2026-09-10 |
| ⚠ >60s | 29 | 577 | 0.96 | 1.00 | 0.96× | 55% | 0.930 | MODERATE_SIGNAL | no | 2022-01-26 → 2026-09-10 |
| 46-60s | 101 | 505 | 0.96 | 1.01 | 0.96× | 54% | 0.342 | MODERATE_SIGNAL | yes | 2022-01-26 → 2026-09-10 |
| <=15s | 18 | 588 | 0.90 | 1.00 | 0.89× | 61% | 0.463 | MODERATE_SIGNAL | yes | 2022-01-26 → 2026-09-10 |

⚠ **Era-confounded:** 31-45s, >60s — the group and its baseline come from different eras or the direction does not hold in both halves of the data. Direction unproven.

- **16-30s** — supporting: #218 Eating and farting is a wild job description if I ever he… (4.15); #813 “I want to get in a headstand!” Today we talk stuff in th… (3.07); #718 If a guy flies you out, is it automatic yams?  We discuss.. (2.76)
  - contradicting: #677 Shoutout to all the girls who work nightlife cause yall b… (0.26); #637 When do you know it’s time to let go of someone?  @ohhthi… (0.30); #845 Today we sitdown @chinesekitty and she shares stories abo… (0.32)
- **31-45s** — supporting: #739 Today @majorgalore breaks down her viral clip about 3sum.… (3.96); #396 During @eness_215 interview on Vlad he talks about @fred_… (2.79); #209 Look, the streets have been waiting for a format this raw… (2.70)
  - contradicting: #360 Just when you’ve thought you’ve heard it all and seen it … (0.23); #934 Upcoming episode of @thebadbitchesonlyshow where we have … (0.31); #808 We usually let the cap slide on the BBO Show.. but we had… (0.33)
- **>60s** — supporting: #847 From nightlife to a record deal, @itshoneybxby shares her… (0.33); #362 Behind the scenes from our last episode.. enjoy y’all (0.40); #441 Today we do an on the spot interview with rising Boston a… (0.43)
  - contradicting: #871 This probably one of the wildest stories ever lol.. surpr… (3.27); #447 IF THE YAMS THIS GOOD… I DONT WANT IT! 😂😂😂 (3.09); #870 Rising NJ Artist @benniebates sits down with us for a can… (2.23)

## 8. Which attributes repeatedly appear among breakouts?

32 attribute values appear in at least 5 winners; see the frequency table.

## 9. Which attributes repeatedly appear among losers?

32 attribute values appear in at least 5 losers; see the frequency table.

## 10. Which patterns still have insufficient evidence?

11 lessons are still NEW or OBSERVING: L-177, L-039, L-038, L-037, L-036, L-035, A-L009, A-L008, A-L007, A-L005, A-L003.

**Insufficient evidence.** hook type · challenge (n=1) · hook type · payoff first (n=1) · hook type · emotional statement (n=1) · tension type · moral dilemma (n=4) · share trigger type · argument ammo (n=1) · share trigger type · aspirational (n=1) · share trigger type · informative (n=4) · comment trigger type · none (n=2) · reaction timing · later (n=2) · reaction timing · 3 10s (n=2)

## 11. Which existing BBO rules are supported?

| Group | n | Baseline n | Median | Baseline | Effect | Consistency | p | Confidence | Holds in both halves | Date range |
|---|---|---|---|---|---|---|---|---|---|---|
| R-015: Do not repeatedly open clips with interviewer questions when the guest… (consistent with the rule) | 29 | 74 | 0.91 | 1.20 | 0.76× | 66% | 0.054 | MODERATE_SIGNAL | yes | 2022-01-26 → 2026-09-09 |

- **R-015: Do not repeatedly open clips with interviewer questions when the guest… (consistent with the rule)** — supporting: #682 Today we sit down with rising New York artist @itsgennyge… (0.31); #646 “I’ll break into your house!” Lol @ant.will.made.it has m… (0.37); #623 Today we sit with @ohhthistiana_ as she breaks down what … (0.38)
  - contradicting: #218 Eating and farting is a wild job description if I ever he… (4.15); #209 Look, the streets have been waiting for a format this raw… (2.70); #77 Nah I def wasn’t familiar with your game @desirae.perry.7… (2.68)

5 of 15 active rules are machine-testable; the others are editorial principles this data cannot confirm or refute.

**Insufficient evidence.** R-005 — era-confounded, cannot judge (n=5 vs 129, effect 0.32×, median dates 698 days apart, halves agree: —); R-007 — era-confounded, cannot judge (n=12 vs 38, effect 0.93×, median dates 30 days apart, halves agree: false); R-008 — no meaningful difference (n=581 vs 127, effect 1.04×, median dates 82 days apart, halves agree: true); R-014 — era-confounded, cannot judge (n=31 vs 371, effect 0.71×, median dates 575 days apart, halves agree: —)

## 12. Which existing BBO rules are being challenged?

No open challenge in the rule engine (a challenge needs repeated contrary evidence, not one pass).

## 13. What 3–5 deliberate experiments should BBO run next?

| Group | n | Baseline n | Median | Baseline | Effect | Consistency | p | Confidence | Holds in both halves | Date range |
|---|---|---|---|---|---|---|---|---|---|---|
| Interviewer question vs guest answer (head-to-head) | 31 | 44 | 0.91 | 1.20 | 0.76× | 65% | 0.041 | MODERATE_SIGNAL | yes | 2024-05-01 → 2026-09-09 |
| interviewer question | 31 | 107 | 0.91 | 1.18 | 0.77× | 65% | 0.060 | MODERATE_SIGNAL | yes | 2022-01-26 → 2026-09-10 |
| controversial statement | 40 | 98 | 1.29 | 1.03 | 1.25× | 65% | 0.054 | MODERATE_SIGNAL | yes | 2022-01-26 → 2026-09-10 |
| surprising fact | 24 | 114 | 1.27 | 1.04 | 1.22× | 63% | 0.020 | MODERATE_SIGNAL | yes | 2022-01-26 → 2026-09-10 |

- **Interviewer question vs guest answer (head-to-head)** — supporting: #682 Today we sit down with rising New York artist @itsgennyge… (0.31); #646 “I’ll break into your house!” Lol @ant.will.made.it has m… (0.37); #623 Today we sit with @ohhthistiana_ as she breaks down what … (0.38)
  - contradicting: #218 Eating and farting is a wild job description if I ever he… (4.15); #209 Look, the streets have been waiting for a format this raw… (2.70); #77 Nah I def wasn’t familiar with your game @desirae.perry.7… (2.68)
- **interviewer question** — supporting: #682 Today we sit down with rising New York artist @itsgennyge… (0.31); #646 “I’ll break into your house!” Lol @ant.will.made.it has m… (0.37); #623 Today we sit with @ohhthistiana_ as she breaks down what … (0.38)
  - contradicting: #218 Eating and farting is a wild job description if I ever he… (4.15); #209 Look, the streets have been waiting for a format this raw… (2.70); #77 Nah I def wasn’t familiar with your game @desirae.perry.7… (2.68)
- **controversial statement** — supporting: #942 New clip from my show @fboychroniclesfunny .. @omgitssmil… (4.59); #117 Is that bad communication or are men supposed to just fig… (2.68); #220 Yams on the first night ain’t really a bad thing.. led to… (2.44)
  - contradicting: #597 We continue a conversation from yesterday’s topic about p… (0.42); #673 “I OWE YOU AND YA SIS A DRINK?!” lol classic BBO show cli… (0.43); #676 “YOU LOST ME THERE!” @arinidoll shares her opinion on let… (0.47)

The findings above are the strongest associations worth converting into controlled tests (same topic and guest, one variable changed). 8 experiment(s) are already proposed or running.

## 14. Based on current evidence, what should BBO make next?

8 open opportunities, each tied to evidence.

### Attributes over-represented among breakouts and winners

| Attribute | Value | In group | Group share | Rest share | Lift | Examples |
|---|---|---|---|---|---|---|
| editing style | meme card | 5 | 11% | 5% | 2.09× | #258, #173 |
| tension type | exposure | 6 | 15% | 8% | 1.94× | #51, #120 |
| hook type | controversial statement | 18 | 40% | 24% | 1.69× | #942, #117 |
| emotional trigger | shock | 31 | 69% | 41% | 1.69× | #942, #209 |
| opening type | text first | 14 | 31% | 19% | 1.61× | #942, #29 |
| share trigger type | shocking | 36 | 80% | 54% | 1.49× | #942, #209 |
| hook type | surprising fact | 10 | 22% | 15% | 1.48× | #51, #103 |
| reaction timing | none | 15 | 33% | 23% | 1.42× | #942, #51 |
| tension type | gender conflict | 23 | 56% | 43% | 1.30× | #942, #218 |
| comment trigger type | take a side | 42 | 95% | 77% | 1.24× | #942, #218 |
| duration bucket | 16-30s | 46 | 37% | 32% | 1.16× | #218, #813 |
| editing style | static graphic | 12 | 27% | 23% | 1.14× | #209, #51 |

### Attributes over-represented among losers and below-average posts

| Attribute | Value | In group | Group share | Rest share | Lift | Examples |
|---|---|---|---|---|---|---|
| tension type | none | 5 | 15% | 0% | ∞ | #640, #610 |
| emotional trigger | curiosity | 13 | 39% | 10% | 4.14× | #225, #649 |
| comment trigger type | personal experience | 10 | 31% | 11% | 2.95× | #649, #598 |
| hook type | question | 14 | 42% | 16% | 2.62× | #225, #662 |
| opening type | interviewer question | 14 | 42% | 16% | 2.62× | #640, #199 |
| tension type | disagreement | 5 | 15% | 7% | 2.19× | #688, #590 |
| share trigger type | relatable | 15 | 45% | 24% | 1.91× | #649, #662 |
| hook type | curiosity gap | 6 | 18% | 10% | 1.74× | #640, #238 |
| editing style | podcast panel cut | 23 | 68% | 50% | 1.34× | #225, #640 |
| tension type | confession stakes | 8 | 24% | 19% | 1.29× | #609, #598 |
| duration bucket | <=15s | 7 | 3% | 3% | 1.17× | #63, #464 |
| duration bucket | 46-60s | 39 | 18% | 16% | 1.15× | #897, #524 |

### Experiments proposed or running

- **X-009** confession marker: true vs false (proposed) — Early signal worth testing deliberately: Posts with confession marker = yes are associated with stronger performance score than other posts: 1.64x the median across 5 vs 111 posts (2026-05-11 → 2026-08-07).
- **X-L009** Same topic, caption opening question vs statement (proposed) — Post the same topic/format twice with only the caption opening changed (question vs statement) and compare deep action rate directly.
- **X-L008** Catfish premise recut with higher personal stakes vs retire the premise (proposed) — Recut with higher personal stakes (per the 2026-09-15 audit's specific suggestion: 'she found his receipts after she'd already told her mom about him') and see if the sympathy framing lands differently, or retire the premise.
- **X-L007** Guest-tagged vs untagged captions within relationship content only (proposed) — Compare tagged vs untagged inside the relationship_dating lane only, where both occur.
- **X-L005** Specific decision CTA on five consecutive posts vs no-CTA cohort (proposed) — Add a specific decision CTA to five consecutive posts and compare deep action against the 74-post no-CTA cohort.
- **X-L004** Business lesson reframed as a contrarian claim with a decision CTA (proposed) — Reframe one business lesson as a contrarian claim with a decision CTA; compare deep action rate against the lane median of 1.16%.
- **X-L003** BBO Stamped "does it match the hype?" verdict vs standard recap (proposed) — Publish two venue posts in the same fortnight — one 'does it match the hype?' verdict format, one standard recap — and compare share rate.
- **X-L002** 25s dense cut vs 50s full cut of the same interview (proposed) — Cut the same interview two ways — 25s dense vs 50s full — and compare deep action rate.

### What to make next

- **Sex is working — keep it in rotation** (1.58) — Sex scores 1.58x other posts across 67 vs 873; used 2 time(s) in the last 14 days. Median share rate 2.4x comparable posts.
- **Pop culture & celebrities is working — keep it in rotation** (1.09) — Pop culture & celebrities scores 1.28x other posts across 11 vs 929; used 2 time(s) in the last 14 days. Median share rate 1.0x comparable posts.
- **Bring @benniebates back** (1.02) — Content featuring @benniebates has a median score of 1.69 across 3 appearances, median share rate 0.1x comparable posts; last appearance 2023-08-25.
- **Use more hook type: surprising fact** (1.01) — Hook type = surprising fact is associated with 1.26x the performance score of other posts (27 vs 117).
- **Use more cta: comment specific** (0.95) — CTA = comment specific is associated with 1.99x the performance score of other posts (5 vs 935).
- **Communication is working — keep it in rotation** (0.89) — Communication scores 1.49x other posts across 6 vs 934; used 1 time(s) in the last 14 days. Median share rate 2.2x comparable posts.
- **Bring @djkenz_ back** (0.89) — Content featuring @djkenz_ has a median score of 2.96 across 2 appearances, median share rate 5.0x comparable posts; last appearance 2021-09-06.
- **Bring @kimarixo back** (0.88) — Content featuring @kimarixo has a median score of 1.47 across 4 appearances, median share rate 0.1x comparable posts; last appearance 2023-12-31.
