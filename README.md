# Virtue Care Finder — Solution Overview

*Built on Databricks for the Virtue Foundation DAIS 2026 challenge. All tables live in `workspace.virtue_finder`. Every number here comes from a query you can re-run in the pipeline notebook.*

**▶ Live app: https://virtue-care-finder.vercel.app** (*Find care* chat + *District planner* dashboard; no sign-in needed)

**Contents**
0. Problem and guiding principles
1. Data cleaning and deduplication
2. Data issues identified
3. External resources added
4. Fixes that make the data reliable
5. The recommendation algorithm
6. Testing and validation
7. User interface and dashboard
8. Limitations and open issues
9. Where everything lives (table index)
- Appendix: canonical queries

---

## 0. Problem and guiding principles

**The problem.** A health worker in a small town has a patient who needs a specific treatment, such as a cochlear implant or a corneal transplant. Where should she send the patient? Nobody can phone 10,000 hospitals, and Googling gives marketing pages, not answers.

**The data.** About 10,000 healthcare facilities across India (hospitals, clinics, specialty centres). Each record holds what the facility *claims*: capabilities, procedures, equipment, specialties, address, phone numbers, and links to the websites the information was scraped from.

**The goal.** Anyone can ask "where can a patient get X near Y?" and get trustworthy recommendations, with the tool showing its work every time.

**Guiding principles**
- **Never recommend without a receipt.** Every recommendation quotes the hospital's own words that justify it. When the proof is thin, the tool says so: "please verify by phone before travelling." A confident wrong answer is more dangerous than an honest "we're not sure."
- **Separate assertion from evidence.** Every layer records `value_status`, `*_flag`, `mapping_source`, `district_match` and evidence columns. The pipeline never changes a fact without recording why. Every bug found (thin_sample all-TRUE, the Purnia 200,000-bed outlier, the Raisen→Sehore mapping chain) surfaced as a flagged disagreement rather than silent corruption.
- **Nothing is destroyed.** Originals are kept beside cleaned values, every change goes to an audit table, and the full 10,000-row original table is preserved as a backup.
- **Join key everywhere:** state + district (NFHS-5 names, harmonised).

---

## 1. Data cleaning and deduplication

### 1.1 Why the raw data is messy
The data comes from web scraping: automated programs read hospital websites. Huge coverage, but nobody checked it.
- Useful information is buried in free text ("24-bed Dialysis Unit with 10 machines").
- Some records merged two hospitals into one (equipment that clearly belonged to a different named hospital).
- A website is a claim, not a guarantee: "We offer NICU" may be outdated. We can't fix that, but we always show where the claim came from.

### 1.2 Deduplication: one hospital or two?
Both mistakes hurt patients: merging different hospitals hides a real option; keeping true duplicates shows the same hospital twice. So we measured before touching anything.

| Finding | Count | Decision |
|---|---|---|
| Exact copies (same internal ID, identical rows) | 11 | Removed |
| Same name, different places | 318 groups | Kept: almost all genuine chains/branches (a patient in Howrah should see Howrah's branch) |
| Phone numbers shared across facilities | 104 numbers, 441 facilities | Never by itself a reason to merge (call centres, switchboards, booking lines) |
| Candidate true duplicates (same name + same PIN, or same PIN + same dedicated website and phones) | 39 pairs | Audited by hand |
| Confirmed same hospital | 33 pairs | Merged |
| Wrong merges caught by the audit | 6 | Undone (e.g. Fortis Mohali had been merged into Fortis Ludhiana, ~100 km apart) |

- The surviving record keeps the cleaner name and absorbs the duplicate's phones, website links and every receipt (receipts still number 496,044; they now cover 9,950 facilities instead of 9,983).
- Borderline cases (a specialty unit inside its parent hospital's campus) were decided one by one, with reasoning recorded.
- Every merge is in an audit table with its reason; any merge can be undone with one command.
- **Result: 9,956 unique facilities, down from 10,000 rows** — documented, auditable and reversible.

### 1.3 Phone-number cleaning
Every raw phone entry (95,975) was checked one by one; every removal is recorded.
- **132 junk entries removed:** American numbers (+1…), fragments too short to dial, strings too long to be real.
- **56,636 repeats removed** within a hospital's own list (one IVF chain listed 8 real numbers padded to 129 entries). **39,207 unique valid numbers remain.**
- **104 numbers shared by 441 facilities** kept (they're dialable) but never used to merge records and never presented as the hospital's own local number.
- **Classification by area** using an STD-code map derived from the data by majority vote:
  - Area code matches the hospital's state → **local landline**
  - Mobiles → can't be located
  - 1-800 and 1-860 → **toll-free** (1-860 is a genuine Indian series our first pass wrongly discarded; fixing it rescued hundreds of Apollo-chain numbers)
  - Landline pointing at a different state → usually a **central booking line**
- Shown in order: local landlines first, booking lines last and labelled.
- Edges: 114 facilities whose only landlines point at other states are flagged for human review; 281 have no phone list ("no phone on file"); 11 had only invalid numbers. Delhi's area code is deliberately untrusted for area-checking, because national booking lines are often Delhi numbers.

### 1.4 Column-by-column cleaning
Every change is written to `facility_data_quality_fixes` (3,741 rows) with the rule that fired; the original table is untouched. `*_clean` columns hold fixed values, `*_flag` columns say why; raw columns sit beside them (1:1 with `facility_profile` on `unique_id`, zero orphans).

**Fix-log rule inventory**

| Column | Rule | Rows |
|---|---|---|
| capacity_beds | Removed above far-out fence (3× log-IQR, 30,349) | 1 |
| email | Nulled empty/null-literal | 1,446 |
| email | Removed invalid format (e.g. `[email protected]`) | 395 |
| officialWebsite | Nulled empty/null-literal | 1,603 |
| officialWebsite | Reclassified directory listing (Practo, JustDial…) as a source, not an official site | 28 |
| number_doctors | Removed where doctors > 3 × beds (impossible staffing) | 13 |
| number_doctors | Removed above far-out fence (3× log-IQR, 10,000) | 1 |
| year_established | Removed impossible year (e.g. 0) | 5 |
| pincode | Recovered by junk-stripping to 6 digits (e.g. `613 007` → `613007`, all within the same postal sorting prefix) | 154 |
| pincode | Nulled unparseable (e.g. `000000`, `COCHIN-16`, `39`) | 74 |
| pincode | Nulled failed area cross-check (valid format, wrong place, e.g. `305994`) | 17 |
| pincode | Nulled missing | 4 |

**Notes by column**
- **PIN codes:** 9,528 verified against the official postal directory; 187 missing from the postal reference but plausible for the hospital's state were kept (the reference has gaps; Ludhiana's real 141009 is one).
- **Beds and doctors** are display-only, never used for ranking. India has genuine 3,000–4,000-bed hospitals, so outlier fences were computed from the data (3× log-IQR). Exactly **one bed value was amputated nationally**: Harsh Hospital (`1774eb01-bb63-4cbb-b1ad-c9b4cf03c605`, city Motihari, PIN-assigned to Purnia, Bihar), 200,000 → NULL — that one row was ~30% of the national bed total.
  - Propagation verified: raw total 670,597 → clean 470,597 → `facility_context` 470,597 (no raw leakage). Top-bed districts after the fix are metros: Hyderabad 18,009 · Pune 17,064 · Bangalore Urban 16,693 · Patna 11,661 · Mumbai 11,468 · Ernakulam 10,754.
  - A zero is kept as real information (a dental clinic with 0 beds is outpatient).
  - Identical doctor counts across a chain's branches (three Partha Dental branches, each "300 doctors") are kept but labelled a suspected chain-wide total.
- **Dropped columns:** a page-update field that is 64% blank, and a "type" field that says "facility" for every row.
- **Net effect:** beds is the only substantive value amputation; the rest is null normalisation, format validation and the doctors > 3 × beds rule.

---

## 2. Data issues identified

**Map pins (coordinates)**
- Cross-checked against the India Post directory for each facility's own PIN: **about 15% (1,487 of 9,529) had coordinates in the wrong place** — a hospital in Lucknow was mapped to North America. One wrong pin can push a hospital to the top of the wrong city's results or hide it from the right ones.

**PIN codes and state/city fields**
- 570 hospitals had a state that didn't match their PIN's state (a Hyderabad hospital carried a Delhi PIN).
- 71 PIN codes weren't valid formats (one was just "35").
- 383 had a city name or nickname in the state field ("Mumbai" as a state, "tamilnadu").

**Merged / contaminated records**
- Some records contain another hospital's equipment descriptions; a description that keeps saying "…installed at [some other hospital]" is a red flag.

**Physical location vs claimed district** (geo QA)
- 13% metro-border effect: e.g. 52 facilities claimed Kolkata but sit physically in South 24 Parganas; Chennai↔Kancheepuram; Hyderabad↔Ranga Reddy. PIN serving district ≠ physical location.
- 3,552 state-crossing post-office geocodes (the actionable suspects); most PO mismatches are benign adjacent-district pairs (Eluru→W. Godavari, Satna→Rewa).

**Name mismatches across sources**
- The survey, the postal directory and scraped addresses spell districts differently ("Bangalore" / "Bangalore Urban"; "NCT of Delhi" / "Delhi"; "Leh(Ladakh)" / "Leh"). A wrong join fails silently and drops most of the country.

**Reference data quality**
- The MeSH medical dictionary file provided had description text but all dictionary fields empty — unusable.

---

## 3. External resources added

| Resource | What it adds | Used for |
|---|---|---|
| **India Post PIN-code directory** | Post offices with PIN, district, state, coordinates | Checking/fixing map pins; facility → district assignment; district centre points |
| **NFHS-5 (2019–21) district survey** | 73,424 district-by-indicator numbers; all 36 states/UTs and 706 districts (institutional births, C-section rates public vs private, ANC visits, vaccination, anaemia, high BP, sex ratio at birth, insurance coverage, out-of-pocket delivery costs) | District health context in answers; district dashboard |
| **geoBoundaries IND-ADM2-2021** district polygons | Official district boundaries | Choropleth maps; geometry QA |
| **MeSH** (attempted) | — | File unusable; replaced by an AI-generated service family tree, labelled as such |

---

## 4. Fixes that make the data reliable

### 4.1 Location fixes (map pins)
1. **Check the pin:** measure the distance from the facility's coordinates to the post offices of its own PIN.
2. **Fix wrong pins:** more than 25 km from its PIN area → replace with the PIN-area centre; originals kept in `facility_geo_check`.
3. **Rank with text first:** candidates are selected by text location (PIN, city, state — immune to bad pins); coordinates only sort results. Corrected locations are labelled "location approximate — based on PIN code area."

### 4.2 Location verdict (when the PIN itself is wrong)
A second layer, `facility_location_trust`, decides which signal to trust per hospital:
- PIN conflicts with the hospital's own state/city → text wins; the pin moves to the centre of the claimed **city**.
- Broken state fields repaired ("Mumbai" → Maharashtra, "tamilnadu" → Tamil Nadu).
- Nothing trustworthy → pin removed; the hospital is still matched by city/state text with the note "exact location unclear — please verify the address by phone."
- **Cannot fix:** street-level errors, and records where city, PIN and pin are all consistently wrong (e.g. a record copied from another hospital). Every answer therefore shows the full address — the address is the ground truth; the pin only sorts.

### 4.3 Joining NFHS-5 reliably
1. **Name bridge** (`nfhs5_district_bridge`, 138 pairs, grown from 112): renames, spellings, splits resolved once with normalised keys (Prayagraj→Allahabad, Gurugram→Gurgaon, Nuh→Mewat, "Maharastra"→Maharashtra). No fuzzy matching at query time.
2. **Facility → district map** (`facility_district_map`): each PIN looked up in India Post (district where most of that PIN's post offices sit), then bridged to survey spelling. Resolves **99.96%** (9,670 of 9,674 with a usable PIN; the 4 leftovers have garbage PINs — flagged, not guessed). PIN assigns; geometry only validates (serving-district semantics, matching how NFHS assigned households).
3. **Verified values:** every value carries `value_status` = ok / low_confidence / suppressed. Suppressed (asterisked) values are stored, never dropped. `thin_sample` is TRUE only for low-confidence rows (5,068; was erroneously all-TRUE until fixed 2026-11-22). Spot-checked against official fact sheets (Gurgaon matches exactly).

**Honesty rules for survey numbers**
- Always cited as "In the NFHS-5 survey (2019–21) for [district] district…" — a historical snapshot.
- Thin samples quoted with "(small survey sample — treat as rough)".
- Suppressed values reported as **"not reported for this district," never "0%"** (anaemia among pregnant women is suppressed or thin in about 79% of districts).

### 4.4 Geo validation layer
- **District polygons, name-first rebuild** (`district_polygon_map`, 735): the first build let geometry votes decide, and drifted centroids cascaded (Raisen→Sehore→Shajapur→Agar Malwa in MP; mis-geocoded clusters made Ashoknagar→Gautam Buddha Nagar). The rebuild: name_identity 674 → fuzzy_name 22 → bridge 9 → vote 5 (state-consistent, resolves post-NFHS splits) → unmapped 25 (remote NE + a junk polygon "DATA NOT AVAILABLE"). Duplicate names (both Bilaspurs) resolve to their own states.
- **Confidence layers** (`facility_geo_polygon_qa`, 9,923; `po_geo_polygon_qa`, 151,000): record where each point physically fell vs what it claims. Method: pure-Python ray-casting point-in-polygon (no GeoPandas/Sedona on serverless).
- **Post-office validation for distances:** India box → per-state 2nd–98th percentile box → district-median consistency ≤100 km (naive checks failed: a Chennai PO in the Arabian Sea, Azamgarh POs in Maharashtra).
- **Distance backfill:** 658 → 701 districts. 43 had been silently dropped by name joins (`JAMMU AND KASHMIR` vs `Jammu & Kashmir`, plus 26 spelling/renames added to the bridge, e.g. Budgam→Badgam, Kanker→Uttar Bastar Kanker, Deogarh→Debagarh). All 20 J&K districts now present.

---

## 5. The recommendation algorithm

### 5.1 Version 1: 15 common services, hand-checked
- Hand-built search patterns for the 15 most important referral services: dialysis, emergency C-section, NICU, MRI, CT, ICU, burn care, cancer care, cardiac surgery, eye care, maternity, orthopedics, pediatrics, trauma/emergency, blood banks.
- Every match becomes an evidence row (a receipt). Trust signals per facility: independent websites backing it, phone numbers, doctors and beds, contamination/merge flags.
- **Evidence tiers**
  - **Strong:** confirmed in 2+ fields, at least one with real numbers ("10 machines", "24 beds")
  - **Moderate:** 2+ fields without numbers, or one field with numbers
  - **Weak:** a single vague mention — always shown, always with "please verify by phone"

### 5.2 The long-tail problem
Most services are rare. Hand-writing rules for 5,000 services would take months and be error-prone, so the system learns services from the data in four steps.

| Rarity | Facilities offering it | Number of services |
|---|---|---|
| Head (very common) | 500+ | 105 |
| Common | 100–499 | 248 |
| Rare | 20–99 | 707 |
| Ultra-rare | 1–19 | **3,785** |

### 5.3 Step 1 — Vocabulary
Every phrase that looks like a service ("…surgery", "…care", "…therapy", "…transplant", "…screening") plus every specialty tag: **8,003 distinct service terms**, including single-hospital rarities ("ABO-incompatible kidney transplant"). Variants normalised ("ENT Surgery", "ENT-Surgery", "e n t surgery" → one).

### 5.4 Step 2 — Family tree (ontology)
- **29 categories → 4,833 service concepts** (e.g. "Corneal Transplant", "Cochlear Implant").
- MeSH was unusable, so an AI model grouped the terms; the tree is **labelled AI-generated** and can be swapped for a real dictionary later.
- Accuracy ~99.8%: 7,949 terms mapped directly, 41 recovered by backup matching, 13 unplaced.

### 5.5 Step 3 — Receipts at scale
Every sentence checked against all services. Each receipt stores the exact sentence, source field, whether it contains numbers, whether it looks like another hospital's text (contamination flag), plus location, phones and website links.
**Result: 496,044 receipts, 9,983 facilities, 4,837 services.** (`has_cross_reference_evidence` makes claims cross-checkable.)

### 5.6 Step 4 — Honest answers about rarity
When a service is ultra-rare, **roll up the family tree and say so**:
> "You asked about corneal transplantation. Only 1 facility claims it, so we've broadened the answer to all eye-surgery services (category: Ophthalmology and Eye Care)… This is an ultra-rare service: verify by phone before travelling."

Every answer carries two honesty labels: **match level** (exact vs broadened) and **rarity**.

### 5.7 Step 5 — Understanding everyday speech
An embedding "meaning-matcher" encodes the user's phrase and all 4,833 services and finds the closest matches, in plain database queries.
- "kidney machine" → Kidney Dialysis, Renal Dialysis, Dialysis Unit, Hemodialysis
- "keyhole surgery" → Keyhole Surgery, Minimal Invasive Surgery, Laparoscopic Surgery
- "thoracoscopic esophagectomy" → Esophagogastric Surgery, VATS, Thoracic Surgery
- Below the similarity threshold, the tool says it has nothing close and offers the nearest alternatives.

### 5.8 Ranking and answer rules
1. Understand the service: exact vocabulary first, then the meaning-matcher.
2. Use the hand-checked v1 data for the 15 common services; the 4-step system for everything else.
3. Rank by **evidence strength first, distance second**.
4. Always show: quoted receipts, rarity, exact vs broadened match, phones, address, distance from the patient's PIN.

---

## 6. Testing and validation

### 6.1 Conversation tests (checked by hand against the database)
| Test | Result |
|---|---|
| Cochlear implant near Delhi | First said "none found" — bug: names vs internal keys confused in a join. Fixed with a translation table; now finds Moolchand at 7.8 km with receipt |
| "Kidney machine" near Patna | Correctly understood as dialysis |
| Dialysis near Patna | 10 facilities with distances, tiers, verify-by-phone warning |
| Corneal transplant near Hyderabad | 2 eye hospitals with receipts and phones |
| Hospice/palliative near Pune | 5 facilities, up to 127 km (widened honestly) |
| Thoracoscopic esophagectomy near Mumbai | "None found" — verified true by hand (offered in Hyderabad, Vadodara, Ahmednagar, Nagpur) |
| Cancer centre near Huda City Centre, Gurgaon | Answer looked right, but the assistant had silently used landmark coordinates from its own memory. Fixed with a two-step landmark rule (see 7.1) |

### 6.2 Regression check (v2 vs hand-checked v1, 15 services)
13 of 15 at full coverage. Exceptions:
- **Blood banks:** v2 missed phrases like "blood storage"; v1 stays in charge of the 15 services, so nothing is lost.
- **Pediatrics:** subspecialties now filed under their real specialty (pediatric heart surgery → heart surgery).

### 6.3 Benchmarks (auto-scored; correct answers computed from the database, never a model's memory)
1. **C-section near PIN 122001 (Gurgaon):** correct answer is *none listed* — only one facility nationwide claims C-section deliveries (Ramaben Hospital, Navsari, Gujarat). Passes only if no hospital is invented and district context is added: 18.6% of Gurgaon births were C-sections (7.4% public vs 36.2% private).
2. **UP districts with lowest institutional-birth share:** Shahjahanpur (63.3%), Bahraich (67.7%), Farrukhabad (69.3%), Balrampur and Siddharthnagar (69.7% each).
3. **Dialysis within 50 km of Gwalior:** exactly five hospitals, nearest 10.3 km.
4. **Anaemia among pregnant women in Srikakulam:** correct answer "not reported" (suppressed); any number, especially 0%, fails.
5. **Proton therapy:** exactly eight facilities, no invented cancer centres.

Building these caught another silent trap: `district_centroids` stores names in capitals ("GWALIOR"), so a join on "Gwalior" returned nothing. The suite re-runs after any data or instruction change.

---

## 7. User interface and dashboard

### 7.1 Chat assistant (Genie spaces)
**Virtue Care Finder — where should a patient go?** and **Virtue Care Finder v2 — District Health Context**
- Applies the ranking and answer rules in 5.8.
- **Asks before guessing a location.** The data has hospital locations, not landmarks. For a landmark, it first asks for a PIN, district or sector; if the landmark is still the best reference, it shows the coordinates it plans to use (labelled as recalled from general knowledge) and waits for confirmation.
- **Adds district health context** for births, C-sections, vaccination, anaemia, insurance, following the NFHS honesty rules (4.3).
- **Reads the cleaned tables** (`facility_profile_clean`, `facility_phone_clean`): local landlines first, mobiles next, toll-free and booking lines last and labelled; flagged values (chain-wide doctor counts, zero-bed outpatient clinics) are mentioned, not presented as fact.
- Example answer: *"Moolchand Hospital — 7.8 km — receipt: 'Cochlear Implant' (from its procedures list). Weak evidence tier: please verify by phone."*

### 7.2 The assistant's rulebook (its written instructions)
Everything the assistant does is enforced by a written rulebook (the Genie space's instruction prompts) that it must follow on every answer. The most recently added rules:

1. **Data-backed results, always.** Every claim (a facility, service, phone number, bed count, distance or statistic) must come from an attached table:
   - a service claim needs a quoted receipt;
   - a facility attribute needs the cleaned profile;
   - a health statistic needs the NFHS-5 tables, quoted with its label, unit and reliability status.
   If the data doesn't support a statement, the assistant may not make it; it says what the data shows instead.
2. **Never medical advice.** It never diagnoses, recommends treatments or medicines, gives dosage guidance, or judges whether a facility is right for a patient's condition.
   - Medical questions ("should my patient have an angioplasty?"): it says plainly that it cannot advise, shows the data-backed facility options and survey context, and points to a qualified healthcare professional.
   - Possible emergencies: it lists the nearest emergency-capable facilities from the data and urges immediate medical contact.
3. **Explaining empty results with the survey.** When a search finds no facilities, or only weak, low-confidence signals, for an area, the assistant explains the gap with the district's NFHS-5 picture: institutional-birth rates, public-facility births, insurance coverage and survey-sample size. (Low institutional-birth and insurance coverage, for instance, are consistent with a thin hospital presence in the scraped directory for that district.) The survey explains the gap; it is never presented as a substitute recommendation.
4. **Survey context at the level asked for.** When a question names both a place and a condition ("C-section facilities in Gurgaon", "anaemia in Bihar"), NFHS-5 numbers are appended after the recommendations, at the user's granularity:
   - **District:** values quoted directly.
   - **State:** average of that state's districts, with the number of districts averaged, labelled approximate.
   - **All-India:** average across all 706 districts, never called an official national estimate.
5. **Spelling-proof joins.** The rulebook hard-codes the name traps: NFHS-5 uses census-era spellings (Gurugram is "Gurgaon", Howrah is "Haora", Mohali is "SAS Nagar"). Survey numbers are always reached through the facility-to-district map's survey-spelled keys, matched case-insensitively, never through a hospital's own city text.

### 7.3 District dashboard
- **Master table** `facility_nfhs5_district_burden_supply` (706): one row per NFHS district with all burden, supply, affordability and thin flags — one pull per tab, no joins. Grain is the NFHS district (burden data only exists at that vintage).
- **Five family tables** (706 each: anaemia, de-addiction, vaccination, maternal, NCD): each pairs a topic's burden with its matching supply (de-addiction facilities vs tobacco/alcohol %; maternal facilities vs institutional births).
- **Underserved score** (`facility_nfhs5_district_underserved_score`, range −0.94…+0.95):
  `(anaemia_pct + substance_pct + nonvaccination_pct + noninstitutional_birth_pct) / 4 − supply_pct` (all percentiles). Percentiles are relative to this dataset only.
- **Facility layer** (`facility_nfhs5_facility_context`, 9,956): identity, contacts, beds, coordinates and 5 service flags (`has_maternal`, `has_deaddiction`, `has_vaccination`, `has_ncd`, `has_delivery_surgical`) for map markers with zero joins.
- **Reachability** (`facility_nfhs5_district_service_distance`, 701): straight-line distance from validated post offices (~150 per district) to the nearest facility, by service family; same-state only. Excluded by design: Leh, Kargil, Lakshadweep (no facilities), Yanam (632 km enclave artifact), Chandel (listed under Mizoram in NFHS-5).
- **Choropleth** (`district_polygon_metrics`, 735): 710 polygons shaded, 691/706 NFHS districts covered, 25 grey polygons honestly unmapped. Plotly: `locations=polygon_district`, `featureidkey=properties.shapeName`, geojson `geoBoundaries-IND-ADM2_simplified.geojson` in `/Volumes/workspace/virtue_finder/geodata/`; reference render `india_underserved_choropleth.html`.

### 7.4 Caveats shown in tooltips
- 0 facilities = none **mapped** in web-mined data, not verified absence; government supply is undercounted.
- NFHS-5 = 2019–21 survey, historical.
- `thin_sample` = TRUE → 25–49-case estimate, shown with caution styling (325 districts trip this via vaccination).
- Distances are straight-line, same-state only; enclaves (Yanam) overstated.
- Beds cover ~25% of facilities; per-10k figures use surveyed households, not real households.
- Metro-border facilities may sit in the neighbouring polygon while serving the claimed district.

---

## 8. Limitations and open issues

### 8.1 Limitations
- The data is web-scraped claims, not verified reality; the job is to make every claim visible and checkable, not to certify it.
- The service family tree is AI-generated (MeSH file was empty).
- Rare-service claims may be few and stale — always "verify by phone."
- The meaning-matcher can find nothing close; the tool then says so.
- NFHS numbers are a 2019–21 snapshot; many values suppressed (reported as "not reported").
- "Within X km of [district]" uses district centre points — fine for range, not navigation.
- Phone numbers may be shared booking lines (shown last, labelled); 114 facilities flagged for review; 281 with no phones; 11 with only invalid numbers.
- Beds and doctor counts are self-reported; impossible ones removed, chain-wide totals flagged, plausible-but-stale values may remain.

### 8.2 Interpretation note — 0 facilities but high institutional births (not a bug)
174 districts have 0 mapped facilities yet average 81.7% institutional births (67 districts ≥90%).

| Facilities mapped | Avg institutional birth |
|---|---|
| 0 | 81.7% (69.2% at public facilities) |
| 1–10 | 89.3% |
| 11–50 | 94.4% |
| 50+ | 94.3% |

Causes: the facility layer is web-mined private/registered providers, so the government PHC/CHC/district-hospital network (52–69% of births) is invisible; deliveries cross district borders; survey estimates come from ~700–900 households (thin_sample-flagged); India's public-system-driven institutional-delivery boom.

### 8.3 Known open issues (as of 2026-11-22 — diagnosed, not yet fixed)
1. **Gujarat post-office geocodes are junk:** ~800 POs (Vadodara, Patan, Chhota Udepur, partly Kheda) share a stamp around 15.59°N (Arabian Sea). Distances read Vadodara 279 km, Chhota Udepur 314 km, Patan 273 km. Validation missed it because >10% of state POs share the stamp. Fix when approved: polygon-containment validation.
2. **Per-10k denominators wrong:** `households_surveyed` is the NFHS sample (~376–921), not real households, inflating per-10k figures by 2–3 orders of magnitude (Hyderabad 256,174 beds/10k). Ranking-usable, unit-nonsense. Fix when approved: Census household counts.
3. **Three polygon mappings known wrong, pending override:** Rangareddy→Sangareddy (should be Ranga Reddy), Warangal (U)→Warangal Rural, Chengalputtu→Chennai (should be Kancheepuram). Four unverified suspects: Alipurduar→Purba Medinipur, Barddhaman→Paschim Barddhaman, Bemetra vs 76 Gariyaband PO claims, Lower Siang→Siang.
4. **Sikkim spelling** `"North  District"` (double space) — hazard for exact-name joins.
5. **Assignment quirk:** Harsh Hospital's city is Motihari (Purba Champaran) but its PIN assigns it to Purnia — on the PIN QA list.

---

## 9. Where everything lives (table index)

| Layer | Table / asset | Rows | Purpose |
|---|---|---|---|
| Pipeline | Notebook **Virtue Facility Finder Pipeline** | — | All steps with code |
| Backup | `facility_profile_backup_20261122` | 10,000 | Untouched original rows |
| Dedup | `facility_dedup_map`, `facility_dedup_review`, `facility_dedup_rollback` | — | Every merge, reason, rollbacks |
| Cleaning | `facility_profile_clean` | 9,956 | Cleaned PIN, beds, doctors, websites, emails, year |
| Cleaning | `facility_phone_clean`, `facility_phone_summary`, `std_code_map`, `facility_phone_audit` | 39,207 numbers | Cleaned phones, ordered local → booking |
| Cleaning | `facility_data_quality_fixes` | 3,741 | Every cleaning change and rule |
| Location | `facility_geo_check` | — | Pin corrections and why |
| Location | `facility_location_trust` | — | Which location signal to trust |
| v1 services | `service_catalog`, `facility_service_evidence`, `facility_profile` | 15 services | Hand-checked data |
| v2 services | `service_terms_mined` | 8,003 | Mined vocabulary |
| v2 services | `service_ontology` (+ `term_concept_map`) | 4,833 concepts (4,868 rows) | Family tree |
| v2 services | `facility_service_evidence_v2` | 496,044 | Receipts |
| v2 services | `node_stats` (+ `v2_concept_lookup`) | — | Rarity and match level |
| v2 services | `concept_embeddings` | 4,833 | Meaning-matcher |
| NFHS-5 | `nfhs5_indicators_long` | 73,424 | District × indicator values with status |
| NFHS-5 | `nfhs5_indicator_dictionary` | 104 | Labels, units, definitions |
| NFHS-5 | `nfhs5_district_bridge` | 138 | Survey ↔ postal name bridge |
| Districts | `facility_district_map` | 9,956 | Facility → district (PIN-based) |
| Districts | `district_centroids` | 755 | District centre points |
| Dashboard | `facility_nfhs5_district_burden_supply` | 706 | Master burden + supply |
| Dashboard | Five family supply tables | 706 each | Topic drills |
| Dashboard | `facility_nfhs5_district_underserved_score` | 706 | Underserved score |
| Dashboard | `facility_nfhs5_facility_context` | 9,956 | Map layer |
| Dashboard | `facility_nfhs5_district_service_distance` | 701 | Reachability |
| Geo | `district_polygon_map` | 735 | Polygon → NFHS district |
| Geo | `district_polygon_metrics` | 735 | Pre-joined choropleth metrics |
| Geo | `facility_geo_polygon_qa`, `po_geo_polygon_qa` | 9,923 / 151,000 | Physical vs claimed location |
| Assistant | Genie: **Virtue Care Finder — where should a patient go?** | — | Facility search |
| Assistant | Genie: **Virtue Care Finder v2 — District Health Context** | — | Facility search + district context |

---

## Appendix: canonical queries

```sql
-- NFHS values with reliability
SELECT state, district, value, value_status, thin_sample
FROM workspace.virtue_finder.nfhs5_indicators_long
WHERE indicator_code = 'child_anaemia' AND state = 'Bihar'
ORDER BY district;

-- Indicator labels
SELECT * FROM workspace.virtue_finder.nfhs5_indicator_dictionary
WHERE label ILIKE '%anaemia%';

-- Map any current-name dataset onto NFHS-5 district names
SELECT d.*, b.nfhs5_district, b.mapping_type
FROM my_current_named_table d
LEFT JOIN workspace.virtue_finder.nfhs5_district_bridge b
  ON UPPER(TRIM(b.current_state)) = UPPER(TRIM(d.state))
 AND UPPER(TRIM(b.current_district)) = UPPER(TRIM(d.district));

-- Flagged bed values
SELECT name, city, state, capacity_beds AS raw_beds, capacity_beds_clean, capacity_beds_flag
FROM workspace.virtue_finder.facility_profile_clean
WHERE capacity_beds_flag NOT IN ('ok', 'not reported')
ORDER BY name;

-- The amputated row, full audit trail
SELECT unique_id, name, capacity_beds, capacity_beds_clean, capacity_beds_flag
FROM workspace.virtue_finder.facility_profile_clean
WHERE unique_id = '1774eb01-bb63-4cbb-b1ad-c9b4cf03c605';

-- Facilities with evidence per service
SELECT service, COUNT(DISTINCT unique_id) AS facilities_with_evidence
FROM workspace.virtue_finder.facility_service_evidence_v2
GROUP BY service ORDER BY 2 DESC;

-- Ontology terms per canonical service
SELECT s.service, s.label, COUNT(o.term) AS ontology_terms
FROM workspace.virtue_finder.service_catalog s
LEFT JOIN workspace.virtue_finder.service_ontology o ON o.concept = s.service
GROUP BY 1, 2;

-- Top districts by child anaemia with supply context
SELECT state, district, child_6_59m_anaemia_pct, n_facilities,
       facilities_per_10k_households, total_beds, thin_sample
FROM workspace.virtue_finder.facility_nfhs5_district_burden_supply
ORDER BY child_6_59m_anaemia_pct DESC LIMIT 25;

-- Tobacco burden vs de-addiction supply
SELECT state, district, men_tobacco_pct, n_deaddiction, deaddiction_per_10k_households
FROM workspace.virtue_finder.facility_nfhs5_district_deaddiction_supply
ORDER BY men_tobacco_pct DESC LIMIT 15;

-- Most underserved districts
SELECT state, district, underserved_score, anaemia_percentile, substance_percentile,
       nonvaccination_percentile, noninstitutional_birth_percentile, supply_percentile
FROM workspace.virtue_finder.facility_nfhs5_district_underserved_score
ORDER BY underserved_score DESC LIMIT 25;

-- Maternal-capable facilities in one district (map tab)
SELECT unique_id, name, latitude, longitude, has_maternal, capacity_beds, officialPhone
FROM workspace.virtue_finder.facility_nfhs5_facility_context
WHERE nfhs5_state = 'Bihar' AND nfhs5_district = 'Purnia';

-- Least reachable districts
SELECT state, district, avg_km_to_nearest_facility,
       avg_km_to_nearest_maternal, avg_km_to_nearest_deaddiction, n_post_offices
FROM workspace.virtue_finder.facility_nfhs5_district_service_distance
ORDER BY avg_km_to_nearest_facility DESC LIMIT 20;

-- District centre points
SELECT current_state, current_district, latitude, longitude, post_offices_used
FROM workspace.virtue_finder.district_centroids WHERE current_state = 'Kerala';

-- District assignment coverage
SELECT match_status, COUNT(*) FROM workspace.virtue_finder.facility_district_map
GROUP BY 1;

-- Non-trivial polygon mappings
SELECT polygon_district, mapped_state, mapped_district, mapping_source
FROM workspace.virtue_finder.district_polygon_map
WHERE mapping_source IN ('fuzzy_name', 'bridge', 'vote');

-- Choropleth metrics
SELECT polygon_district, nfhs_district, nfhs_state, underserved_score,
       child_anaemia_pct, n_facilities, avg_km_to_nearest_facility
FROM workspace.virtue_finder.district_polygon_metrics
WHERE underserved_score IS NOT NULL
ORDER BY underserved_score DESC LIMIT 25;

-- Facilities whose claimed district disagrees with physical location
SELECT nfhs5_state, nfhs5_district, polygon_district_nfhs, facility_name
FROM workspace.virtue_finder.facility_geo_polygon_qa
WHERE assigned AND district_match = FALSE AND polygon_district_nfhs IS NOT NULL
ORDER BY nfhs5_district;

-- Actionable post-office geocode suspects (state-crossing only)
SELECT officename, pincode, statename, district, polygon_district, mapped_state
FROM workspace.virtue_finder.po_geo_polygon_qa
WHERE assigned AND district_match = FALSE
  AND mapped_state IS NOT NULL
  AND UPPER(TRIM(statename)) <> UPPER(TRIM(mapped_state));
```
