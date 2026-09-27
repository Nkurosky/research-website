# Eligibility screening

The entry page requires participants to confirm they are at least 18 and
currently reside in the United States or Canada. Both questions are required.
The experiment script is loaded only after passing. Screened-out visitors do
not start jsPsych, create a study CSV, or upload their screening responses.

A screen-out writes only a block flag (no age or country) to localStorage and
a first-party cookie named `league-study-eligibility-blocked`. The localStorage
flag has no automatic expiry. The fallback cookie lasts up to 400 days, subject
to browser retention policies. Refreshes, new visits, and other tabs on the
same origin remain blocked while either flag exists. Do not change this key
as part of routine releases.

This is a browser-level deterrent based on self-report, not identity or age
verification. Clearing all site data, a new private session, another browser,
or another device can bypass it. The collector does not independently enforce
eligibility. No IP addresses or device fingerprints are used for this block.

Eligible participants are screened on each page load. Four columns are appended
to exported trial rows, including partial rows:

- `eligibility_age_18_or_older`
- `eligibility_country_of_residence` (`US` or `CA`)
- `eligibility_policy_version`
- `eligibility_screened_at` (UTC timestamp)

Historical rows without these fields remain blank; they are not retroactively
classified as eligible. The existing CSV columns retain their positions.

## Required Riot ID

After eligibility screening, the pre-experiment survey requires a Riot ID in
`Username#Tag` format (for example, `Lokidosi#IUB`). Both parts must be nonempty,
with exactly one `#` and no whitespace in the tag. Surrounding whitespace is
trimmed. This checks format only, not account existence or ownership. The
optional OP.GG link remains separate. The ID is included in the private study
export as the appended `survey_riot_id` column; older records remain blank.

## Testing

Run `node scripts/test-league-eligibility.cjs` from the website repository with
Playwright available to Node and Chrome installed. An optional first argument
specifies the local experiment directory to test the second copy too.
The test intercepts all collector traffic; it never creates production records.
Screenshots are written to the ignored `.wrangler/eligibility-qa` directory.

For manual testing, use a separate browser profile. Test every age/country
combination, missing answers, reloads, closing/reopening, and multiple tabs.
If a researcher needs to reset their own test profile, remove this specific
localStorage key and cookie in browser developer tools. Do not clear other
study storage or participant data. There is no participant-facing reset button.

Deploy `index.html`, `eligibility.js`, and `experiment.js` together. Open the
published page in a fresh browser profile to verify the new entry screen.
Already open pages running an older release are not retroactively screened;
they must reload. The script query strings are versioned for fresh visits.
