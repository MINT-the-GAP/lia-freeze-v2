<!--
author: MINT-the-GAP
version: 1.0.0
language: en
comment: Browser regression fixture for the explicit Exam fullscreen boundary.

script: ../../dist/index.js

@Exam
<div class="lia-exam-macro-anchor" data-lia-exam-duration="@0" style="display:none;"></div>
@end

@Abgabe
<div class="lia-submit-box">
  <label for="lia-name">Name</label>
  <input id="lia-name" data-snapshot-admin="1" type="text">
  <button id="lia-create-link" data-snapshot-admin="1" type="button">Create Link</button>
  <button id="lia-copy-link" data-snapshot-admin="1" type="button">Copy Link</button>
  <textarea id="lia-link" data-snapshot-admin="1" readonly></textarea>
  <div id="lia-status"></div>
  <div id="lia-frozen-note"></div>
</div>
@end

@Auswertung
<div data-snapshot-eval="1" style="display:none;"></div>
@end
-->

# Exam intro

@Exam(5)

## Work

Enter the word **ready**.

[[ready]]

## Submit

@Abgabe

@Auswertung(Tab)
