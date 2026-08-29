# Composite performance retirement

## Decision

CAFA PMIS does not publish organisation, State, or Project composite performance
scores. The former six-component weighted model, score tiers, rankings, and
Dashboard API routes are unsupported business logic and are retired.

Manager-facing Dashboard behavior is limited to:

- factual State implementation counts and nullable percentages from
  `/dashboard/state-performance`;
- factual operational follow-up conditions;
- the approved equal-weight Indicator → Project → Sector achievement hierarchy
  from `/dashboard/hierarchical-performance`.

The hierarchy preserves unavailable data as `null`, preserves achievement above
100%, and evaluates the complete authorised Project population without a result
limit. It does not introduce component weights or score tiers.

## Contract

The canonical OpenAPI specification contains the 17 live Dashboard GET
endpoints. It excludes:

- `/dashboard/performance`
- `/dashboard/performance/states`
- `/dashboard/performance/projects`

`StatePerformance` mirrors the factual runtime response exactly. Activity
completion and reporting compliance remain nullable when their denominators are
zero. State budget utilisation remains `null` because there is no approved
State-level expenditure source.

## Compatibility

Historical audit notes that describe composite score behavior are evidence of
the retired model, not an active contract. New code must not restore those
functions, routes, generated types, cache keys, translations, or visible copy.