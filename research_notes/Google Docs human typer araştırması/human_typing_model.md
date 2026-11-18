# Empirical characteristics of human typing and how to model them in a typing simulator

Reading guide
- "COPY" = finding is from transcription / copy-typing. "COMP" = finding is from free composition. They differ a lot: copy-typing data describe the motor layer (keystroke timing, typos, backspacing); composition data describe the pause / burst / revision layer on top of it.
- Source access notes: the Dhakal et al. (CHI 2018), Crump & Logan (2013) and Van Waes et al. (2021) PDFs were read in full text (extracted locally). The Frontiers fatigue paper was read via its HTML page. Conijn et al. 2019 and Roeser et al. 2021 (Springer) were paywalled/redirect-blocked and only abstracts were available; anything from them is marked as such. Simulator libraries were read at README level, not source level.
- Anything under "Inferences" is my derivation, not a published figure.

Source URLs used repeatedly
- Dhakal, Feit, Kristensson, Oulasvirta (2018), "Observations on Typing from 136 Million Keystrokes", CHI 2018: https://userinterfaces.aalto.fi/136Mkeystrokes/resources/chi-18-analysis.pdf (project page + dataset: https://userinterfaces.aalto.fi/136Mkeystrokes/ ; DOI https://doi.org/10.1145/3173574.3174220)
- Crump & Logan (2013), "Prevention and Correction in Post-Error Performance", JEP:LMC: https://www.crumplab.com/publications/Crump/files/4683/Crump%20and%20Logan%20-%202013%20-%20Prevention%20and%20correction%20in%20post-error%20performanc.pdf
- Van Waes, Leijten, Roeser, Olive, Grabowski (2021), "Measuring and assessing typing skills in writing research", Journal of Writing Research 13(1): https://jowr.org/jowr/article/download/779/836/726 (landing page https://www.jowr.org/jowr/article/view/779)
- Frontiers in Psychology 2018, "Age modulates the effects of mental fatigue on typewriting": https://www.frontiersin.org/articles/10.3389/fpsyg.2018.01113/full
- Conijn, van Waes, van Zaanen, "Typoo or orthographic error?" (CLIN29 abstract): https://www.let.rug.nl/vannoord/Clin/clin29/Rianne_Conijn_Luuk_van_Waes_Menno_van_Zaanen.php
- González, Calot, Ierache, Hasperué (2021), "On the shape of timings distributions in free-text keystroke dynamics profiles", Heliyon 7(11): https://doaj.org/article/c54c349f5c0841a4882885f8a2473bd5
- Vasylets & Marín (2025), scoping review, Journal of Writing Research 16(3): https://www.jowr.org/jowr/article/download/1318/979

---

## 1. Typical typing speeds (WPM) and inter-key interval (IKI) distributions; which distribution fits

### Takeaway
Ordinary computer users copy-type at about 52 WPM (SD 20, right-skewed; 10th percentile about 26 WPM, 90th about 78 WPM), which corresponds to a mean IKI of about 239 ms (SD 112 across people) with a hard floor near 60 ms and a long right tail. IKIs are strongly right-skewed: log-normal is the conventional model, a large comparative study found log-logistic fits best, and writing-research work shows a two-component mixture (fluent + hesitant) beats any single distribution.

### Cited Findings
All COPY unless noted.
- Dataset: 136,857,600 keystrokes from 168,960 participants (about 810 keypresses each), each transcribing 15 English sentences (max 70 characters, simple punctuation only) that they first read and memorised. Self-selected visitors of a typing-test site: mean age 24.5, 68% from the US, 72% had taken a typing course, 98.1% QWERTY. — [Dhakal et al. 2018](https://userinterfaces.aalto.fi/136Mkeystrokes/resources/chi-18-analysis.pdf)
- WPM: mean 51.56, SD 20.2; skewness 0.513, kurtosis -0.11 (slight positive skew, not normal). "Fast" = top 10% = above about 78 WPM (group mean 89.56, SD 9.53); "slow" = bottom 10% = below about 26 WPM (group mean 20.91, SD 4.05). Fastest typists reach 120 WPM or more. Trained typists 54.35 WPM vs untrained 49.00 WPM (small effect, d = 0.27). WPM uses the 5-characters-per-word convention. — [Dhakal et al. 2018](https://userinterfaces.aalto.fi/136Mkeystrokes/resources/chi-18-analysis.pdf)
- IKI (keydown to keydown): mean 238.66 ms, SD 111.6 across participants; skewness 1.98, kurtosis 7.1; lower bound about 60 ms. Fast typists: mean 121.7 ms with SD of only about 12 ms; slow typists: mean 481 ms, SD about 123 ms, sometimes up to 900 ms. IKIs longer than 5000 ms were excluded from IKI analyses. Correlation of IKI with WPM: r = -0.84. — [Dhakal et al. 2018](https://userinterfaces.aalto.fi/136Mkeystrokes/resources/chi-18-analysis.pdf)
- Keypress (hold) duration: mean 116.25 ms, SD 23.88; skewness 0.8, kurtosis 2.36; nearly the same for fast (104.5 ms) and slow (129.0 ms) typists, range roughly 80-150 ms. — [Dhakal et al. 2018](https://userinterfaces.aalto.fi/136Mkeystrokes/resources/chi-18-analysis.pdf)
- Rollover (next key pressed before the previous is released): mean 25% of keystrokes (SD 17%); fast typists 49.9% (most between 40 and 70%), slow typists 7.6%; correlation with WPM r = 0.73. When rollover occurs keys overlap by 30 ms on average, up to 100 ms. — [Dhakal et al. 2018](https://userinterfaces.aalto.fi/136Mkeystrokes/resources/chi-18-analysis.pdf)
- Eight typist clusters (from normalised bigram IKIs) span 46.5 WPM / IKI 245.8 ms / rollover 20% (largest group, 38,012 people, "slow careful") to 68.35 WPM / IKI 161.9 ms / rollover 37.8% (35,068 people, "fast rollovers"). — [Dhakal et al. 2018](https://userinterfaces.aalto.fi/136Mkeystrokes/resources/chi-18-analysis.pdf)
- Dutch copy-task corpus (1,682 participants aged 13-83, median age 21; 1,447,310 IKIs): overall IKI for targeted bigrams mean 169 ms (SD 84), median 137 ms (SD 62), trimmed log-mean 141 ms; 392 characters per minute (SD 96). Lexical components only: mean 152 ms (SD 75), median 134 ms, 438 cpm (SD 110). Latencies below 30 ms are treated as noise. — [Van Waes et al. 2021](https://jowr.org/jowr/article/download/779/836/726)
- A 2-component mixture model (fluent vs long/disfluent IKIs) predicted copy-task IKIs far better than single-distribution mixed models (elpd difference > 1,000 vs the best single-distribution model). Probability of a "long" (hesitant) IKI: 24% in the sentence-copy task, 69% when copying consonant strings, small for high-frequency-bigram word lists. — [Van Waes et al. 2021](https://jowr.org/jowr/article/download/779/836/726)
- Distribution shape, free-text keystroke dynamics: 7 two-parameter and 7 three-parameter distributions were compared on 3 public free-text datasets for hold and flight times; the abstract reports log-logistic as the clear winner, ahead of log-normal. A catalogue summary of the same paper says the results also confirm log-normal (2- and 3-parameter) as an excellent choice. Timing data are public on Mendeley (DOI 10.17632/sjk7kz35nh.1). — [González et al. 2021, Heliyon](https://doaj.org/article/c54c349f5c0841a4882885f8a2473bd5); [data](https://data.mendeley.com/datasets/sjk7kz35nh/1)
- Means and SDs are biased summaries for keystroke data because latencies are strongly positively skewed; medians are preferred. — reported in search summaries of [Conijn, Roeser & van Zaanen 2019](https://research.tilburguniversity.edu/en/publications/understanding-the-keystroke-log-the-effect-of-writing-task-on-key/) and [Van Waes et al. 2021](https://jowr.org/jowr/article/download/779/836/726)
- The average of all IKIs was stable between copy tasks and composition tasks (email, academic summary), while between-word and between-(sub)sentence timing differed between copy and academic writing (abstract only). — [Conijn, Roeser & van Zaanen 2019, Reading and Writing 32:2353-2374](https://research.tilburguniversity.edu/en/publications/understanding-the-keystroke-log-the-effect-of-writing-task-on-key/)

### Inferences
- WPM to mean IKI: mean IKI (ms) = 60000 / (5 x WPM). 52 WPM gives 231 ms, consistent with the observed 239 ms. Use this to derive the per-character base delay from a target WPM.
- A log-normal matched to the Dhakal across-person moments (mean 238.66, SD 111.6) has sigma about 0.445 and mu about 5.376 (median about 216 ms). This describes how *people* differ, so it is the right prior for sampling a simulated typist's base speed, not the per-keystroke noise.
- Per-keystroke (within-person) spread: in Van Waes et al. the mean of participant means (169 ms) is about 1.23x the mean of participant medians (137 ms). If a single log-normal had to explain that, sigma would be about 0.65; because a hesitant mixture component accounts for part of the tail, a sensible fluent-component sigma is roughly 0.25-0.40 with a separate hesitation component. These sigma values are my estimates, not published parameters.
- Fast typists are not just "the same curve scaled": their IKI variability is proportionally much smaller (SD about 12 ms on a 122 ms mean across fast typists vs 123 on 481 for slow). Scale sigma down as WPM goes up.
- Hard floor: never emit an IKI under about 60 ms between distinct keys (30 ms is treated as noise in the literature). A shifted log-normal or shifted log-logistic (shift about 50-60 ms) satisfies this naturally.
- Hold time can be drawn independently of IKI: about Normal(116, 24) ms clipped to 60-200 ms; when hold > next IKI you get rollover, which should happen on roughly 25% of keystrokes for a 52 WPM typist and 40-70% for an 80+ WPM typist. This matters only if key-up events are observable by the target application.

### Gaps
- No published per-keystroke log-normal/log-logistic parameter values (mu, sigma or scale/shape) were retrieved; González et al.'s fitted parameters are in the full paper/dataset, which I did not open. The sigma values above are my derivations.
- Ex-Gaussian fits to IKIs specifically: I found no source comparing ex-Gaussian against log-normal for typing; González et al.'s candidate list was not visible in the abstract.
- The Dhakal sample is self-selected, young, typing-interested and 72% typing-trained; the paper itself flags this. "Ordinary users" in the general population are probably somewhat slower. Composition speed for ordinary users (words actually produced per minute including pauses) was not found in a retrievable primary source.
- Conijn et al. 2019 per-location millisecond tables (within-word / between-word / between-sentence, copy vs email vs academic) could not be accessed (Springer redirect).

---

## 2. How IKIs vary by context (bigram, hand/finger, word-initial, space, punctuation, Shift, digits)

### Takeaway
Bigram frequency and motor layout matter, but on modern keyboards the hand-alternation advantage is small (5-20 ms); letter repetitions are fast and stable (about 176 ms regardless of skill); the first letter after a space is slower (word-initiation effect). Hard published millisecond values for punctuation, Shift/capitals and digits were not found.

### Cited Findings
All COPY.
- Mean bigram IKIs across all participants: left-hand bigrams 215.2 ms (SD 96.8), right-hand 203.6 ms (SD 99.1), hand-alternation 198.3 ms (SD 104.0), letter repetition 176.4 ms (SD 70.3). — [Dhakal et al. 2018](https://userinterfaces.aalto.fi/136Mkeystrokes/resources/chi-18-analysis.pdf)
- Fast typists: left 124.4, right 117.2, alternation 108.6, repetition 144.8 ms (repetition is 20-40 ms *slower* than other bigrams). Slow typists: left 385.2, right 379.8, alternation 408.8, repetition 230.8 ms (repetition is over 150 ms *faster*, and alternation is 20-28 ms slower than same-hand). — [Dhakal et al. 2018](https://userinterfaces.aalto.fi/136Mkeystrokes/resources/chi-18-analysis.pdf)
- Left hand is slower than right by about 7-15 ms; hand-alternation benefit is 5-20 ms for fast/trained/untrained typists, versus 30-60 ms reported in typewriter-era studies. The left-right difference is within the logging precision (10-15 ms) and should be treated cautiously. — [Dhakal et al. 2018](https://userinterfaces.aalto.fi/136Mkeystrokes/resources/chi-18-analysis.pdf)
- Repetition IKI correlates only weakly with speed (r = -0.32) versus about -0.7 for same-hand and alternation bigrams. — [Dhakal et al. 2018](https://userinterfaces.aalto.fi/136Mkeystrokes/resources/chi-18-analysis.pdf)
- Word-initiation effect: the left/right/alternation/repetition IKIs are all below the overall mean IKI (238.7 ms) because the overall mean includes "many slower bigrams, such as a letter following a space". — [Dhakal et al. 2018](https://userinterfaces.aalto.fi/136Mkeystrokes/resources/chi-18-analysis.pdf)
- Bigram categories used: left-hand (as, sa, er, re, sd, ds, ec, ce, ew, we, wa, aw, cr, sc, cs), right-hand (lk, lo, ol, op, po, io, oi, no, on, in, ni), alternation (al, la, ak, ka, am, ma, an, na, ai, ia, so, os, sp, ps, en, ne, em, me, el, le, ep, pe), repetition (ll, cc, aa, nn, tt, ss, pp). — [Dhakal et al. 2018](https://userinterfaces.aalto.fi/136Mkeystrokes/resources/chi-18-analysis.pdf)
- Bigram frequency has a strong effect on typing speed while lexicality per se does not: high-frequency-bigram words and sentences are typed about as fast as pure d-k tapping; low-frequency bigrams and consonant strings are clearly slower. Low-frequency bigrams are also less accurate (median 89.66% correct vs 96.35% overall and 98.6% for tapping). — [Van Waes et al. 2021](https://jowr.org/jowr/article/download/779/836/726)
- Prior literature cited there: high-frequency bigrams are typed faster than low-frequency ones (Salthouse 1986); two-hand bigrams are faster than same-hand (Logan); keyboard adjacency and same-finger repetition affect transitions (Gentner et al. 1988). — [Van Waes et al. 2021](https://jowr.org/jowr/article/download/779/836/726)
- Words containing an error are typed much more slowly overall: mean per-letter interval 287 ms in the error word vs 151 ms in the preceding word and 155 ms in the following word (800 typists, mean 68 WPM). — [Crump & Logan 2013](https://www.crumplab.com/publications/Crump/files/4683/Crump%20and%20Logan%20-%202013%20-%20Prevention%20and%20correction%20in%20post-error%20performanc.pdf)

### Inferences
- Implement context as multiplicative factors on the base IKI (values are my proposals, anchored to the ratios above for a ~50 WPM typist): hand-alternation x0.92-0.97; same-hand different-finger x1.0; same-finger different-key x1.1-1.2 (no direct number retrieved, direction supported by Gentner/Salthouse as cited); doubled letter x0.75-0.85 for average/slow typists but x1.15-1.3 for fast typists; top-50 frequent bigrams x0.85-0.9; rare bigrams x1.15-1.3.
- Overall mean (239 ms) vs within-word bigram means (about 200-215 ms): if roughly 1 in 5.5 keystrokes is word-initial or a space, those boundary keystrokes must average on the order of 350-400 ms to reconcile the two figures, i.e. roughly x1.6-1.9 the within-word IKI. This is a back-of-envelope reconciliation, not a reported value.
- Skill-dependent sign flips (repetition, alternation) mean a single fixed bigram table is wrong for at least one skill group; parameterise by typist speed.

### Gaps
- No retrievable empirical millisecond values for: Shift + letter (capitals), digits, punctuation keys, Enter, or symbol keys. The Dhakal stimuli deliberately limited digits and punctuation. Existing simulators simply use hand-picked multipliers (see section 6).
- Per-bigram IKI tables exist in the 136M dataset (16 GB) and How-We-Type dataset but were not computed here.
- No data retrieved on Turkish-specific characters (ı, ğ, ş, ç, ö, ü) or the Turkish Q layout timing.

---

## 3. Error rates, error taxonomy, how fast errors are noticed, and what the backspace burst looks like

### Takeaway
In copy-typing, about 6% of all keypresses are Backspace/Delete, about 1.2% of characters are left wrong, and substitutions dominate (roughly half of errors, more for slow typists). Skilled typists fix about half of their corrected errors immediately (one backspace), a quarter after one more character, and the rest after 2-4+ characters; the first backspace is slow (about 400-420 ms), later backspaces are fast (about 170-220 ms), and normal speed resumes right after retyping.

### Cited Findings
All COPY.
- Uncorrected error rate (Levenshtein distance / length): mean 1.17% (SD 1.43%); 90% of participants leave under 2.66%. Fast typists 0.71%, slow typists 1.78%. — [Dhakal et al. 2018](https://userinterfaces.aalto.fi/136Mkeystrokes/resources/chi-18-analysis.pdf)
- Error corrections: 6.31% of keypresses are Backspace or Delete (SD 4.48%); 2.29 per sentence on average, 99th percentile 8.5 per sentence. Fast typists 3.40%, slow typists 9.05%; trained 5.9% vs untrained 6.5%. KSPC (keystrokes per final character) 1.173 (SD 0.094); fast 1.10, slow 1.24. — [Dhakal et al. 2018](https://userinterfaces.aalto.fi/136Mkeystrokes/resources/chi-18-analysis.pdf)
- Error-type rates (TextTest classification, stratified sample of 783 participants, corrected + uncorrected): substitution 1.65% (SD 1.43), omission 0.80% (SD 0.57), insertion 0.67% (SD 0.48). Fast typists: 0.84 / 0.49 / 0.50%. Slow typists: 3.72 / 1.29 / 0.80%. Substitution and omission fall with skill (r = -0.45, -0.33); insertion barely changes (r = -0.15). — [Dhakal et al. 2018](https://userinterfaces.aalto.fi/136Mkeystrokes/resources/chi-18-analysis.pdf)
- This contrasts with older studies of professional typists, in which insertion errors were the most frequent type. — [Dhakal et al. 2018](https://userinterfaces.aalto.fi/136Mkeystrokes/resources/chi-18-analysis.pdf)
- Dutch transcription tasks (2,103 tasks, 1,717 participants, 5,030 corrections): 59% single substitutions, 5% single transpositions, 4% single insertions, 1% single deletions, 27% involved more than one edit, 4% no change. — [Conijn, van Waes & van Zaanen, CLIN29](https://www.let.rug.nl/vannoord/Clin/clin29/Rianne_Conijn_Luuk_van_Waes_Menno_van_Zaanen.php)
- A typo-pair dataset used for spelling correction (not keyboard-logged): substitution about 39%, insertion about 33%, deletion about 18%, transposition about 11%; the four basic types account for 80-95% of all typos (citing Martins & Silva 2004). — [Spelling Correction with Denoising Transformer, arXiv 2105.05977](https://arxiv.org/pdf/2105.05977)
- 800 typists (mean 68 WPM, range 21-127), 115-word paragraph with backspace disabled: mean word-level error rate 7%. — [Crump & Logan 2013](https://www.crumplab.com/publications/Crump/files/4683/Crump%20and%20Logan%20-%202013%20-%20Prevention%20and%20correction%20in%20post-error%20performanc.pdf)
- Detection lag, Experiment 2 (backspace allowed): typists detected and corrected 93% of their errors. Of corrected errors, 46% were corrected immediately (backspace is the very next key), 28% after one intervening keystroke, 11% after two, 7% after three, the remainder after four or more. Experiment 3: 86% corrected; of these 50% immediately, 22% after one, 12% after two, 5% after three, remainder four or more. — [Crump & Logan 2013](https://www.crumplab.com/publications/Crump/files/4683/Crump%20and%20Logan%20-%202013%20-%20Prevention%20and%20correction%20in%20post-error%20performanc.pdf)
- Timing around a correction: the first backspace is the slowest keystroke of the episode (416 ms); the authors note Backspace is physically far (upper right, little-finger stretch). After the correction typists "immediately" resume normal speed; no post-correction recovery period. Keystrokes after an error that was *not* immediately corrected were faster than pre-error keystrokes (pre-error 154 ms), i.e. post-error speeding. — [Crump & Logan 2013](https://www.crumplab.com/publications/Crump/files/4683/Crump%20and%20Logan%20-%202013%20-%20Prevention%20and%20correction%20in%20post-error%20performanc.pdf)
- When backspace is disabled, slowing is visible and transient: mean intervals 169 ms (key before error), 200 ms (error key), then 390, 314, 261, 216, 199 ms for the next five keys. 98.6% of typists show post-error slowing on average, but slowing follows only about half of individual errors; slowing is larger for slow typists (369 ms) than fast (307 ms); it does not persist into the next word. — [Crump & Logan 2013](https://www.crumplab.com/publications/Crump/files/4683/Crump%20and%20Logan%20-%202013%20-%20Prevention%20and%20correction%20in%20post-error%20performanc.pdf)
- Sentence typing over 120 minutes (23 young adults, 23 middle-aged): backspace = 4.2% of keystrokes rising to 5.4% (young), 3.8% (middle-aged); mean backspace sequence length 1.9-2.2 keys; 13.1% of words were corrected; 1.8-2.7% of words left incorrect. Letter-to-backspace interval 420 ms (young) / 784 ms (middle-aged); backspace-to-backspace interval 222 ms (young) / 170 ms (middle-aged); letter-to-letter 154 ms (young) / 240 ms (middle-aged). — [Frontiers in Psychology 2018](https://www.frontiersin.org/articles/10.3389/fpsyg.2018.01113/full)
- Error and post-error key-presses are slower than matched correct key-presses, with no speed change before the error (Kalfaoğlu & Stafford 2013, as summarised in search results; primary text not opened). — [White Rose eprint](https://eprints.whiterose.ac.uk/112945)

### Inferences
- Relative error mix for an average copy-typist, from the Dhakal rates: substitution about 53%, omission about 26%, insertion about 21% (1.65 / 0.80 / 0.67 normalised). TextTest has no transposition class, so transpositions are hidden inside these; Conijn et al. suggest roughly 5% of corrections are transpositions. A workable default mix: substitution 50%, omission 22%, insertion (incl. doubled letter) 18%, transposition 5-8%, other/multi-edit the rest.
- Gross per-character error probability: summing the three rates gives about 3.1% of characters for the average typist (about 1.8% fast, about 5.8% slow). With about 1.2% left uncorrected, roughly 60-90% of errors are corrected (Crump & Logan: 86-93% in skilled typists told to be accurate; Dhakal implies a lower share for casual typists).
- Consistency check: Crump & Logan's lag distribution implies a mean backspace burst of about 2.1 keys (0.48x1 + 0.25x2 + 0.115x3 + 0.06x4 + ~0.095x6), matching the independently measured 1.9-2.2 keys. With 6.3% of keypresses being backspaces, that is about one correction episode per 30-35 keystrokes.
- Which wrong key: none of the retrieved sources gives a confusion matrix. Slow typists' excess substitutions are attributed by Dhakal et al. to a poor mental map of finger positions; Van Waes et al. cite Logan (2018) that skilled typists' errors are mostly finger-coordination errors rather than mis-aimed movements. So adjacent-key substitution is a reasonable default, but same-finger / mirror-hand (homologous finger) substitutions and doubling-the-wrong-letter should also be included; the proportions are my assumption.
- The backspace burst shape to simulate: [error key] -> optionally 0-4 more correct-looking characters at normal or slightly faster speed -> pause about 400-450 ms (scaled with typist speed; up to about 800 ms for slow typists) -> k backspaces at about 170-220 ms each (k = lag + 1) -> retype at normal speed with no extra recovery delay.

### Gaps
- No keyboard confusion matrix (share of substitutions that are horizontally adjacent, vertically adjacent, same finger other hand, phonological) was retrieved. Classic sources (Grudin 1983; Salthouse 1986; Gentner et al.) were not accessible in this session; do not quote percentages from them without checking.
- Share of errors corrected at word end / by word-level deletion (Ctrl+Backspace, selection) vs character backspacing: not found. Dhakal et al. explicitly could not track mouse/selection deletions.
- Error behaviour in free composition (as opposed to copy) at the typo level: not separately quantified in sources I could open.
- The "20% of keystrokes are errors" figure seen on a Q&A aggregator is unverified and should not be used.

---

## 4. Composition (writing-process research): pauses, P-bursts and R-bursts, pause share, revision

### Takeaway
Composition is copy-typing-speed bursts separated by pauses whose length scales with the linguistic boundary (within word < between words < between sentences < between paragraphs). A published three-component mixture puts typical composition pauses at about 330 ms (65%), 735 ms (26%) and 2.7 s (9%); the standard "pause" threshold is 2 s; adult L1 writers produce on the order of 5-12 words per burst. Exact per-boundary medians, pause-time share and revision percentages could not be retrieved from primary sources.

### Cited Findings
All COMP unless noted.
- Pause length in text production modelled as a mixture of three Gaussians: about 330 ms with mixing proportion .65, about 735 ms with .26, and about 2697 ms with .09 (Baaijen, Galbraith & de Glopper 2012, as reported by Van Waes et al.). — [Van Waes et al. 2021](https://jowr.org/jowr/article/download/779/836/726)
- The most common pause threshold is 2 seconds (Wengelin 2006); some studies use 500 ms, and 5 or 10 s for higher-level processes; fluency analyses have been run at 200, 500, 1000 and 2000 ms; Medimorec & Risko and Allen et al. binned pauses as 300-999 ms, 1000-1999 ms and >2000 ms. Fixed thresholds ignore typing skill: one writer's optimal inter-key latency may be about 120 ms and another's about 340 ms. — [Van Waes et al. 2021](https://jowr.org/jowr/article/download/779/836/726); [Vasylets & Marín 2025](https://www.jowr.org/jowr/article/download/1318/979)
- Pause duration increases with grammatical unit level: longest between paragraphs, then sentences, then word groups, then words, then within words (Schilperoord 2001). Long pauses relate to macro operations (paragraph organisation, revision); short pauses to motor or lexico-grammatical micro-processes. Between-sentence pauses relate to global planning; within-word pauses to typing skill. — [Vasylets & Marín 2025](https://www.jowr.org/jowr/article/download/1318/979)
- Pause *rate* also rises with unit size (word < sentence < paragraph), regardless of task (Medimorec & Risko 2017, N = 101 university students; Révész et al. 2017). Word-boundary pauses are linked to lexical processing (word frequency), sentence-boundary pauses to syntactic processing. — [Vasylets & Marín 2025](https://www.jowr.org/jowr/article/download/1318/979); [Medimorec & Risko 2017 record](https://research.birmingham.ac.uk/en/publications/pauses-in-written-composition-on-the-importance-of-where-writers-)
- Over 50% of sentences were preceded by only very short pauses (mean around 430 ms) (Roeser & Torrance, reported at search-snippet level; I could not open the PDF). — [NTU repository PDF](https://irep.ntu.ac.uk/id/eprint/50506/1/1843654_Torrance.pdf)
- P-bursts = text produced between pauses of 2 s or more; R-bursts = bursts terminated by a revision rather than a pause (Chenoweth & Hayes 2001). L1 and more experienced writers produce longer P-bursts and a higher proportion of P-bursts relative to R-bursts. — [Révész & Michel, "Methodological advances in investigating L2 writing processes"](https://eprints.soton.ac.uk/433668/1/methodological_advances_in_investigating_l2_writing_processes.pdf)
- Burst length: Kaufer, Hayes & Flower (1986) are reported as finding about 10-12 words per burst for more experienced writers and 5-6 for less experienced; adults writing in L1 are also described as averaging about seven words per burst. These come from secondary summaries surfaced by search and disagree slightly with each other; verify against the originals. — [Révész & Michel (secondary)](https://eprints.soton.ac.uk/433668/1/methodological_advances_in_investigating_l2_writing_processes.pdf); [Vasylets & Marín 2025](https://www.jowr.org/jowr/article/download/1318/979)
- Burst thresholds are sometimes personalised: one approach uses 4x the writer's median IKI; others use fixed values such as 2/3 s for inter-key and 2 s for inter-word intervals. — [US patent 11195431 (ETS)](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11195431)
- In one Inputlog study, mean characters typed per P-burst ranged from about 9 to 18 across five writer clusters (threshold not stated in the table). — [Language Testing in Asia, table 3](https://languagetestingasia.springeropen.com/articles/10.1186/s40468-021-00150-5/tables/3)
- Mean IKI over all keystrokes is about the same in copy and composition; what changes is timing between words and between (sub)sentences (abstract only). — [Conijn, Roeser & van Zaanen 2019](https://research.tilburguniversity.edu/en/publications/understanding-the-keystroke-log-the-effect-of-writing-task-on-key/)
- Even COPY typing has hesitations: 24% of IKIs in a repeated-sentence copy task fell in the "long" mixture component. — [Van Waes et al. 2021](https://jowr.org/jowr/article/download/779/836/726)
- Higher-scoring essays are associated with shorter pauses and longer, more frequent bursts; L1 vs L2 adult writers differ in P-burst length, pause duration and proportion of deletions (about 400 writers) (snippet level). — [Tian dissertation, Georgia State 2023](https://scholarworks.gsu.edu/server/api/core/bitstreams/5790ea8f-d298-4481-bf7c-503fb031efad/content); [KLiCKe corpus paper, JoWR](https://jowr.org/jowr/article/download/1556/993/4779)
- Inputlog's standard revision measure is the product/process ratio (characters in the final text divided by characters typed). — [Using Inputlog to analyze and visualize writing processes](https://www.academia.edu/5722921/Using_Inputlog_to_analyze_and_visualize_writing_processes)

### Inferences
- The Baaijen mixture maps cleanly to boundaries for a simulator: the 330 ms component is roughly within-word/word-boundary fluent transitions for a composing (not copying) writer, the 735 ms component is word/phrase-level hesitation, the 2.7 s component is sentence/idea-level planning. Because sentence boundaries are only about 1 in 80-100 keystrokes, a 9% share for the long component means long pauses also occur at many clause and word boundaries, not only at sentence ends.
- Since over half of sentences reportedly start after only about 430 ms, sentence-initial pauses should be bimodal: about 50% short (300-700 ms), about 50% long (log-normal, median about 2-4 s, tail to 20-30 s). A simulator that pauses 2 s after *every* full stop is detectably regular.
- A burst length of about 5-12 words at about 5.5 keystrokes per word means a >=2 s pause roughly every 30-65 keystrokes during drafting.
- For a "pretend-to-compose" simulator fed a finished text, R-bursts must be synthesised: stop mid-sentence, delete the last 1-5 words (or a phrase), type an alternative, possibly restore; and occasionally jump back to earlier text to insert/replace a word. Frequency is a tunable guess (see Gaps).

### Gaps
- Proportion of total composition time spent pausing: no retrievable primary figure. My recollection of the literature is that writers pause for roughly half or more of total composing time, but I could not verify this in a source during this session; treat as unverified.
- Median/mean pause duration per boundary (within-word, between-word, between-sentence, between-paragraph) for adult L1 typists in composition: not obtained in numeric form (Medimorec & Risko 2017, Wengelin 2006, Conijn et al. 2019, Roeser et al. 2021 all inaccessible beyond abstracts).
- Revision volume: share of typed characters later deleted (1 - product/process ratio), revisions per 100 words, split between immediate "leading-edge" revisions and revisions of earlier text: not obtained numerically. My unverified recollection is that leading-edge revisions dominate and that product/process ratios for student essays are typically around 0.8-0.9; verify before relying on it.
- Chenoweth & Hayes (2001) exact P-burst means and P:R burst percentages, and Kaufer et al. (1986) exact values: only secondary, partially conflicting summaries were found.
- The Kaggle "Linking Writing Processes to Writing Quality" keystroke dataset and the KLiCKe corpus would give all of these numbers empirically (thousands of 30-minute essays with event-level logs), but I could not confirm their descriptive statistics or even that the two are the same corpus.

---

## 5. Long sessions: fatigue, breaks, speed drift

### Takeaway
Measured drift is small: over about 100 minutes of continuous typing, IKIs rise only about 5-7%, with young adults also making more errors and backspacing more and later. Field data confirm the direction (slower, less accurate with prolonged work), but no quantitative model of breaks was found.

### Cited Findings
- COPY-like sentence typing, 120-minute session, 23 young (mean age 22.4) and 23 middle-aged (mean 57.8) adults, typing alternating with a mouse task; values at 20 min vs 120 min: general IKI 152 -> 162 ms (young), 228 -> 240 ms (middle-aged); letter-to-letter interval 151 -> 154 ms (young), 232 -> 246 ms (middle-aged); sentence typing time 7.25 -> 8.03 s (young), 11.2 -> 12.0 s (middle-aged). — [Frontiers in Psychology 2018](https://www.frontiersin.org/articles/10.3389/fpsyg.2018.01113/full)
- Same study, accuracy: incorrect words 1.8% -> 2.7% (young), 2.5% -> 2.5% (middle-aged); backspace share of keystrokes 4.2% -> 5.4% (young), 3.8% unchanged (middle-aged); backspace sequence length 1.9 -> 2.2 keys (young; later error detection), 2.2 -> 1.9 (middle-aged). The first 20 minutes were excluded because of practice (warm-up) effects in the middle-aged group. — [Frontiers in Psychology 2018](https://www.frontiersin.org/articles/10.3389/fpsyg.2018.01113/full)
- Field study of regular office work over six weeks: inter-key interval, backspace use and incorrectly typed words all worsened with prolonged task performance; authors hypothesised a larger effect in the afternoon (search-snippet level, primary not opened). — [PMC6049040](https://pmc.ncbi.nlm.nih.gov/articles/PMC6049040)
- Physical finger fatigue is a separate, small effect: key-hold duration of the right ring finger dropped 5% (6 ms) right after fatiguing finger exercise. — [Eur J Appl Physiol 2008](https://link.springer.com/article/10.1007/s00421-008-0878-4)
- In the Aalto test, participants "obviously getting distracted" (an IKI over 50 s within a sentence) were excluded and breaks were allowed between sentences; so break behaviour is not in that dataset. — [Dhakal et al. 2018](https://userinterfaces.aalto.fi/136Mkeystrokes/resources/chi-18-analysis.pdf)

### Inferences
- A realistic fatigue term is on the order of +3% to +7% mean IKI per 100 minutes of active typing (roughly +0.05% per minute), plus a mild increase in error probability (up to about x1.5 over 100 minutes) and in detection lag (+0.3 backspaces per burst). Anything stronger is not supported by the data found.
- A short warm-up (first few minutes slightly slower) is plausible from the excluded first block, but its size was not quantified.
- Breaks should be modelled as a separate heavy-tailed process (occasional 10 s - several-minute gaps at paragraph/sentence boundaries), with partial recovery of the fatigue term after a break; parameters are guesses.

### Gaps
- No empirical distribution of break frequency/duration during real document writing (time between breaks, break length) was found.
- No per-10-minute drift curve; only start vs end values. Time-of-day effects were hypothesised, not quantified in what I could read.
- All fatigue numbers are from copy-like sentence typing, not from multi-hour composition.

---

## 6. Algorithms used by existing typing simulators, and their weaknesses

### Takeaway
Open-source "human typing" tools use a fixed base delay from WPM with random jitter, hand-picked multipliers for spaces/punctuation, a single per-character typo probability with adjacent-key substitution, and immediate backspace correction. None that I examined is calibrated to keystroke data, and the most detectable shortcuts are symmetric (uniform/Gaussian) delays, typos that are always fixed after exactly one character, perfectly regular punctuation pauses, and no composition layer.

### Cited Findings
- HumanTyping (Python, Lax3n): describes itself as a semi-Markov process with a "mental cursor" and "physical cursor". Defaults listed in the README: DEFAULT_WPM = 60, WPM_STD = 10 (between sessions); TIME_SPACE_PAUSE_MEAN = 0.25 s; TIME_BACKSPACE_MEAN = 0.12 s; TIME_ARROW_MEAN = 0.15 s; TIME_REACTION_MEAN = 0.35 s (delay after an error); SPEED_BOOST_COMMON_WORD = 0.6; SPEED_BOOST_BIGRAM = 0.4 (th, er, in...); SPEED_PENALTY_COMPLEX_WORD = 1.3; FATIGUE_FACTOR = 1.0005 per character; PROB_ERROR = 0.04 (neighbour-key); PROB_SWAP_ERROR = 0.015 (transposition); PROB_NOTICE_ERROR = 0.85 (noticed immediately; otherwise fixed later with arrow keys or at a final proofreading pass). Layouts: QWERTY and AZERTY only. The delay distribution family is not stated in the README. — [HumanTyping README](https://raw.githubusercontent.com/Lax3n/HumanTyping/master/README.md); [PyPI](https://pypi.org/project/humantyping/)
- HumanTypingTS (TypeScript/Playwright port) advertises keyboard-neighbour errors, swap errors, delayed correction, backspacing, word difficulty, bigram speed-ups, accents and fatigue (search-result level; the docs page returned 404). — [pkgstats listing](https://www.pkgstats.com/pkg:humantyping-ts)
- human-keyboard (Python, luishacm): WPM-based base speed; "thinking_delay" at word starts; punctuation_multiplier, number_multiplier, space_multiplier; shift_delay for shifted characters; a fatigue multiplier with fatigue_max / fatigue_increase per keystroke / fatigue_recovery per second that affects speed and error rate; error types: typos, double letters, skipped letters, swapped letters under a single error_rate; corrections after correction_delay with backspace_delay between backspaces; custom key distance_matrix. README examples use wpm = 100, error_rate = 0.05, thinking_delay = 200 ms, fatigue_max = 1.5, and wpm = 80, error_rate = 0.1, fatigue_max = 2.0, fatigue_increase = 0.002, fatigue_recovery = 0.001. Defaults and the delay distribution are not documented on the page. — [human-keyboard repo](https://github.com/luishacm/human-keyboard); [PyPI](https://pypi.org/project/human-keyboard/)
- typesim (Python, pc-style): per-character delay drawn from a min/max range in ms with a 0.1x-5.0x speed multiplier; per-character typo probability (0-50%) using QWERTY neighbour keys, corrected by backspacing and retyping; min/max-range "thinking", sentence-end and comma pauses, longer paragraph pauses; a mid-sentence "edit probability" (go back and change a word / insert a phrase) and a "rephrase probability" (type a rephrased sentence, then change it back), optionally using an LLM for synonyms/rephrasings. Defaults are not in the README. Its README states it is intended to get past typing-analysis detectors. — [typesim repo](https://github.com/pc-style/typesim)
- Typio (PyPI) has a FAT_FINGER mode that emits typos and corrections in terminal output; butter-fingers generates keyboard-realistic typos for fuzz testing and lists tunable typo probability and "hands shifting on keys" as planned features (search-result level). — [Typio](https://pypi.org/project/typio/); [butter-fingers](https://github.com/alexyorke/butter-fingers)
- Keyboard-adjacency maps for non-QWERTY layouts: nlpaug ships per-language keyboard neighbour files de, en, es, fr, he, it, nl, pl, th, tr, uk (JSON), usable as a ready-made Turkish adjacency table. — [nlpaug keyboard resources](https://github.com/makcedward/nlpaug/tree/master/nlpaug/res/char/keyboard)
- Research-grade alternative: Typoist simulates touchscreen typing errors (insertion, omission, substitution, transposition) from a computational model of the typist rather than fixed probabilities; it targets touchscreens, not physical keyboards. — [Simulating Errors in Touchscreen Typing, arXiv 2502.03560](https://arxiv.org/pdf/2502.03560)

### Inferences
Weaknesses relative to the empirical findings in sections 1-5 (my analysis):
- Delay distribution: uniform min/max (typesim) or Gaussian-style jitter is symmetric with no heavy right tail and no floor structure; real IKIs have skew about 2, kurtosis about 7 and a 60 ms floor. A uniform range has zero tail and is the easiest tell.
- Fatigue far too strong: HumanTyping's 1.0005 per character compounds to about x1.65 after 1,000 characters and about x12 after 5,000 unless capped, versus a measured +5-7% over 100 minutes. human-keyboard's fatigue_max of 1.5-2.0 is also an order of magnitude above the measured effect.
- Bigram boost too strong: a 0.4 multiplier for common bigrams implies 60% faster; measured hand-alternation/frequency advantages are about 5-20 ms on about 200 ms (under 10%).
- Error model: one flat per-character probability, neighbour-key only. Real errors are about half substitutions with large shares of omissions and insertions, error probability is higher on rare bigrams and for slow typists, and the error word itself is typed much slower (287 vs 151 ms per letter).
- Correction model: mostly "notice immediately with fixed probability, one backspace, retype". Real detection lag is a distribution (about 46-50% lag 0, 22-28% lag 1, 11-12% lag 2, 5-7% lag 3, rest 4+), with a slow first backspace (about 420 ms) and fast subsequent ones (about 170-220 ms), and 7-40% of errors never corrected depending on the typist. HumanTyping's 0.12 s backspace mean is faster than the measured backspace-to-backspace interval (170-222 ms).
- Pauses: fixed-range pauses at every comma/full stop are too regular; real sentence-initial pauses are bimodal (half are short) and long pauses also occur mid-sentence.
- No between-typist model: real typists differ in rollover, repetition speed and error style (eight clusters); simulators expose one WPM knob.
- No key-up/hold modelling (hold about 116 ms, rollover on about 25% of keystrokes); irrelevant for some injection methods, a tell for any detector that sees keydown/keyup pairs.
- Composition layer is absent or ad hoc: only typesim attempts revisions, with hand-set probabilities.
- Layout coverage: QWERTY/AZERTY only in HumanTyping; Turkish Q needs a custom adjacency map (nlpaug tr.json is a starting point).

### Gaps
- I read READMEs only, not source code, so exact sampling code (distribution family, clipping, how WPM converts to delay) is unconfirmed for all three libraries; several defaults are undocumented.
- I did not survey browser-extension "auto typers" for Google Docs; another researcher's material may cover those.
- No published evaluation was found of whether any of these simulators evade keystroke-dynamics or writing-process detectors.
- Turkish F layout and Turkish-specific error patterns (e.g. ı/i, dotless/dotted confusion, missing diacritics typed on a US layout): no empirical source found.

---

## 7. Recommended concrete model: distributions, parameters, state machine

### Takeaway
Use a three-layer generative model: (1) a per-session typist profile sampled from the population (WPM, variability, error-proneness); (2) a keystroke layer with shifted log-normal (or log-logistic) IKIs, multiplicative context factors, typed errors and a lagged-detection backspace state machine; (3) an optional composition layer adding boundary-dependent mixture pauses, bursts and revisions. Every default below is anchored to a cited number where one exists and labelled as an assumption where not.

### Cited Findings
Anchor values the model is calibrated to (see earlier sections for detail).
- Population speed: 51.56 WPM mean, SD 20.2, skew 0.51; 10th/90th percentiles about 26/78 WPM; mean IKI 238.7 ms, floor about 60 ms, skew 1.98; fast typists IKI 122 ms (SD 12), slow 481 ms (SD 123). — [Dhakal et al. 2018](https://userinterfaces.aalto.fi/136Mkeystrokes/resources/chi-18-analysis.pdf)
- Hold time 116 ms (SD 24); rollover 25% average, 40-70% for fast typists, overlap 30 ms mean. — [Dhakal et al. 2018](https://userinterfaces.aalto.fi/136Mkeystrokes/resources/chi-18-analysis.pdf)
- Bigram IKIs: left 215, right 204, alternation 198, repetition 176 ms; word-initial keystrokes slower. — [Dhakal et al. 2018](https://userinterfaces.aalto.fi/136Mkeystrokes/resources/chi-18-analysis.pdf)
- Errors: substitution 1.65%, omission 0.80%, insertion 0.67% of characters; 6.3% of keypresses are backspaces; 1.17% uncorrected; KSPC 1.17; slow typists 3.72 / 1.29 / 0.80%, fast 0.84 / 0.49 / 0.50%. — [Dhakal et al. 2018](https://userinterfaces.aalto.fi/136Mkeystrokes/resources/chi-18-analysis.pdf)
- Transpositions about 5% of corrections; 27% of corrections involve more than one edit. — [Conijn et al., CLIN29](https://www.let.rug.nl/vannoord/Clin/clin29/Rianne_Conijn_Luuk_van_Waes_Menno_van_Zaanen.php)
- Detection lag (characters typed after the error before the first backspace): 46-50% zero, 22-28% one, 11-12% two, 5-7% three, remainder four or more; 86-93% of errors corrected by skilled typists; first backspace about 416 ms; no slowdown after the correction; error words typed at 287 vs 151 ms per letter. — [Crump & Logan 2013](https://www.crumplab.com/publications/Crump/files/4683/Crump%20and%20Logan%20-%202013%20-%20Prevention%20and%20correction%20in%20post-error%20performanc.pdf)
- Letter-to-backspace 420 ms, backspace-to-backspace 222 ms, burst length 1.9-2.2 keys (young adults); fatigue +5-7% IKI over 100 minutes, backspace share 4.2% -> 5.4%. — [Frontiers in Psychology 2018](https://www.frontiersin.org/articles/10.3389/fpsyg.2018.01113/full)
- Composition pause mixture: 330 ms (.65), 735 ms (.26), 2697 ms (.09); pause threshold 2 s; pauses grow from word to sentence to paragraph boundaries. — [Van Waes et al. 2021](https://jowr.org/jowr/article/download/779/836/726); [Vasylets & Marín 2025](https://www.jowr.org/jowr/article/download/1318/979)
- Copy-typing itself is a fluent/hesitant mixture (24% long IKIs in sentence copying); fixed thresholds should scale with the typist's own speed. — [Van Waes et al. 2021](https://jowr.org/jowr/article/download/779/836/726)
- Shape: log-logistic best, log-normal an accepted alternative for hold and flight times. — [González et al. 2021](https://doaj.org/article/c54c349f5c0841a4882885f8a2473bd5)

### Inferences
Everything in this subsection is a proposed design. "(cited)" marks parameters taken directly from the anchors; "(assumed)" marks engineering guesses that should be tuned against the Aalto 136M dataset or a composition keystroke corpus.

**A. Session profile (sample once per session/document)**
- wpm ~ shifted/truncated log-normal with mean 52, SD 20, clipped to [20, 110] (cited moments). For a specific persona, let the user fix it.
- base_iki = 60000 / (5 x wpm) x k, where k of about 0.82-0.88 converts the all-keystrokes mean into a within-word fluent median (so that after boundary slow-downs, hesitations and corrections the realised WPM matches the target; calibrate k by simulation) (assumed).
- sigma_fluent = clamp(0.20 + 0.0009 x base_iki, 0.22, 0.45): faster typists are more regular (direction cited; formula assumed).
- error_scale: per-character gross error rate interpolated by WPM: about 5.8% at 21 WPM, 3.1% at 52 WPM, 1.8% at 90 WPM (cited sums); add a per-session multiplier ~ LogNormal(0, 0.4) for careful vs careless typists (assumed; clusters show this variation exists).
- correct_prob: 0.75-0.93 by persona (cited range 86-93% for skilled typists under accuracy instructions; lower for casual typists implied by 1.17% residual).
- rollover/hold: hold ~ Normal(116, 24) clipped [60, 200] ms (cited); only needed if key-up events are emitted.

**B. Per-keystroke delay**
- iki = shift + LogNormal(ln(base_iki x M_context - shift), sigma_fluent), with shift = 55 ms; hard floor 60 ms (floor cited; shift assumed). A log-logistic with the same median and shape beta of about 3.5-5 is an equally defensible choice (family cited, shape assumed).
- With probability p_hes(context) replace the draw with a "hesitation" draw: LogNormal(median = 2.5-3 x base_iki, sigma = 0.5). p_hes of about 0.03 within words, 0.15-0.25 at word starts in copy mode (calibrate so that about 24% of all transitions are "long" only in the most hesitant copy conditions; default overall about 8-10%) (mixture structure cited; numbers assumed).
- Add lag-1 autocorrelation to the log-residual (rho about 0.2-0.3) so that speed drifts in runs rather than being i.i.d. (assumed; no source retrieved).
- M_context multipliers (multiply together):
  - hand alternation 0.94; same hand, different finger 1.00; same finger, different key 1.15 (first two cited as ratios, third assumed)
  - doubled letter: 0.80 if wpm < 60, 1.00 at 60-75, 1.20 if wpm > 80 (cited direction and magnitudes)
  - frequent bigram (top ~40) 0.90; rare bigram 1.20 (direction cited, values assumed)
  - first letter of a word 1.4-1.8; the space itself 1.0-1.15 (direction cited, values back-solved, see section 2)
  - character needing Shift 1.3-1.6 on that key plus about 40-80 ms on the next; digit row 1.3-1.6; punctuation 1.2-1.5; Enter 1.5-2.5 (all assumed, no data found)
  - every key of a word in which an error will occur: 1.5-1.9 (cited: 287 vs 151 ms)
  - fatigue: 1 + 0.0005 x active_minutes, capped at 1.10; resets partially after breaks (cited magnitude, functional form assumed)

**C. Error generation (evaluated per intended character)**
- p_err(char) = error_scale x M_err, with M_err = 1.5 for rare bigrams/long or unfamiliar words, 1.3 for shifted characters and digits, 0.7 for the top frequent bigrams, x(1 + 0.005 x active_minutes) fatigue up to 1.5 (structure supported by cited directions; values assumed).
- Error type mix (cited proportions, transposition share adjusted in): substitution 50%, omission 22%, insertion 18%, transposition 7%, wrong/missing capitalisation or doubled-wrong-letter 3%. For slow typists shift toward substitution (about 64 / 22 / 14 before transpositions); for fast typists the three are nearly equal (about 46 / 27 / 27) (cited).
- Substitution target (assumed weights): horizontally adjacent key 55%, vertically/diagonally adjacent 20%, same finger of the other hand (mirror key) 10%, a letter from the next 1-2 positions of the word (anticipation) 15%. Use the layout's adjacency map (QWERTY, or Turkish Q from nlpaug tr.json).
- Insertion: 50% duplicate of the current key, 50% an adjacent key struck together with the intended key (inserted before or after it, IKI 20-50 ms from its neighbour; this is the only case allowed under the 60 ms floor) (assumed).
- Omission: skip the character; more likely for doubled letters and for the weaker-finger keys (assumed).
- Transposition: swap with the next character; mostly across hands (assumed).

**D. State machine**

States: TYPING, ERROR_PENDING(lag_remaining, n_to_delete), NOTICE, BACKSPACING(k), RETYPE, PAUSE(kind), REVISING, BREAK.

1. TYPING: for each target character, decide error per C. If no error, emit the key after an IKI from B. If error, emit the erroneous key(s) and decide whether it will be corrected (probability correct_prob; omissions and errors near word ends are noticed slightly less often, assumed).
   - If corrected: draw detection lag L from {0: 0.48, 1: 0.25, 2: 0.115, 3: 0.06, 4: 0.04, 5: 0.025, 6-10: 0.03} (first four cited, tail assumed) and go to ERROR_PENDING(L).
   - If not corrected: leave it; optionally mark it for a later proofreading pass (probability 0.3-0.5 in composition mode, assumed).
2. ERROR_PENDING: keep typing the next L correct characters at normal-to-slightly-faster IKIs (x0.95; cited post-error speeding when the error has not yet been noticed). If a word boundary is crossed, the lag ends at the space with probability about 0.5 (assumed: models "noticed at word end").
3. NOTICE: wait reaction time ~ LogNormal(median = max(350, 1.9 x base_iki) ms, sigma 0.35); for a 150 ms/key typist this gives about 420 ms (cited), for a 240 ms/key typist about 780 ms (cited).
4. BACKSPACING: press Backspace k = L + (characters produced by the error) times, each after LogNormal(median about 200 ms for average typists, 170-220 range, sigma 0.25) (cited). With probability 0.1-0.15 over-delete by one character and retype it (assumed). With probability about 0.05 for long lags, use word-delete instead (assumed; no data).
5. RETYPE: type the correct characters at normal IKIs, no recovery slowdown (cited). The retyped text may itself contain an error (same p_err).
6. PAUSE (copy mode): only the hesitation component from B plus rare "look at source" pauses of 0.8-2.5 s every 6-12 words (assumed).
7. PAUSE (composition mode), evaluated at each boundary before the next keystroke; durations are log-normal with sigma about 0.6-0.9 and medians scaled by base_iki / 180 ms (structure cited, values assumed and loosely anchored to the 330 / 735 / 2697 ms mixture):
   - within word: no extra pause 97%; 3% hesitation, median about 700 ms
   - before a word: 70% none (fluent, about 330 ms total transition), 24% median about 750 ms, 6% median about 2.7 s
   - after a comma/clause: 50% none, 35% median about 900 ms, 15% median about 3 s
   - before a sentence: 50% short (median about 450 ms; cited that over half of sentences start after very short pauses), 35% median about 3 s, 15% median about 8 s
   - before a paragraph: 20% short, 50% median about 6 s, 30% median about 20 s, cap 90-120 s
   - enforce burst structure: if more than about 12 words have passed without a pause >= 2 s, raise the long-pause probability; if fewer than 3, lower it (target 5-12 words per P-burst, cited range).
8. REVISING (composition mode only; all rates assumed): after a pause, with probability about 0.10-0.20 end the burst as an R-burst: delete the last 1-5 words (or back to the start of the clause) with fast backspaces (150-200 ms each, or held-key auto-repeat at about 30-40 ms after a 500 ms delay), pause 0.5-3 s, type a variant, and either keep it or restore the original. At paragraph ends, with probability about 0.05-0.10 move the caret to an earlier sentence (arrow keys/click, 1-4 s), insert/replace a word, and return. Target a product/process ratio of about 0.8-0.9 unless calibrated otherwise (unverified target).
9. BREAK: at sentence/paragraph boundaries, with a small hazard (for example once per 5-15 minutes of active typing), idle for LogNormal(median 45 s, sigma 1.0) capped at 10 minutes; reduce the fatigue term by half after breaks over 2 minutes (assumed).

**E. Calibration and validation targets (check the simulator's output against these)**
- Realised WPM within 5% of target; all-keystroke mean IKI about 60000 / (5 x WPM).
- IKI skewness about 2 and kurtosis about 7 after removing gaps over 5 s; no IKI under 60 ms except chorded insertions.
- Backspaces about 6% of keypresses at 52 WPM (3.4% at 90 WPM, 9% at 21 WPM); KSPC about 1.17 (1.10 fast, 1.24 slow); residual uncorrected error 0.7-1.8% (or 0 if the output must match the source text exactly, in which case route every "uncorrected" error to a later proofreading fix).
- Mean backspace burst about 2 keys; about half of corrections are single-backspace.
- Composition mode: 5-12 words per >=2 s-bounded burst; sentence-initial pause distribution bimodal; pause durations ordered word < sentence < paragraph.
- Over a 100-minute session: mean IKI up by no more than about 5-7%.

### Gaps
- The model's hesitation probabilities, context multipliers for Shift/digits/punctuation, substitution-target weights, revision rates and break process are engineering assumptions without retrieved empirical support; the fastest way to replace them is to fit against (a) the Aalto 136M keystroke dataset for the keystroke/error layer and (b) a composition keystroke corpus (KLiCKe / the Kaggle "Linking Writing Processes to Writing Quality" logs) for the pause/burst/revision layer.
- No source was retrieved on serial dependence (autocorrelation) of IKIs or on how detectors of synthetic typing work, so the "detectability" judgments in section 6 are reasoned from distribution mismatches, not from tested detectors.
- If the final text must equal a supplied source text exactly, the empirical uncorrected-error rate (about 1.2%) cannot be reproduced literally; the proofreading-pass workaround is an assumption about human behaviour not quantified here.
- Turkish-language specifics (bigram frequencies, Turkish Q finger assignments, diacritic errors) need a Turkish corpus; nothing empirical was found.
