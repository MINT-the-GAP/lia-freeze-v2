<!--
author:   MINT-the-GAP
version:  1.0.0
language: en
narrator: US English Female
edit: true
comment:  LiaScript submission link with exact state logging and freeze functionality.

import: https://cdn.jsdelivr.net/gh/LiaTemplates/JSXGraph@main/README.md

script:   ./dist/index.js

import: https://raw.githubusercontent.com/MINT-the-GAP/lia-canvas-ocr/main/README.md
import: https://raw.githubusercontent.com/MINT-the-GAP/lia-coordinate/main/README.md
import: https://raw.githubusercontent.com/MINT-the-GAP/lia-Mathe/main/README.md
import: https://raw.githubusercontent.com/MINT-the-GAP/lia-orthography/main/README.md
import: https://raw.githubusercontent.com/MINT-the-GAP/lia-marker/main/README.md

@Abgabe
<div class="lia-submit-box">
  <h2>Create Submission Link</h2>

  <label for="lia-name">Name</label>
  <input id="lia-name" data-snapshot-admin="1" type="text" placeholder="Enter your name">

  <div class="lia-submit-actions">
    <button
      id="lia-create-link"
      data-snapshot-admin="1"
      type="button"
      onclick="window.__liaFreeze && window.__liaFreeze.createLink(); return false;"
    >Create Link</button>

    <button
      id="lia-copy-link"
      data-snapshot-admin="1"
      type="button"
      disabled
      onclick="window.__liaFreeze && window.__liaFreeze.copyLink(); return false;"
    >Copy Link</button>
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

# LiaScript Freeze Plugin

A LiaScript plugin that lets students freeze their quiz state into a shareable link.
The teacher opens the link and sees exactly what the student answered, with the page locked.

---

## How it works

1. The student works through the course and answers quizzes
2. On the submission slide, they click **Create Link**
3. The plugin encodes all quiz answers into the URL as a compressed token
4. The teacher opens the link — answers are restored and the page is locked for review

---

## Quick start

Add this import to the header of your LiaScript document:

``` markdown
import: https://raw.githubusercontent.com/MINT-the-GAP/lia-freeze-v2/main/README.md
```

Then use the macros in your course.

> **Note:** The course version must be at least 1 (`version: 1.0.0`). LiaScript only persists quiz state to IndexedDB for versioned courses — without it, the freeze snapshot will be empty.

---

## Macros

### `@Abgabe` — Submission slide

Place this on the final slide of your course. It renders the name field and link creation buttons.

``` markdown
## Submit your work

@Abgabe
```

---

### `@Auswertung` — Evaluation slide

Place this at the end of your course. When the teacher opens the freeze link, this slide
is rendered with all quiz answers scored automatically.

Optionally track cheating attempts:

``` markdown
@Auswertung
```

``` markdown
@Auswertung(F12)
```

``` markdown
@Auswertung(Tab)
```

``` markdown
@Auswertung(F12;Tab)
```

``` markdown
@Auswertung(F12;Tab;Time)
```

- `F12` — flags if the student opened browser DevTools
- `Tab` — flags if the student switched to another tab or window
- `Time` — records how many minutes the student spent on each slide; shown on the evaluation slide

---

### `@ADetails` — Task scoring metadata

Place this after a quiz block to assign point values and topic tags.
Used by `@Auswertung` to compute the total score.

``` markdown
[[answer]]

@ADetails(2)
```

``` markdown
[[answer]]

@ADetails(2;Grammar,Spelling)
```

- First argument: point value (default: 1)
- Optional second argument: comma-separated topic tags

---

## Full example course

``` markdown
<!--
import: https://raw.githubusercontent.com/MINT-the-GAP/lia-freeze-v2/main/README.md
-->

# English Quiz

## Task 1 — Fill in the blanks

Complete the sentences.

The capital of France is [[Paris]].

@ADetails(1;Geography)

The opposite of hot is [[cold]].

@ADetails(1;Vocabulary)

## Task 2 — Multiple choice

Which of the following are planets?

    [[ ]] Sun
    [[X]] Earth
    [[X]] Mars
    [[ ]] Moon

@ADetails(2;Astronomy)

## Task 3 — Free text

Describe the water cycle in your own words.

[[___ ___]]

@ADetails(3;Science)

## Submit

@Abgabe

@Auswertung(F12;Tab;Time)
```

---

## Test slide

The slides below let you test the plugin locally using `./dist/index.js`.

## Quiz 1 — Fill in the blanks

The capital of Germany is [[Berlin]].

@ADetails(1;Geography)

The largest planet is [[Jupiter]].

@ADetails(1;Astronomy)

## Quiz 2 — Multiple choice

Which are primary colors?

    [[ ]] Green
    [[X]] Red
    [[X]] Blue
    [[X]] Yellow

@ADetails(2;Art)

## Quiz 3 — Single choice

What is 2 + 2?

    [( )] 3
    [(X)] 4
    [( )] 5

@ADetails(1;Math)

## Quiz 4 — Free text

Describe what a plugin does in one sentence.

[[___ ___]]

@ADetails(0;Comprehension)

## Quiz 5 — OCR

2 + 1 = [[ 3 ]] @canvas

@ADetails(1=BE;OCR)

## Quiz 6 — Coordinates

@CoordinateSystem(`xmin=-7;xmax=7;ymin=-5;ymax=5;width=800;id=A1`)

@AxisLabel(`id=A1;xlabel=$x$;ylabel=$y$`)

**Mark the point (1, 4) on the coordinate system.**

@CreatePoint(`A1;A;1;4`,`<!--  -->`)

@ADetails(BE=1;Coordinates)

## Quiz 7 — Fractions

Mark the fraction $\dfrac{2}{5}$ on the circle.

@circleQuiz(2/5)

@ADetails(1=BE;CircleQuiz)

## Quiz 8 — Orthography

Correct the spelling mistakes in the following sentence.

@orthography(2,`The apel is red`,`The apple is red.`)

@ADetails(1=BE;Orthography)

## Quiz 9 — Marking

Mark the text in red.

<div class="markerquiz">
@markred(RED)
@TextmarkerQuiz
</div>

@ADetails(1=BE;Marker)

## Submit

@Abgabe

@Auswertung(F12;Tab;Time)
