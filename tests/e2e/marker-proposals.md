<!--
author: MINT-the-GAP; Martin Lommatzsch; Jihad Hyadi
version: 1.0.0
language: de
comment: Regressionstest für lia-marker Proposals einschließlich Explain-Toolbar-Sperre.
tags: LiaScript, Freeze, Marker, Proposals, Regressionstest

import: https://raw.githubusercontent.com/MINT-the-GAP/lia-marker/9f1eae7b85ef9d7258c487b67841597a5d57cfee/README.md
import: ./freeze-harness.md
-->

# lia-marker Proposals

## Farbziele

Markiere jedes Wort in der vorgegebenen Farbe.

<div class="markerquiz">
@markred(Rot) @markblue(Blau) @markgreen(Grün) @markyellow(Gelb) @markpink(Pink) @markorange(Orange)
@TextmarkerQuiz
</div>

@ADetails(2;MarkerFarben)

## Beliebige Farbe

Markiere den vollständigen Zieltext in einer beliebigen Farbe.

<div class="markerquiz">
@mark(Dieser Zieltext, enthält ein Komma.)
@TextmarkerQuiz
</div>

@ADetails(3;MarkerAny)

## Vorgefüllte Farben und Quiz

@markedred(Rot) @markedblue(Blau) @markedgreen(Grün) @markedyellow(Gelb) @markedpink(Pink) @markedorange(Orange)

<div class="markerquiz">
@markorange(Ziel)
@TextmarkerQuiz
</div>

@ADetails(1;MarkerPrefill)

## Abgabe

@Abgabe

@Auswertung(F12;Tab;Time)
