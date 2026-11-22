-- recommend_facilities: deterministic ranking of facilities for a service near a point.
-- Same inputs -> same rows in the same order (ties broken by distance, then unique_id).
--
-- Service matching (via v2_concept_lookup / node_stats), normalised to a-z0-9:
--   exact    (1.0): a concept term, label or key equals the query
--   related  (0.6): a concept key contains the query or vice versa (query >= 5 chars)
--   broadened(0.4): ONLY when no exact/related evidence lies within the radius:
--                   other concepts in the same category (plus emergency/ICU when urgent)
-- Evidence tier (per quote):
--   Strong   : free-text column (capability/procedure/description/equipment), the quote names the service,
--              it is quantified (numbers / 24x7 / beds), and no other facility is named
--   Moderate : as Strong but not quantified
--   Weak     : specialty-list entry only, quote doesn't name the service, names another facility,
--              or reads like a course / seat-intake list (training, not a service)
-- min_beds: optional hard filter on listed bed count (records without a bed count are excluded when > 0)
-- rare: the searched service is mentioned by fewer than 50 facilities nationally (node_stats)
-- Location trust: solid 1.0 | pin-corrected 0.6 | coords-only 0.5 | ambiguous 0.3 | pin-suspect 0.2
-- Weights (urgent / not urgent): match .45/.35, evidence .20/.15, distance .15/.35, size .10/.05, location .10/.10
CREATE OR REPLACE FUNCTION workspace.virtue_finder.recommend_facilities(
  service STRING, lat DOUBLE, lon DOUBLE,
  urgent BOOLEAN DEFAULT false, radius_km DOUBLE DEFAULT 60, top_n INT DEFAULT 10,
  min_beds DOUBLE DEFAULT 0)
RETURNS TABLE (
  rank INT, unique_id STRING, name STRING, facility_type STRING, operator STRING,
  phone STRING, latitude DOUBLE, longitude DOUBLE, distance_km DOUBLE,
  tier STRING, best_quote STRING, quote_source STRING, matched_concept STRING,
  broadened BOOLEAN, rare BOOLEAN, location_confidence STRING,
  s_match DOUBLE, s_evidence DOUBLE, s_distance DOUBLE, s_size DOUBLE, s_location DOUBLE,
  score DOUBLE, beds DOUBLE)
COMMENT 'Deterministic facility ranking for a service near a point. Use this for every recommendation question. broadened=true means no nearby record mentions the exact service. min_beds > 0 keeps only facilities whose records list at least that many beds (unknown bed counts are excluded).'
RETURN
  WITH q AS (
    SELECT regexp_replace(lower(recommend_facilities.service), '[^a-z0-9]', '') AS qn,
           TRIM(TRAILING 's' FROM regexp_replace(lower(recommend_facilities.service), '[^a-z0-9]', '')) AS qs
  ),
  cat_rx AS (                -- synonyms from service_catalog (e.g. c-section -> caesarean)
    SELECT c.text_regex AS rx
    FROM workspace.virtue_finder.service_catalog c
    WHERE lower(recommend_facilities.service) RLIKE c.text_regex
       OR regexp_replace(lower(c.service_key), '[^a-z0-9]', '') = (SELECT qn FROM q)
       OR regexp_replace(lower(c.service_label), '[^a-z0-9]', '') = (SELECT qn FROM q)
  ),
  concept AS (               -- matched ontology nodes with match strength
    SELECT node_key, max(m) AS m FROM (
      SELECT l.node_key,
             CASE WHEN regexp_replace(lower(l.term_text), '[^a-z0-9]', '') IN (q.qn, q.qs)
                    OR l.node_key IN (q.qn, q.qs) THEN 1.0
                  ELSE 0.6 END AS m
      FROM workspace.virtue_finder.v2_concept_lookup l CROSS JOIN q
      WHERE length(q.qn) >= 2 AND (
            regexp_replace(lower(l.term_text), '[^a-z0-9]', '') IN (q.qn, q.qs)
         OR l.node_key IN (q.qn, q.qs)
         OR (length(q.qs) >= 5 AND (l.node_key LIKE concat('%', q.qs, '%')
                                 OR (length(l.node_key) >= 5 AND q.qn LIKE concat('%', l.node_key, '%')))))
      UNION ALL
      SELECT l.node_key, 1.0 AS m
      FROM workspace.virtue_finder.v2_concept_lookup l JOIN cat_rx r ON lower(l.term_text) RLIKE r.rx
    ) GROUP BY node_key
  ),
  q_rare AS (                -- the searched service is rare if few facilities nationally mention it
    SELECT coalesce(sum(n_facilities), 0) BETWEEN 1 AND 49 AS is_rare
    FROM (SELECT node_key, max(n_facilities) AS n_facilities
          FROM workspace.virtue_finder.node_stats
          WHERE node_type = 'concept' AND node_key IN (SELECT node_key FROM concept) GROUP BY node_key)
  ),
  cats AS (                  -- categories for the broadened fallback (own category preferred)
    SELECT category_key, min(prio) AS prio FROM (
      SELECT DISTINCT l.category_key, 1 AS prio
      FROM workspace.virtue_finder.v2_concept_lookup l JOIN concept c USING (node_key)
      UNION ALL SELECT 'emergencyandtrauma', 2 WHERE recommend_facilities.urgent
      UNION ALL SELECT 'criticalcareandicu', 3 WHERE recommend_facilities.urgent
    ) GROUP BY category_key
  ),
  geo AS (
    SELECT p.unique_id, p.name, p.capacity_beds, p.capacity_beds AS n_beds, p.number_doctors,
           coalesce(p.officialPhone, p.phone_numbers[0]) AS phone,
           t.latitude_final AS latitude, t.longitude_final AS longitude,
           coalesce(t.location_trust, 'coords-only') AS location_trust,
           2 * 6371 * asin(sqrt(
             pow(sin(radians(t.latitude_final - recommend_facilities.lat) / 2), 2) +
             cos(radians(recommend_facilities.lat)) * cos(radians(t.latitude_final)) *
             pow(sin(radians(t.longitude_final - recommend_facilities.lon) / 2), 2))) AS distance_km
    FROM workspace.virtue_finder.facility_profile p
    JOIN workspace.virtue_finder.facility_location_trust t USING (unique_id)
    WHERE t.latitude_final IS NOT NULL AND t.longitude_final IS NOT NULL
  ),
  near AS (SELECT * FROM geo WHERE distance_km <= recommend_facilities.radius_km
                AND (coalesce(recommend_facilities.min_beds, 0) <= 0
                     OR n_beds >= recommend_facilities.min_beds)),
  ev AS (
    SELECT x.*,
           CASE WHEN x.free_text AND x.names_service AND x.is_quantified THEN 'Strong'
                WHEN x.free_text AND x.names_service THEN 'Moderate'
                ELSE 'Weak' END AS tier
    FROM (
      SELECT e.unique_id, e.ontology_node, e.node_label, e.category_key, e.src_col, e.evidence_text,
             coalesce(e.is_quantified, false) AS is_quantified,
             e.src_col <> 'specialties' AND NOT coalesce(e.mentions_other_facility, false)
               -- course / seat-intake lists describe training, not services offered
               AND NOT lower(e.evidence_text) RLIKE '\\b(courses?|intake|diploma|seats|curriculum|syllabus|admissions?)\\b' AS free_text,
             -- the quote itself must name the service (guards against loose LLM matches)
             instr(regexp_replace(lower(e.evidence_text), '[^a-z0-9]', ''),
                   CASE WHEN length(split(lower(e.node_label), ' ')[0]) >= 4
                        THEN regexp_replace(split(lower(e.node_label), ' ')[0], '[^a-z0-9]', '')
                        ELSE e.ontology_node END) > 0
             OR (length((SELECT qs FROM q)) >= 4
                 AND instr(regexp_replace(lower(e.evidence_text), '[^a-z0-9]', ''), (SELECT qs FROM q)) > 0)
             OR (rxa.rx_all <> '' AND lower(e.evidence_text) RLIKE rxa.rx_all) AS names_service
      FROM workspace.virtue_finder.facility_service_evidence_v2 e
      CROSS JOIN (SELECT coalesce(concat_ws('|', collect_list(concat('(', rx, ')'))), '') AS rx_all FROM cat_rx) rxa
      WHERE e.unique_id IN (SELECT unique_id FROM near)
    ) x
  ),
  exact_ev AS (
    SELECT ev.*, c.m, false AS broadened FROM ev JOIN concept c ON ev.ontology_node = c.node_key
  ),
  fallback_ev AS (
    SELECT ev.*, 0.4 - 0.01 * cats.prio AS m, true AS broadened   -- prio only orders quotes; scored as 0.4 below
    FROM ev JOIN cats ON ev.category_key = cats.category_key
    WHERE NOT EXISTS (SELECT 1 FROM exact_ev)
  ),
  candidates AS (SELECT * FROM exact_ev UNION ALL SELECT * FROM fallback_ev),
  best AS (                  -- one row per facility: its best quote
    SELECT * FROM candidates
    QUALIFY row_number() OVER (
      PARTITION BY unique_id
      ORDER BY m DESC,
               CASE tier WHEN 'Strong' THEN 1 WHEN 'Moderate' THEN 2 ELSE 3 END,
               length(evidence_text), evidence_text) = 1
  ),
  scored AS (
    SELECT n.*, b.tier, b.evidence_text, b.src_col, b.node_label, b.ontology_node, b.broadened,
      CASE WHEN b.broadened THEN 0.4 ELSE b.m END AS c_match,
      CASE b.tier WHEN 'Strong' THEN 1.0 WHEN 'Moderate' THEN 0.6 ELSE 0.3 END AS c_ev,
      greatest(0.0, 1 - n.distance_km / recommend_facilities.radius_km) AS c_dist,
      least(1.0,
        CASE WHEN lower(n.name) RLIKE 'hospital|medical college' THEN 0.3 ELSE 0.15 END
        + 0.5 * least(coalesce(n.capacity_beds, 0), 500) / 500
        + 0.2 * least(coalesce(n.number_doctors, 0), 50) / 50) AS c_size,
      CASE n.location_trust WHEN 'solid' THEN 1.0 WHEN 'pin-corrected' THEN 0.6
           WHEN 'coords-only' THEN 0.5 WHEN 'ambiguous' THEN 0.3 ELSE 0.2 END AS c_loc
    FROM best b JOIN near n USING (unique_id)
  ),
  weighted AS (
    SELECT *,
      round(c_match * IF(recommend_facilities.urgent, 0.45, 0.35), 3) AS w_match,
      round(c_ev    * IF(recommend_facilities.urgent, 0.20, 0.15), 3) AS w_ev,
      round(c_dist  * IF(recommend_facilities.urgent, 0.15, 0.35), 3) AS w_dist,
      round(c_size  * IF(recommend_facilities.urgent, 0.10, 0.05), 3) AS w_size,
      round(c_loc   * 0.10, 3)                                        AS w_loc
    FROM scored
  ),
  ranked AS (
    SELECT w.*,
      CAST(row_number() OVER (ORDER BY w_match + w_ev + w_dist + w_size + w_loc DESC,
                                       distance_km, unique_id) AS INT) AS rnk
    FROM weighted w
  )
  SELECT
    r.rnk AS rank, r.unique_id, r.name,
    CASE WHEN lower(r.name) RLIKE 'medical college' THEN 'Medical college'
         WHEN lower(r.name) RLIKE 'hospital' THEN 'Hospital'
         WHEN lower(r.name) RLIKE 'clinic|centre|center|nursing home' THEN 'Clinic / centre'
         ELSE 'Facility' END AS facility_type,
    CASE WHEN lower(r.name) RLIKE '^(govt|government)|\\bgovt\\b|government|primary health|community health|\\bphc\\b|\\bchc\\b|district hospital|taluk|sub.?divisional|esi'
         THEN 'Government (from name)' ELSE 'Private / unknown' END AS operator,
    r.phone, r.latitude, r.longitude, round(r.distance_km, 1) AS distance_km,
    r.tier, r.evidence_text AS best_quote, r.src_col AS quote_source, r.node_label AS matched_concept,
    r.broadened,
    (SELECT is_rare FROM q_rare) AS rare,
    CASE r.location_trust WHEN 'solid' THEN 'high'
         WHEN 'pin-corrected' THEN 'medium' WHEN 'coords-only' THEN 'medium' ELSE 'low' END AS location_confidence,
    r.w_match AS s_match, r.w_ev AS s_evidence, r.w_dist AS s_distance, r.w_size AS s_size, r.w_loc AS s_location,
    round(r.w_match + r.w_ev + r.w_dist + r.w_size + r.w_loc, 3) AS score,
    r.capacity_beds AS beds
  FROM ranked r
  WHERE r.rnk <= recommend_facilities.top_n
  ORDER BY r.rnk;
