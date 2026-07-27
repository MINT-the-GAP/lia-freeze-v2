<!--
author: MINT-the-GAP; Martin Lommatzsch; Jihad Hyadi
version: 1.0.0
language: de
comment: Branch-isolierter Freeze-Harness für lokale E2E-Tests.

script: ../../dist/index.js

@Abgabe
<div class="lia-submit-box">
  <h2>Create Submission Link</h2>
  <label for="lia-name">Name</label>
  <input id="lia-name" data-snapshot-admin="1" type="text" placeholder="Enter your name">
  <div class="lia-submit-actions">
    <button id="lia-create-link" data-snapshot-admin="1" type="button">Create Link</button>
    <button id="lia-copy-link" data-snapshot-admin="1" type="button" disabled>Copy Link</button>
  </div>
  <label for="lia-link">Submission Link</label>
  <textarea id="lia-link" data-snapshot-admin="1" readonly placeholder="Your link will appear here"></textarea>
  <div id="lia-status"></div>
  <div id="lia-frozen-note" class="lia-frozen-note"></div>
</div>
@end

@Auswertung
<div data-snapshot-eval="1" style="display:none;"></div>
@end

@ADetails
<span class="lia-assignment-details" data-adetails="@0" style="display:none !important;"></span>
@end
-->

# Freeze E2E Harness
