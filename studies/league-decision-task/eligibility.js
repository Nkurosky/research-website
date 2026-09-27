(() => {
  'use strict';

  // Keep this key stable across releases so screen-outs cannot retry after an update.
  const BLOCK_KEY = 'league-study-eligibility-blocked';
  const POLICY_VERSION = '2026-09-27-adult-us-ca-residence';
  const scriptUrl = document.currentScript.dataset.experimentSrc;
  const target = document.getElementById('jspsych-target');
  let admitted = false;
  let blockedInMemory = false;

  function isBlocked() {
    if (blockedInMemory) return true;
    try {
      if (window.localStorage.getItem(BLOCK_KEY) !== null) return true;
    } catch (_) { /* The first-party cookie also preserves the block. */ }
    return document.cookie.split(';').some((part) => part.trim().startsWith(`${BLOCK_KEY}=`));
  }

  function rememberBlock() {
    blockedInMemory = true;
    try {
      window.localStorage.setItem(BLOCK_KEY, '1');
    } catch (_) { /* Still end the session if browser storage is unavailable. */ }
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${BLOCK_KEY}=1; Path=/; Max-Age=34560000; SameSite=Lax${secure}`;
  }

  function showBlocked() {
    admitted = false;
    target.innerHTML = '<main class="screen-wrap" tabindex="-1">' +
      '<h1>Not eligible to participate</h1>' +
      '<p>Based on your responses, you are not eligible for this study. This session has ended.</p>' +
      '<p>Please do not restart the study. You may close this page.</p></main>';
    target.querySelector('main').focus();
  }

  function recheckBlock() {
    if (!isBlocked()) return;
    if (admitted) {
      // Stop timers and pending interactions in a study already open in another tab.
      admitted = false;
      window.location.reload();
    } else {
      showBlocked();
    }
  }

  window.LeagueEligibility = Object.freeze({
    canParticipate: () => admitted && !isBlocked()
  });
  window.addEventListener('storage', recheckBlock);
  window.addEventListener('pageshow', recheckBlock);
  window.addEventListener('focus', recheckBlock);
  document.addEventListener('visibilitychange', recheckBlock);

  if (isBlocked()) {
    showBlocked();
    return;
  }

  target.innerHTML = `
    <main class="screen-wrap eligibility-screen">
      <h1>Study eligibility</h1>
      <form id="eligibility-form">
        <fieldset>
          <legend>Are you 18 years of age or older?</legend>
          <label><input type="radio" name="age" value="adult" required> Yes</label>
          <label><input type="radio" name="age" value="under18" required> No</label>
        </fieldset>
        <fieldset>
          <legend>What is your current country of residence?</legend>
          <label><input type="radio" name="residence" value="US" required> United States</label>
          <label><input type="radio" name="residence" value="CA" required> Canada</label>
          <label><input type="radio" name="residence" value="other" required> Another country</label>
        </fieldset>
        <button class="jspsych-btn" type="submit">Continue</button>
      </form>
    </main>`;

  target.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (isBlocked()) {
      showBlocked();
      return;
    }
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const answers = new FormData(form);
    const age = answers.get('age');
    const residence = answers.get('residence');
    if (age !== 'adult' || !['US', 'CA'].includes(residence)) {
      rememberBlock();
      showBlocked();
      return;
    }

    window.LEAGUE_STUDY_ELIGIBILITY = Object.freeze({
      eligibility_age_18_or_older: true,
      eligibility_country_of_residence: residence,
      eligibility_policy_version: POLICY_VERSION,
      eligibility_screened_at: new Date().toISOString()
    });
    admitted = true;
    target.innerHTML = '<main class="screen-wrap"><h1>Loading study...</h1></main>';
    const experiment = document.createElement('script');
    experiment.src = scriptUrl;
    experiment.onerror = () => {
      admitted = false;
      target.innerHTML = '<main class="screen-wrap"><h1>Study could not load</h1>' +
        '<p>Please refresh this page to try again.</p></main>';
    };
    document.body.appendChild(experiment);
  });
})();
