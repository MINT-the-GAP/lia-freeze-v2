<!--
author:   MINT-the-GAP, Martin Lommatzsch, Jihad Hyadi
version:  1.0.0
language: en
narrator: US English Female
edit: true
comment:  LiaScript submission link with exact state logging and freeze functionality.

import: https://cdn.jsdelivr.net/gh/LiaTemplates/JSXGraph@main/README.md

script:   ./dist/index.js


import: https://raw.githubusercontent.com/MINT-the-GAP/lia-DynFlex/refs/heads/main/README.md
import: https://raw.githubusercontent.com/MINT-the-GAP/lia-annotation/main/README.md
import: https://raw.githubusercontent.com/MINT-the-GAP/lia-canvas-ocr/main/README.md
import: https://raw.githubusercontent.com/MINT-the-GAP/lia-coordinate/Proposal/README.md
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

    <button
      id="lia-print-pdf"
      data-snapshot-admin="1"
      type="button"
      title="Open the print dialog and choose Save as PDF"
      hidden
      disabled
    >Save course and evaluation as PDF</button>
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

@Exam
<div class="lia-exam-macro-anchor" data-lia-exam-duration="@0" style="display:none;"></div>
@end

-->

# LiaScript Freeze Plugin

A LiaScript plugin that lets students freeze their quiz state into a shareable link.
The teacher opens the link and sees exactly what the student answered, with the page locked.

**Try it on LiaScript:** https://liascript.github.io/course/?https://raw.githubusercontent.com/MINT-the-GAP/lia-freeze-v2/main/README.md

---

## How it works

1. The student works through the course and answers quizzes
2. On the submission slide, they click **Create Link**
3. The plugin encodes all quiz answers into the URL as a compressed token
4. The teacher opens the link — answers are restored and the page is locked for review
5. After freezing, **Save evaluation as PDF** opens a print-ready report with
   student name, submission date, course title and the frozen course version

---

## Quick start

Add this import to the header of your LiaScript document:

`import: https://raw.githubusercontent.com/MINT-the-GAP/lia-freeze-v2/main/README.md`

Then use the macros in your course.


## Macros

### `@Abgabe` — Submission slide

Place this on the final slide of your course. It renders the name field and link creation buttons.

``` markdown
## Submit your work

@Abgabe
```

The PDF button appears only after a Freeze link has been created. It opens the
browser print dialog; select **Save as PDF** there. The same print button is
available in the navigation bar of an opened Freeze link. This decentralized
report contains the complete evaluation, including current teacher corrections.
Before opening the browser print dialog, the plugin visits and renders every
course slide, converts Canvas content to printable images, and appends the
evaluation as the final page.

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

``` markdown
@Auswertung(F12;Tab;Time;Send)
```

- `F12` — records trusted DevTools-related shortcut candidates and stable,
  calibrated viewport anomalies. Chrome, Edge and Brave use the Chromium
  shortcut set; Firefox and Safari use their own documented macOS/desktop
  shortcuts. The evaluation keeps shortcut, viewport and combined signals
  separate. These are technical indicators, not proof that DevTools were
  opened, and they never change quiz points. Opening tools through a menu or
  context menu, undocked tools and remote inspection cannot be detected
  reliably by a normal course page.
- `Tab` — flags if the student switched to another tab or window. A confirmed,
  intended `@Explain` overlay from an authored lia-mathpath integration is
  narrowly excluded; a real hidden tab is always recorded. The evaluation
  presents these as technical focus/visibility signals, not proof of misconduct.
- `Time` — records how many minutes the student spent on each slide; shown on the evaluation slide
- `Send` — turns every native **Check** action into a neutral submission while
  the course is still live. Inputs continue to be recorded, but correctness
  feedback and the solution control stay hidden. Creating the Freeze link then
  checks the recorded quiz tasks behind a blocking submission screen. Only the
  frozen course and the opened Freeze link show the resulting feedback. The
  native solution control is available there without changing the score stored
  in the Freeze payload. Every learner click on **Check** is counted per task
  and stored in the Freeze link. The evaluation shows these counts, including
  zero for untouched tasks; input changes, automatic Freeze grading and later
  solution actions do not increase them.

---

### `@Exam(N)` — Exam / time-limit mode

Place this on a dedicated intro slide. Clicking **Start Exam** starts the countdown and immediately requests browser fullscreen while the click still has user activation. When the timer hits zero, the plugin auto-freezes the submission and locks navigation to the Abgabe slide.

``` markdown
## Exam instructions

@Exam(60)
```

- `N` — exam duration in minutes
- The slide the macro appears on becomes the **intro slide**: the plugin overlays a red warning card showing the duration and a name input field
- The Start Exam button requests fullscreen in Chrome, Edge, Brave, Firefox and
  Safari (including the older WebKit fallback). A denied or unavailable request
  never blocks the exam and is reported neutrally in the frozen evaluation.
- Leaving a confirmed fullscreen session during the active exam is stored in the
  decentralized freeze link and shown separately in the evaluation; it does not
  alter quiz points.
- A trusted lia-mathpath `@Explain` hint is exempt only when the course really
  imports lia-mathpath, contains an authored `[[?]] @Explain` hint, and the
  expected same-page overlay is confirmed. Synthetic/look-alike links and actual
  hidden-tab changes are not exempt. If the already rendered course is available
  but its Markdown source cannot be fetched again, the fallback still requires
  the exact MathPath link, quiz hierarchy, matching overlay/frame URL and a
  trusted click before granting the same one-shot exemption.
- A "Time left: MM:SS" countdown widget is shown fixed at the bottom-right corner while the timer runs
- When time runs out, `doCreateLink()` is called automatically and the student is redirected to the Abgabe slide
- If the course is opened past the intro slide, it redirects back to the intro;
  only the explicit Start Exam action can begin the timed/fullscreen session.

> **Note:** `@Exam` only activates in live (student) mode — it has no effect on shared freeze links opened by the teacher.

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

@Auswertung(F12;Tab;Time;Send)
```

---


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

@ADetails(1;Coordinates)

## Quiz 7 — Fractions

Mark the fraction $\dfrac{2}{5}$ on the circle.

@circleQuiz(2/5)

@ADetails(1;CircleQuiz)

## Quiz 8 — Orthography

Correct the spelling mistakes in the following sentence.

@orthography(`<!--  -->`,`The apel is red`,`The apple is red.`)

@ADetails(1;Orthography)

## Quiz 9 — Marking

Mark the text in red.

<div class="markerquiz">
@markred(RED)
@TextmarkerQuiz
</div>

@ADetails(1;Marker)



## Quiz 10 — Inline selection

Select a color: [[(Red)|Blue|Green]].

@ADetails(1;InlineSelection)

## Quiz 11 — Matrix

Assign each number to its parity.

- [[even] (odd)]
- [ (X) ( ) ] 2
- [ ( ) (X) ] 3

@ADetails(2;Matrix)

## Quiz 12 — Drag and drop

Sky: [->[(blue)]], grass: [->[(green)]].

@ADetails(2;DragDrop)

## Quiz 13 — Generic

Check the statement: water freezes at zero degrees Celsius.

[[!]]
<script>true</script>
*************
Water freezes at zero degrees Celsius.
*************

@ADetails(1;Generic)

## Quiz 14 - DGS area

Construct the counterclockwise triangle $(0|0)$, $(4|0)$, $(4|3)$. Its area is 6.

@CoordinateSystem(`xmin=-1;xmax=6;ymin=-1;ymax=5;width=420;id=QuizDgsArea`)

@DGS(`QuizDgsArea;tools=[200;510;920]`)

@AreaQuiz(`QuizDgsArea;3;6;0.05`,`<!-- -->`)

@ADetails(1;DGS-Area)

## Quiz 15 - DGS perimeter

Construct the counterclockwise triangle $(0|0)$, $(4|0)$, $(4|3)$. Its perimeter is 12.

@CoordinateSystem(`xmin=-1;xmax=6;ymin=-1;ymax=5;width=420;id=QuizDgsPerimeter`)

@DGS(`QuizDgsPerimeter;tools=[200;510;920]`)

@PerimeterQuiz(`QuizDgsPerimeter;3;12;0.05`,`<!-- -->`)

@ADetails(1;DGS-Perimeter)

## Quiz 16 - DGS construction

Construct the counterclockwise triangle $(0|0)$, $(4|0)$, $(4|3)$. The quiz checks side 4, the following right angle, and the following side 3.

@CoordinateSystem(`xmin=-1;xmax=6;ymin=-1;ymax=5;width=420;id=QuizDgsConstruction`)

@DGS(`QuizDgsConstruction;tools=[200;510;920]`)

@ConstructionQuiz(`QuizDgsConstruction;3;fixed;Side4,Angle90,Side3;lengthTolerance=0.05;angleTolerance=1`,`<!-- -->`)

@ADetails(1;DGS-Construction)

## Quiz 17 - Combined DGS construction, area, and perimeter

Construct the same counterclockwise 3-4-5 triangle. All three conditions must be fulfilled by the same learner-created polygon.

@CoordinateSystem(`xmin=-1;xmax=6;ymin=-1;ymax=5;width=420;id=QuizDgsCombined`)

@DGS(`QuizDgsCombined;tools=[200;510;920]`)

@KoordQuiz(`QuizDgsCombined;3;Konstruktion(fest;S4,W90,S3;streckentoleranz=0.05;winkeltoleranz=1);Flaeche(6;0.05);Umfang(12;0.05)`,`<!-- -->`)

@ADetails(1;DGS-Combined)

## All quiz types twice in flex children

<section class="dynFlex">
<div class="flex-child">

**Text input A**

France: [[Paris]].

@ADetails(1;Flex-Textinput-A)

</div>

<div class="flex-child">

**Text input B**

Italy: [[Rome]].

@ADetails(1;Flex-Textinput-B)

</div>

<div class="flex-child">

**Free text A**

Describe renewable energy.

    [[___ ___]]

@ADetails(0;Flex-Freetext-A)

</div>

<div class="flex-child">

**Free text B**

Explain photosynthesis.

    [[___ ___]]

@ADetails(0;Flex-Freetext-B)

</div>

<div class="flex-child">

**Inline selection A**

Select red: [[(Red)|Green|Black]].

@ADetails(1;Flex-Inlineselection-A)

</div>

<div class="flex-child">

**Inline selection B**

Select a mammal: [[(Whale)|Trout|Eagle]].

@ADetails(1;Flex-Inlineselection-B)

</div>

<div class="flex-child">

**Multiple choice A**

Select all even numbers.

- [[X]] 2
- [[ ]] 3
- [[X]] 4

@ADetails(1;Flex-Multiplechoice-A)

</div>

<div class="flex-child">

**Multiple choice B**

Select all planets.

- [[X]] Earth
- [[X]] Mars
- [[ ]] Moon

@ADetails(1;Flex-Multiplechoice-B)

</div>

<div class="flex-child">

**Single choice A**

What is $3+4$?

- [( )] 6
- [(X)] 7

@ADetails(1;Flex-Singlechoice-A)

</div>

<div class="flex-child">

**Single choice B**

Which animal is a bird?

- [(X)] Eagle
- [( )] Dolphin

@ADetails(1;Flex-Singlechoice-B)

</div>

<div class="flex-child">

**Matrix A**

Assign each number to its parity.

- [[even] (odd)]
- [ (X) ( ) ] 4
- [ ( ) (X) ] 5

@ADetails(1;Flex-Matrix-A)

</div>

<div class="flex-child">

**Matrix B**

Assign each animal to its class.

- [[mammal] (bird)]
- [ (X) ( ) ] Dog
- [ ( ) (X) ] Owl

@ADetails(1;Flex-Matrix-B)

</div>

<div class="flex-child">

**Drag and drop A**

Sun: [->[(yellow)]], sky: [->[(blue)]].

@ADetails(1;Flex-Draganddrop-A)

</div>

<div class="flex-child">

**Drag and drop B**

A [->[(fish)]] swims; a [->[(bird)]] flies.

@ADetails(1;Flex-Draganddrop-B)

</div>

<div class="flex-child">

**Generic A**

Check the statement: $2+2=4$.

[[!]]
<script>true</script>
*************
Correct: $2+2=4$.
*************

@ADetails(1;Flex-Generic-A)

</div>

<div class="flex-child">

**Generic B**

Check the statement: Earth orbits the Sun.

[[!]]
<script>true</script>
*************
Correct: Earth orbits the Sun.
*************

@ADetails(1;Flex-Generic-B)

</div>

<div class="flex-child">

**Canvas OCR A**

$2+2=$ [[ 4 ]] @canvas

@ADetails(1;Flex-CanvasOCR-A)

</div>

<div class="flex-child">

**Canvas OCR B**

$3+2=$ [[ 5 ]] @canvas

@ADetails(1;Flex-CanvasOCR-B)

</div>

<div class="flex-child">

**Coordinates A**

@CoordinateSystem(`xmin=-5;xmax=5;ymin=-5;ymax=5;width=420;id=FlexCoordA`)

Drag point $A$ to $(1|2)$.

@CreatePoint(`FlexCoordA;A;1;2`,`<!--  -->`)

@ADetails(1;Flex-Coordinates-A)

</div>

<div class="flex-child">

**Coordinates B**

@CoordinateSystem(`xmin=-5;xmax=5;ymin=-5;ymax=5;width=420;id=FlexCoordB`)

Drag point $B$ to $(-2|1)$.

@CreatePoint(`FlexCoordB;B;-2;1`,`<!--  -->`)

@ADetails(1;Flex-Coordinates-B)

</div>

<div class="flex-child">

**Circle fraction A**

Mark $\dfrac{1}{3}$ on the circle.

@circleQuiz(1/3)

@ADetails(1;Flex-Circlefraction-A)

</div>

<div class="flex-child">

**Circle fraction B**

Mark $\dfrac{3}{4}$ on the circle.

@circleQuiz(3/4)

@ADetails(1;Flex-Circlefraction-B)

</div>

<div class="flex-child">

**Orthography A**

Correct the spelling mistake.

@orthography(`<!--  -->`,`The apel is green`,`The apple is green.`)

@ADetails(1;Flex-Orthography-A)

</div>

<div class="flex-child">

**Orthography B**

Correct the spelling mistake.

@orthography(`<!--  -->`,`The hous is large`,`The house is large.`)

@ADetails(1;Flex-Orthography-B)

</div>

<div class="flex-child">

**Text marker A**

Mark RED in red.

<div class="markerquiz">
@markred(RED)
@TextmarkerQuiz
</div>

@ADetails(1;Flex-Textmarker-A)

</div>

<div class="flex-child">

**Text marker B**

Mark BLUE in blue.

<div class="markerquiz">
@markblue(BLUE)
@TextmarkerQuiz
</div>

@ADetails(1;Flex-Textmarker-B)

</div>

<div class='flex-child'>

**DGS area A**

Construct the triangle $(0|0)$, $(4|0)$, $(4|3)$.

@CoordinateSystem(`xmin=-1;xmax=6;ymin=-1;ymax=5;width=420;id=FlexDgsAreaA`)

@DGS(`FlexDgsAreaA;tools=[200;510;920]`)

@AreaQuiz(`FlexDgsAreaA;3;6;0.05`,`<!-- -->`)

@ADetails(1;Flex-DGS-Area-A)

</div>

<div class='flex-child'>

**DGS area B**

Construct the triangle $(0|0)$, $(4|0)$, $(4|3)$.

@CoordinateSystem(`xmin=-1;xmax=6;ymin=-1;ymax=5;width=420;id=FlexDgsAreaB`)

@DGS(`FlexDgsAreaB;tools=[200;510;920]`)

@FlaecheQuiz(`FlexDgsAreaB;3;6;0.05`,`<!-- -->`)

@ADetails(1;Flex-DGS-Area-B)

</div>

<div class='flex-child'>

**DGS perimeter A**

Construct the triangle $(0|0)$, $(4|0)$, $(4|3)$.

@CoordinateSystem(`xmin=-1;xmax=6;ymin=-1;ymax=5;width=420;id=FlexDgsPerimeterA`)

@DGS(`FlexDgsPerimeterA;tools=[200;510;920]`)

@PerimeterQuiz(`FlexDgsPerimeterA;3;12;0.05`,`<!-- -->`)

@ADetails(1;Flex-DGS-Perimeter-A)

</div>

<div class='flex-child'>

**DGS perimeter B**

Construct the triangle $(0|0)$, $(4|0)$, $(4|3)$.

@CoordinateSystem(`xmin=-1;xmax=6;ymin=-1;ymax=5;width=420;id=FlexDgsPerimeterB`)

@DGS(`FlexDgsPerimeterB;tools=[200;510;920]`)

@UmfangQuiz(`FlexDgsPerimeterB;3;12;0.05`,`<!-- -->`)

@ADetails(1;Flex-DGS-Perimeter-B)

</div>

<div class='flex-child'>

**DGS construction A**

Construct the counterclockwise triangle $(0|0)$, $(4|0)$, $(4|3)$.

@CoordinateSystem(`xmin=-1;xmax=6;ymin=-1;ymax=5;width=420;id=FlexDgsConstructionA`)

@DGS(`FlexDgsConstructionA;tools=[200;510;920]`)

@ConstructionQuiz(`FlexDgsConstructionA;3;fixed;Side4,Angle90,Side3;lengthTolerance=0.05;angleTolerance=1`,`<!-- -->`)

@ADetails(1;Flex-DGS-Construction-A)

</div>

<div class='flex-child'>

**DGS construction B**

Construct the counterclockwise triangle $(0|0)$, $(4|0)$, $(4|3)$.

@CoordinateSystem(`xmin=-1;xmax=6;ymin=-1;ymax=5;width=420;id=FlexDgsConstructionB`)

@DGS(`FlexDgsConstructionB;tools=[200;510;920]`)

@KonstruktionQuiz(`FlexDgsConstructionB;3;fest;S4,W90,S3;streckentoleranz=0.05;winkeltoleranz=1`,`<!-- -->`)

@ADetails(1;Flex-DGS-Construction-B)

</div>

<div class='flex-child'>

**Combined DGS A**

Construct the counterclockwise triangle $(0|0)$, $(4|0)$, $(4|3)$.

@CoordinateSystem(`xmin=-1;xmax=6;ymin=-1;ymax=5;width=420;id=FlexDgsCombinedA`)

@DGS(`FlexDgsCombinedA;tools=[200;510;920]`)

@CoordinateQuiz(`FlexDgsCombinedA;3;Construction(fixed;Side4,Angle90,Side3;lengthTolerance=0.05;angleTolerance=1);Area(6;0.05);Perimeter(12;0.05)`,`<!-- -->`)

@ADetails(1;Flex-DGS-Combined-A)

</div>

<div class='flex-child'>

**Combined DGS B**

Construct the counterclockwise triangle $(0|0)$, $(4|0)$, $(4|3)$.

@CoordinateSystem(`xmin=-1;xmax=6;ymin=-1;ymax=5;width=420;id=FlexDgsCombinedB`)

@DGS(`FlexDgsCombinedB;tools=[200;510;920]`)

@GeometrieQuiz(`FlexDgsCombinedB;3;Konstruktion(fest;S4,W90,S3;streckentoleranz=0.05;winkeltoleranz=1);Flaeche(6;0.05);Umfang(12;0.05)`,`<!-- -->`)

@ADetails(1;Flex-DGS-Combined-B)

</div>

</section>

## Test slide

The slides below let you test the plugin locally using `./dist/index.js`.

@Exam(.5)


## Submit

@Abgabe

@Auswertung(F12;Tab;Time;Send)
