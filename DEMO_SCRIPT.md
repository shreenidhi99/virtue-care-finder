# District Planner dashboard: talk track (about 4 minutes)

**Before you start:** double-click `start_app.bat`, open http://localhost:8501, click **District planner**, and let the first map load once (a cold warehouse takes a few seconds).

---

## 1. The question (20 s)

> "If you're a district health planner, where in India is the need for care highest compared with the care that exists? This dashboard answers that district by district, for all 706 NFHS-5 districts."

## 2. Caveats first (30 s)

**Point at the blue box at the top.**

> "We show the limits up front.
> - **Supply** counts the facilities in our records. Those are mostly private and registered providers, so government health centres are largely missing.
> - The **per-10k figures** are only good for comparing districts, not as real rates.
> - **Bed data** is thin: only about 28% of facilities report beds.
> - Three **Gujarat districts** have wrong distances because of bad post-office coordinates."

## 3. National overview: where is the gap? (1 min)

**Point at the map (default: Underserved score).**

> "Each district is shaded by an **underserved score**. On the burden side we use four measures from the **NFHS-5 survey (2019–21)**: child anaemia, men's tobacco and alcohol use, children not fully vaccinated, and home births. Each is ranked against all districts, the four are averaged, and then we subtract how well supplied the district is.
> **Red** means high burden and low supply. **Blue** means better served than a typical district.
> The red clusters are central India (Bastar and the tribal belt) and the North-East."

**Do:** change "Shade districts by" to *Child anaemia*, then to *Institutional births*.
> "Any single measure can be mapped the same way. Faded districts are low-confidence survey estimates; grey means no estimate."

**Do:** scroll to the leaderboard.
> "The 25 most underserved districts, coloured by their main burden: West Karbi Anglong, Bastar, Jamui, Sukma…"

**Do:** scroll to the burden-vs-supply scatter.
> "Every bubble is a district, and its size is the number of facilities offering the matching service. The shaded corner is **high burden, low supply**: that's the priority list."

## 4. District drill-down: what's on the ground? (1 min)

**Do:** tap a red district on the map, or pick *Tirunelveli* in the District drill-down tab.

> "Click into a district and you see:
> - **every facility we know of** on the map, highlighted by service, sized by beds;
> - its **burden profile** against the national median (outer means worse);
> - **need versus supply** for each service: a red bar far above the blue bar is a gap."

## 5. Distance to care: can people reach it? (40 s)

**Do:** Distance to care tab.

> "Counting facilities isn't enough; distance often decides whether people get care. This is the average straight-line distance from each post office to the nearest facility. Hill and tribal districts stand out.
> The bubble chart shows the **double disadvantage**: far from care *and* high burden. Small bubbles in the top-right corner are the worst case."

## 6. Compare and close (30 s)

**Do:** Compare tab, briefly: the state strip plot, then the data-quality bars.

> "Compare districts within each state, and see how much of each state's facility location data we could confirm.
> **Next steps:** Census household counts for true per-person rates, adding government facility lists, and fixing the Gujarat coordinates with a boundary check."

---

## Likely questions: short answers

| Question | Answer |
|---|---|
| **How is the underserved score calculated?** | "The average of four burden percentiles (anaemia, substance use, non-vaccination, home births) minus the supply percentile. It runs from −1 to +1 and ranks districts against each other, so it's not an absolute measure." |
| **Why does a district show 0 facilities?** | "None are *in our records*. The data is web-mined private providers, so government PHCs and CHCs are largely missing. Those districts still average about 82% institutional births." |
| **Are the per-10k numbers real rates?** | "No. They divide by the ~900 households NFHS *surveyed*, not real households. Use them for comparison only. Census household counts are the fix." |
| **Where do bed numbers come from?** | "Self-reported by about 28% of facilities. We removed one record claiming 200,000 beds. Zero can mean no bed data." |
| **Why do some Gujarat distances show ~300 km?** | "Hundreds of Gujarat post offices have coordinates stamped in the Arabian Sea. We traced it, and the fix is a boundary check." |
| **How were districts matched to the map?** | "Every boundary is linked to its NFHS-5 district by a unique state + district key, not by name alone: seven district names repeat across states." |
| **Why do some districts show another district's figures?** | "Districts split after the survey, such as Tenkasi from Tirunelveli, show their parent's NFHS-5 numbers. The hover text says so." |
| **How current is this?** | "NFHS-5 was surveyed in 2019–21, so it's historical context, not live conditions." |
