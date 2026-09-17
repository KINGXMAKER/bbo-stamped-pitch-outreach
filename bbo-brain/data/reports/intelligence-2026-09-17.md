# BBO intelligence review

Generated 2026-09-17 03:05 UTC

**Corpus.** 150 posts structurally coded out of 951 in the catalogue (174 with media, 940 comparable, 0 human-validated). By class: winner 47/40, loser 31/40, average 39/30, unusual 24/20. Coded by: openrouter/qwen/qwen3-vl-32b-instruct 140, openrouter/qwen/qwen3-vl-235b-a22b-instruct 8.

Every claim below is an association measured against BBO's own era-normalised baseline — not a causal statement. Effect is the group median divided by the baseline median.

**Read this with two caveats.**

1. *The coded corpus was sampled on the outcome.* Winners, losers, average controls and unusual posts were selected to fixed quotas, so extremes are over-represented relative to the catalogue. Within such a sample the direction of an association is informative, but median ratios for coded attributes are distorted — treat them as hypotheses to test, not effect sizes. Topic comparisons span the whole catalogue; duration is only known where media was fetched, which followed the same outcome-based priority, so it shares this caveat.
2. *Coded attributes are model labels, none of them human-validated yet.* qwen/qwen3-vl-32b-instruct agrees with its own rerun on 85% of labels and with the earlier coding it replaced on 48% (valid structured output 100%, 1 taxonomy violations in 25) — agreement between models is a consistency signal, not ground truth; human review decides. Fields listed in AI_CODING_UNTRUSTED_FIELDS (franchise) are not written by the model, so comparisons on them rest on heuristics and audits.

## 1. Which hook types currently show the strongest performance association?

| Group | n | Baseline n | Median | Baseline | Effect | Consistency | p | Confidence | Holds in both halves | Date range |
|---|---|---|---|---|---|---|---|---|---|---|
| surprising fact | 27 | 117 | 1.33 | 1.06 | 1.26× | 67% | 0.005 | STRONG_SIGNAL | yes | 2021-10-14 → 2026-09-11 |
| controversial statement | 40 | 104 | 1.29 | 1.03 | 1.25× | 68% | 0.062 | MODERATE_SIGNAL | yes | 2021-10-14 → 2026-09-11 |
| ⚠ direct opinion | 6 | 138 | 1.11 | 1.09 | 1.02× | 67% | 0.921 | INSUFFICIENT_DATA | no | 2021-10-14 → 2026-09-11 |
| ⚠ question | 29 | 115 | 1.03 | 1.13 | 0.92× | 55% | 0.183 | MODERATE_SIGNAL | no | 2021-10-14 → 2026-09-11 |
| ⚠ confession | 9 | 135 | 1.01 | 1.13 | 0.90× | 67% | 0.621 | EARLY_SIGNAL | no | 2021-10-14 → 2026-09-11 |
| curiosity gap | 22 | 122 | 0.95 | 1.18 | 0.81× | 73% | 0.017 | MODERATE_SIGNAL | yes | 2021-10-14 → 2026-09-11 |

⚠ **Era-confounded:** direct opinion, question, confession — the group and its baseline come from different eras or the direction does not hold in both halves of the data. Direction unproven.

- **surprising fact** — supporting: #947 Niggas be scared to talk during sex.. meanwhile I’m like … (4.72); #51 Not everybody you say ya friend is ya friend cause how th… (2.70); #103 “Wait... 6 guys is a LIGHT day?! 🤯🎙️” (2.58)
  - contradicting: #72 She saw the red flag and and almost made it a lifestyle �… (0.87); #23 Don’t ask me how I know the advice works… just do as I sa… (0.90); #61 This interview started off wild, and only got wilder lmfa… (0.97)
- **controversial statement** — supporting: #942 New clip from my show @fboychroniclesfunny .. @omgitssmil… (4.59); #117 Is that bad communication or are men supposed to just fig… (2.68); #220 Yams on the first night ain’t really a bad thing.. led to… (2.44)
  - contradicting: #597 We continue a conversation from yesterday’s topic about p… (0.42); #155 See what we had to deal with yall?  Really had to end the… (0.45); #553 Today 6ix9ine BM ROZ speaks on how she swooped in on 6ix9… (0.48)
- **direct opinion** — supporting: #206 “That’s why certain people explore...”. The truth nobody … (2.25); #190 Cut or uncut?  Is being circumcised a deal breaker to you… (1.83); #11 We’ve all been there—taking a mental note of a weird mome… (1.13)
  - contradicting: #97 So during our last podcast episode in DC, we talked about… (0.90); #135 Nah JOE from YOU is CRAZY 💀💀💀 (0.93); #154 @wallo267 said it best: “People only subscribe to hot.” T… (1.10)

**Insufficient evidence.** Too few posts to judge: story opening (n=4), challenge (n=1), humor (n=2), payoff first (n=1), status clout statement (n=1), emotional statement (n=1), other (n=1).

## 2. Which opening types appear strongest?

| Group | n | Baseline n | Median | Baseline | Effect | Consistency | p | Confidence | Holds in both halves | Date range |
|---|---|---|---|---|---|---|---|---|---|---|
| ⚠ guest answer | 41 | 104 | 1.22 | 1.06 | 1.15× | 56% | 0.204 | MODERATE_SIGNAL | no | 2021-10-14 → 2026-09-11 |
| ⚠ text first | 43 | 102 | 1.21 | 1.06 | 1.14× | 56% | 0.560 | MODERATE_SIGNAL | no | 2021-10-14 → 2026-09-11 |
| ⚠ visual first | 11 | 134 | 1.18 | 1.09 | 1.08× | 55% | 0.730 | EARLY_SIGNAL | no | 2021-10-14 → 2026-09-11 |
| host statement | 20 | 125 | 1.07 | 1.15 | 0.93× | 65% | 0.720 | MODERATE_SIGNAL | yes | 2021-10-14 → 2026-09-11 |
| interviewer question | 29 | 116 | 0.93 | 1.16 | 0.80× | 62% | 0.139 | MODERATE_SIGNAL | yes | 2021-10-14 → 2026-09-11 |

⚠ **Era-confounded:** guest answer, text first, visual first — the group and its baseline come from different eras or the direction does not hold in both halves of the data. Direction unproven.

- **guest answer** — supporting: #117 Is that bad communication or are men supposed to just fig… (2.68); #103 “Wait... 6 guys is a LIGHT day?! 🤯🎙️” (2.58); #220 Yams on the first night ain’t really a bad thing.. led to… (2.44)
  - contradicting: #641 Now that our balloon episode has completed back to regula… (0.41); #553 Today 6ix9ine BM ROZ speaks on how she swooped in on 6ix9… (0.48); #598 Today we sit with @roz.verde as she shares her surgery ex… (0.49)
- **text first** — supporting: #947 Niggas be scared to talk during sex.. meanwhile I’m like … (4.72); #942 New clip from my show @fboychroniclesfunny .. @omgitssmil… (4.59); #29 The double massage while getting d***ed down… @wetkittyci… (2.56)
  - contradicting: #360 Just when you’ve thought you’ve heard it all and seen it … (0.23); #637 When do you know it’s time to let go of someone?  @ohhthi… (0.30); #475 A lil behind the scenes recap of our Philly episode!  Eve… (0.32)
- **visual first** — supporting: #51 Not everybody you say ya friend is ya friend cause how th… (2.70); #1 Women say effort matters… until the man they’re actually … (1.84); #176 Dating Tip: If the physical chemistry isn’t there, no amo… (1.73)
  - contradicting: #348 BBO ALL ACCESS EPISODE 1 FT @mingluanli OUT NOW 🔥 Catch … (0.39); #615 6FT  Tall 🥷🏿’s have it TOO easy out here lmfao ! 😂😂 (0.42); #649 Our latest contestant came through proper as you can see!… (0.50)

**Insufficient evidence.** Too few posts to judge: other (n=1).

## 3. How do interviewer-question openings compare with guest-answer openings?

| Group | n | Baseline n | Median | Baseline | Effect | Consistency | p | Confidence | Holds in both halves | Date range |
|---|---|---|---|---|---|---|---|---|---|---|
| Interviewer question vs guest answer (head-to-head) | 29 | 41 | 0.93 | 1.22 | 0.76× | 62% | 0.078 | MODERATE_SIGNAL | yes | 2024-07-08 → 2026-09-11 |

- **Interviewer question vs guest answer (head-to-head)** — supporting: #646 “I’ll break into your house!” Lol @ant.will.made.it has m… (0.37); #623 Today we sit with @ohhthistiana_ as she breaks down what … (0.38); #342 Today we catchup with @mingluanli as she spills the tea o… (0.39)
  - contradicting: #218 Eating and farting is a wild job description if I ever he… (4.15); #209 Look, the streets have been waiting for a format this raw… (2.70); #77 Nah I def wasn’t familiar with your game @desirae.perry.7… (2.68)

## 4. Which topics generate disproportionate shares?

| Group | n | Baseline n | Median | Baseline | Effect | Consistency | p | Confidence | Holds in both halves | Date range |
|---|---|---|---|---|---|---|---|---|---|---|
| Sex | 55 | 645 | 2.37 | 0.92 | 2.57× | 89% | 0.000 | STRONG_SIGNAL | yes | 2021-06-03 → 2026-09-13 |
| ⚠ Communication | 5 | 695 | 2.18 | 0.99 | 2.21× | 80% | 0.080 | EARLY_SIGNAL | — | 2021-06-03 → 2026-09-13 |
| Gender roles | 54 | 646 | 1.65 | 0.94 | 1.76× | 81% | 0.000 | STRONG_SIGNAL | yes | 2021-06-03 → 2026-09-13 |
| ⚠ Cheating | 28 | 672 | 1.43 | 0.98 | 1.46× | 64% | 0.286 | EARLY_SIGNAL | no | 2021-06-03 → 2026-09-13 |
| ⚠ Relationships | 146 | 554 | 1.19 | 0.91 | 1.30× | 68% | 0.000 | MODERATE_SIGNAL | no | 2021-06-03 → 2026-09-13 |
| ⚠ Dating | 99 | 601 | 1.11 | 0.97 | 1.14× | 58% | 0.733 | MODERATE_SIGNAL | no | 2021-06-03 → 2026-09-13 |
| ⚠ Social media | 17 | 683 | 1.06 | 0.99 | 1.07× | 53% | 0.810 | MODERATE_SIGNAL | no | 2021-06-03 → 2026-09-13 |
| Creator business | 18 | 682 | 1.03 | 0.99 | 1.04× | 50% | 0.884 | MODERATE_SIGNAL | yes | 2021-06-03 → 2026-09-13 |

⚠ **Era-confounded:** Communication, Cheating, Relationships, Dating, Social media — the group and its baseline come from different eras or the direction does not hold in both halves of the data. Direction unproven.

- **Sex** — supporting: #51 Not everybody you say ya friend is ya friend cause how th… (10.00); #206 “That’s why certain people explore...”. The truth nobody … (10.00); #695 Today Steph shares a crazy bedroom story.. never heard of… (10.00)
  - contradicting: #609 Today we get into a CRAZY 1-Night stand story.. enjoy y’a… (0.10); #199 Today we’re locked in with the one and only @thetriximont… (0.19); #467 After the last clip, curious minds had to ask @mctherocks… (0.22)
- **Communication** — supporting: #107 She gave the whole manual 😭🔊 (7.44); #193 Talking in the bedroom…  yay or nay?  We discuss… (2.82); #117 Is that bad communication or are men supposed to just fig… (2.18)
  - contradicting: #94 Let’s be real. If you know you aren’t packing your bags w… (0.59); #152 Snapple fact of the day, sometimes ya intuition can be wr… (1.09); #117 Is that bad communication or are men supposed to just fig… (2.18)
- **Gender roles** — supporting: #218 Eating and farting is a wild job description if I ever he… (10.00); #947 Niggas be scared to talk during sex.. meanwhile I’m like … (10.00); #103 “Wait... 6 guys is a LIGHT day?! 🤯🎙️” (9.66)
  - contradicting: #610 @buccsreallyraw came through and dropped a bar!!! Listen … (0.10); #615 6FT  Tall 🥷🏿’s have it TOO easy out here lmfao ! 😂😂 (0.10); #155 See what we had to deal with yall?  Really had to end the… (0.33)

**Insufficient evidence.** Too few posts to judge: Dating with clout (n=1), Exes (n=3).

## 5. Which topics generate disproportionate comments?

| Group | n | Baseline n | Median | Baseline | Effect | Consistency | p | Confidence | Holds in both halves | Date range |
|---|---|---|---|---|---|---|---|---|---|---|
| ⚠ Gender roles | 55 | 885 | 1.28 | 0.89 | 1.44× | 65% | 0.008 | MODERATE_SIGNAL | no | 2021-06-03 → 2026-09-13 |
| Sex | 67 | 873 | 1.08 | 0.89 | 1.22× | 64% | 0.115 | MODERATE_SIGNAL | yes | 2021-06-03 → 2026-09-13 |
| Clout & fame | 73 | 867 | 1.08 | 0.89 | 1.22× | 62% | 0.171 | MODERATE_SIGNAL | yes | 2021-06-03 → 2026-09-13 |
| Dating | 147 | 793 | 1.01 | 0.89 | 1.14× | 56% | 0.110 | MODERATE_SIGNAL | yes | 2021-06-03 → 2026-09-13 |
| ⚠ Relationships | 162 | 778 | 0.96 | 0.89 | 1.08× | 55% | 0.697 | MODERATE_SIGNAL | no | 2021-06-03 → 2026-09-13 |
| ⚠ Social media | 20 | 920 | 0.96 | 0.90 | 1.06× | 55% | 0.566 | MODERATE_SIGNAL | no | 2021-06-03 → 2026-09-13 |
| ⚠ Cheating | 36 | 904 | 0.95 | 0.91 | 1.05× | 50% | 0.921 | MODERATE_SIGNAL | no | 2021-06-03 → 2026-09-13 |
| ⚠ Creator business | 25 | 915 | 0.92 | 0.90 | 1.02× | 52% | 0.898 | MODERATE_SIGNAL | no | 2021-06-03 → 2026-09-13 |

⚠ **Era-confounded:** Gender roles, Relationships, Social media, Cheating, Creator business — the group and its baseline come from different eras or the direction does not hold in both halves of the data. Direction unproven.

- **Gender roles** — supporting: #218 Eating and farting is a wild job description if I ever he… (10.00); #942 New clip from my show @fboychroniclesfunny .. @omgitssmil… (10.00); #947 Niggas be scared to talk during sex.. meanwhile I’m like … (10.00)
  - contradicting: #637 When do you know it’s time to let go of someone?  @ohhthi… (0.10); #590 Once a cheater are they always a cheater?  What yall think? (0.15); #155 See what we had to deal with yall?  Really had to end the… (0.16)
- **Sex** — supporting: #813 “I want to get in a headstand!” Today we talk stuff in th… (10.00); #942 New clip from my show @fboychroniclesfunny .. @omgitssmil… (10.00); #947 Niggas be scared to talk during sex.. meanwhile I’m like … (10.00)
  - contradicting: #743 “Men over performing in the bedroom is a turnoff.” Thats … (0.10); #199 Today we’re locked in with the one and only @thetriximont… (0.11); #598 Today we sit with @roz.verde as she shares her surgery ex… (0.17)
- **Clout & fame** — supporting: #853 Lol this how it really be though!! Why you still over my … (10.00); #879 If the head don’t make my toes curl like this.. keep it r… (10.00); #125 Did Nicki copy Lil’ Kim… or just take the blueprint to an… (5.84)
  - contradicting: #360 Just when you’ve thought you’ve heard it all and seen it … (0.10); #602 Today we sit with @dtay_blackie who shares the story on h… (0.10); #671 Today @famous_briiii shares her crazy ATLANTA skrip club … (0.10)

**Insufficient evidence.** Too few posts to judge: Dating with clout (n=2), Exes (n=3).

## 6. Which topics generate comments but weak retention?

Both sides of each pair are measured on era-normalised peer ratios.

**Insufficient evidence.** No topic currently shows above-baseline comments together with below-baseline retention at the minimum sample size.

## 7. Which duration ranges currently perform best?

| Group | n | Baseline n | Median | Baseline | Effect | Consistency | p | Confidence | Holds in both halves | Date range |
|---|---|---|---|---|---|---|---|---|---|---|
| 16-30s | 52 | 131 | 1.19 | 0.99 | 1.20× | 63% | 0.066 | MODERATE_SIGNAL | yes | 2021-10-14 → 2026-09-11 |
| 31-45s | 63 | 120 | 1.13 | 1.00 | 1.13× | 60% | 0.290 | MODERATE_SIGNAL | yes | 2021-10-14 → 2026-09-11 |
| ⚠ 46-60s | 38 | 145 | 1.01 | 1.03 | 0.97× | 58% | 0.763 | MODERATE_SIGNAL | no | 2021-10-14 → 2026-09-11 |
| <=15s | 13 | 170 | 0.90 | 1.03 | 0.87× | 62% | 0.445 | EARLY_SIGNAL | yes | 2021-10-14 → 2026-09-11 |
| >60s | 17 | 166 | 0.57 | 1.06 | 0.54× | 88% | 0.010 | STRONG_SIGNAL | yes | 2021-10-14 → 2026-09-11 |

⚠ **Era-confounded:** 46-60s — the group and its baseline come from different eras or the direction does not hold in both halves of the data. Direction unproven.

- **16-30s** — supporting: #218 Eating and farting is a wild job description if I ever he… (4.15); #51 Not everybody you say ya friend is ya friend cause how th… (2.70); #77 Nah I def wasn’t familiar with your game @desirae.perry.7… (2.68)
  - contradicting: #637 When do you know it’s time to let go of someone?  @ohhthi… (0.30); #590 Once a cheater are they always a cheater?  What yall think? (0.42); #238 Only in New York will you have a baby face and baddies ro… (0.43)
- **31-45s** — supporting: #209 Look, the streets have been waiting for a format this raw… (2.70); #117 Is that bad communication or are men supposed to just fig… (2.68); #103 “Wait... 6 guys is a LIGHT day?! 🤯🎙️” (2.58)
  - contradicting: #360 Just when you’ve thought you’ve heard it all and seen it … (0.23); #342 Today we catchup with @mingluanli as she spills the tea o… (0.39); #597 We continue a conversation from yesterday’s topic about p… (0.42)
- **46-60s** — supporting: #477 Today we sit down with the one and only @somaryjane__ and… (0.35); #646 “I’ll break into your house!” Lol @ant.will.made.it has m… (0.37); #623 Today we sit with @ohhthistiana_ as she breaks down what … (0.38)
  - contradicting: #942 New clip from my show @fboychroniclesfunny .. @omgitssmil… (4.59); #185 Bad s*x = He likes men? Is she onto something or reaching… (2.18); #107 She gave the whole manual 😭🔊 (2.17)

## 8. Which attributes repeatedly appear among breakouts?

32 attribute values appear in at least 5 winners; see the frequency table.

## 9. Which attributes repeatedly appear among losers?

32 attribute values appear in at least 5 losers; see the frequency table.

## 10. Which patterns still have insufficient evidence?

12 lessons are still NEW or OBSERVING: L-109, L-058, L-039, L-038, L-037, L-036, L-035, L-032, L-024, L-007, A-L009, A-L008.

**Insufficient evidence.** hook type · story opening (n=4) · hook type · challenge (n=1) · hook type · humor (n=2) · hook type · payoff first (n=1) · hook type · status clout statement (n=1) · hook type · emotional statement (n=1) · hook type · other (n=1) · opening type · other (n=1) · tension type · moral dilemma (n=4) · share trigger type · aspirational (n=3) · share trigger type · argument ammo (n=1) · share trigger type · informative (n=3) · share trigger type · none (n=2) · share trigger type · tag a friend (n=1) · reaction timing · later (n=2) · reaction timing · 3 10s (n=2)

## 11. Which existing BBO rules are supported?

| Group | n | Baseline n | Median | Baseline | Effect | Consistency | p | Confidence | Holds in both halves | Date range |
|---|---|---|---|---|---|---|---|---|---|---|
| R-005: Every short should contain identifiable tension. (consistent with the rule) | 13 | 127 | 0.46 | 1.17 | 0.40× | 92% | 0.009 | MODERATE_SIGNAL | yes | 2021-10-14 → 2026-09-11 |
| R-015: Do not repeatedly open clips with interviewer questions when the guest… (consistent with the rule) | 29 | 72 | 0.93 | 1.22 | 0.76× | 62% | 0.048 | MODERATE_SIGNAL | yes | 2021-10-14 → 2026-09-11 |

- **R-005: Every short should contain identifiable tension. (consistent with the rule)** — supporting: #475 A lil behind the scenes recap of our Philly episode!  Eve… (0.32); #653 Behind the scenes of our pop the balloon or find love epi… (0.32); #477 Today we sit down with the one and only @somaryjane__ and… (0.35)
  - contradicting: #85 No gatekeeping over here. 🙅🏾‍♀️ We took BBO Stamped to … (1.46); #66 If your circle doesn’t sound like this, you’re hanging wi… (1.15); #115 The group chat finally beat the “let’s just stay in” alle… (0.98)
- **R-015: Do not repeatedly open clips with interviewer questions when the guest… (consistent with the rule)** — supporting: #646 “I’ll break into your house!” Lol @ant.will.made.it has m… (0.37); #623 Today we sit with @ohhthistiana_ as she breaks down what … (0.38); #342 Today we catchup with @mingluanli as she spills the tea o… (0.39)
  - contradicting: #218 Eating and farting is a wild job description if I ever he… (4.15); #209 Look, the streets have been waiting for a format this raw… (2.70); #77 Nah I def wasn’t familiar with your game @desirae.perry.7… (2.68)

5 of 15 active rules are machine-testable; the others are editorial principles this data cannot confirm or refute.

**Insufficient evidence.** R-007 — era-confounded, cannot judge (n=16 vs 42, effect 1.05×, median dates 26 days apart, halves agree: false); R-008 — era-confounded, cannot judge (n=787 vs 153, effect 0.98×, median dates 100 days apart, halves agree: false); R-014 — era-confounded, cannot judge (n=48 vs 529, effect 0.10×, median dates 610 days apart, halves agree: false)

## 12. Which existing BBO rules are being challenged?

No open challenge in the rule engine (a challenge needs repeated contrary evidence, not one pass).

## 13. What 3–5 deliberate experiments should BBO run next?

| Group | n | Baseline n | Median | Baseline | Effect | Consistency | p | Confidence | Holds in both halves | Date range |
|---|---|---|---|---|---|---|---|---|---|---|
| >60s | 17 | 166 | 0.57 | 1.06 | 0.54× | 88% | 0.010 | STRONG_SIGNAL | yes | 2021-10-14 → 2026-09-11 |
| Interviewer question vs guest answer (head-to-head) | 29 | 41 | 0.93 | 1.22 | 0.76× | 62% | 0.078 | MODERATE_SIGNAL | yes | 2024-07-08 → 2026-09-11 |
| surprising fact | 27 | 117 | 1.33 | 1.06 | 1.26× | 67% | 0.005 | STRONG_SIGNAL | yes | 2021-10-14 → 2026-09-11 |
| controversial statement | 40 | 104 | 1.29 | 1.03 | 1.25× | 68% | 0.062 | MODERATE_SIGNAL | yes | 2021-10-14 → 2026-09-11 |
| 16-30s | 52 | 131 | 1.19 | 0.99 | 1.20× | 63% | 0.066 | MODERATE_SIGNAL | yes | 2021-10-14 → 2026-09-11 |

- **>60s** — supporting: #475 A lil behind the scenes recap of our Philly episode!  Eve… (0.32); #653 Behind the scenes of our pop the balloon or find love epi… (0.32); #348 BBO ALL ACCESS EPISODE 1 FT @mingluanli OUT NOW 🔥 Catch … (0.39)
  - contradicting: #204 “NY to Philly to pop up on a 🥷 is crazy!” (1.90); #96 You know stuff gets crazy behind the scenes at BBO 🤣🤣🤣… (1.41); #32 Today we talk with New York’s own @iampvnch about buildin… (1.01)
- **Interviewer question vs guest answer (head-to-head)** — supporting: #646 “I’ll break into your house!” Lol @ant.will.made.it has m… (0.37); #623 Today we sit with @ohhthistiana_ as she breaks down what … (0.38); #342 Today we catchup with @mingluanli as she spills the tea o… (0.39)
  - contradicting: #218 Eating and farting is a wild job description if I ever he… (4.15); #209 Look, the streets have been waiting for a format this raw… (2.70); #77 Nah I def wasn’t familiar with your game @desirae.perry.7… (2.68)
- **surprising fact** — supporting: #947 Niggas be scared to talk during sex.. meanwhile I’m like … (4.72); #51 Not everybody you say ya friend is ya friend cause how th… (2.70); #103 “Wait... 6 guys is a LIGHT day?! 🤯🎙️” (2.58)
  - contradicting: #72 She saw the red flag and and almost made it a lifestyle �… (0.87); #23 Don’t ask me how I know the advice works… just do as I sa… (0.90); #61 This interview started off wild, and only got wilder lmfa… (0.97)

The findings above are the strongest associations worth converting into controlled tests (same topic and guest, one variable changed). 8 experiment(s) are already proposed or running.

## 14. Based on current evidence, what should BBO make next?

8 open opportunities, each tied to evidence.

### Attributes over-represented among breakouts and winners

| Attribute | Value | In group | Group share | Rest share | Lift | Examples |
|---|---|---|---|---|---|---|
| tension type | exposure | 6 | 14% | 7% | 1.93× | #51, #120 |
| emotional trigger | shock | 31 | 66% | 37% | 1.78× | #942, #209 |
| hook type | controversial statement | 18 | 38% | 23% | 1.69× | #942, #117 |
| cta type | click visit | 5 | 3% | 2% | 1.68× | #674, #107 |
| hook type | surprising fact | 12 | 26% | 15% | 1.65× | #947, #51 |
| tension type | gender conflict | 25 | 58% | 37% | 1.57× | #947, #942 |
| share trigger type | shocking | 36 | 77% | 49% | 1.56× | #942, #209 |
| duration bucket | 16-30s | 18 | 38% | 25% | 1.53× | #218, #51 |
| editing style | meme card | 5 | 11% | 7% | 1.50× | #258, #173 |
| comment trigger type | take a side | 43 | 96% | 71% | 1.35× | #947, #942 |
| reaction timing | none | 17 | 36% | 27% | 1.33× | #947, #942 |
| opening type | text first | 16 | 34% | 28% | 1.24× | #947, #942 |

### Attributes over-represented among losers and below-average posts

| Attribute | Value | In group | Group share | Rest share | Lift | Examples |
|---|---|---|---|---|---|---|
| comment trigger type | none | 6 | 22% | 0% | ∞ | #640, #328 |
| tension type | none | 9 | 30% | 4% | 8.25× | #640, #137 |
| time to tension bucket | never | 6 | 19% | 3% | 5.56× | #640, #137 |
| duration bucket | >60s | 12 | 21% | 4% | 5.17× | #16, #8 |
| emotional trigger | curiosity | 14 | 48% | 10% | 4.63× | #225, #649 |
| hook type | curiosity gap | 9 | 31% | 11% | 2.75× | #640, #137 |
| opening type | interviewer question | 12 | 40% | 15% | 2.71× | #640, #137 |
| hook type | question | 11 | 38% | 16% | 2.42× | #225, #467 |
| editing style | street handheld | 5 | 16% | 9% | 1.85× | #137, #328 |
| comment trigger type | personal experience | 6 | 22% | 15% | 1.45× | #649, #598 |
| editing style | podcast panel cut | 17 | 55% | 45% | 1.21× | #225, #640 |
| tension type | confession stakes | 6 | 20% | 18% | 1.10× | #609, #598 |

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
