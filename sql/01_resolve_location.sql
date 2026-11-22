-- resolve_location: place name / district, 6-digit PIN, or "lat,lon" -> candidate points.
-- Returns up to 5 rows, best first. More than one row = ambiguous place: the app asks the user to pick.
-- Point = median of trusted facility coordinates (location_trust solid / pin-corrected).
CREATE OR REPLACE FUNCTION workspace.virtue_finder.resolve_location(q STRING)
RETURNS TABLE (lat DOUBLE, lon DOUBLE, label STRING, confidence STRING, n_facilities BIGINT)
COMMENT 'Turns a village/city/district, 6-digit PIN or "lat,lon" into a point. Several rows means the place name is ambiguous.'
RETURN
  WITH parsed AS (
    SELECT
      CASE WHEN resolve_location.q RLIKE '^\\s*-?[0-9]+(\\.[0-9]+)?\\s*,\\s*-?[0-9]+(\\.[0-9]+)?\\s*$'
           THEN CAST(trim(split(resolve_location.q, ',')[0]) AS DOUBLE) END AS in_lat,
      CASE WHEN resolve_location.q RLIKE '^\\s*-?[0-9]+(\\.[0-9]+)?\\s*,\\s*-?[0-9]+(\\.[0-9]+)?\\s*$'
           THEN CAST(trim(split(resolve_location.q, ',')[1]) AS DOUBLE) END AS in_lon,
      CASE WHEN trim(resolve_location.q) RLIKE '^[0-9]{6}$' THEN trim(resolve_location.q) END AS pin,
      lower(regexp_replace(trim(resolve_location.q), '\\s+', ' ')) AS place
  ),
  trusted AS (
    SELECT lower(trim(t.city)) AS city, lower(trim(t.city_district)) AS district,
           t.state_final_display AS state, t.pincode,
           t.latitude_final AS latitude, t.longitude_final AS longitude
    FROM workspace.virtue_finder.facility_location_trust t
    WHERE t.location_trust IN ('solid', 'pin-corrected')
      AND t.latitude_final BETWEEN 6 AND 37 AND t.longitude_final BETWEEN 68 AND 98
  ),
  coords AS (
    SELECT in_lat AS lat, in_lon AS lon, concat(round(in_lat, 4), ', ', round(in_lon, 4)) AS label,
           'exact' AS confidence, CAST(NULL AS BIGINT) AS n_facilities, 0 AS prio
    FROM parsed
    WHERE in_lat BETWEEN 6 AND 37 AND in_lon BETWEEN 68 AND 98
  ),
  by_pin AS (
    SELECT percentile(t.latitude, 0.5) AS lat, percentile(t.longitude, 0.5) AS lon,
           concat('PIN ', p.pin, ' (', initcap(first(t.city)), ')') AS label,
           CASE WHEN count(*) >= 3 THEN 'high' ELSE 'medium' END AS confidence,
           count(*) AS n_facilities, 1 AS prio
    FROM trusted t JOIN parsed p ON t.pincode = p.pin
    GROUP BY p.pin
  ),
  by_city AS (
    SELECT percentile(t.latitude, 0.5) AS lat, percentile(t.longitude, 0.5) AS lon,
           concat(initcap(t.city), ', ', t.state) AS label,
           CASE WHEN count(*) >= 3 THEN 'medium' ELSE 'low' END AS confidence,
           count(*) AS n_facilities, 2 AS prio
    FROM trusted t JOIN parsed p ON p.pin IS NULL AND p.in_lat IS NULL AND t.city = p.place
    GROUP BY t.city, t.state
  ),
  by_district AS (
    SELECT percentile(t.latitude, 0.5) AS lat, percentile(t.longitude, 0.5) AS lon,
           concat(initcap(t.district), ' district, ', t.state) AS label,
           'low' AS confidence, count(*) AS n_facilities, 3 AS prio
    FROM trusted t JOIN parsed p ON p.pin IS NULL AND p.in_lat IS NULL AND t.district = p.place
    WHERE NOT EXISTS (SELECT 1 FROM trusted t2 JOIN parsed p2 ON t2.city = p2.place)
    GROUP BY t.district, t.state
  ),
  allrows AS (
    SELECT * FROM coords UNION ALL SELECT * FROM by_pin
    UNION ALL SELECT * FROM by_city UNION ALL SELECT * FROM by_district
  )
  SELECT lat, lon, label, confidence, n_facilities
  FROM allrows
  ORDER BY prio, n_facilities DESC NULLS FIRST, label
  LIMIT 5;
