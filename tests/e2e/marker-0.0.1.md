<!--
author: MINT-the-GAP; Martin Lommatzsch; Jihad Hyadi
version: 1.0.0
language: de
comment: Regressionstest für den öffentlichen lia-marker-Tag 0.0.1 ohne setHighlights-API.
tags: LiaScript, Freeze, Marker, 0.0.1, Regressionstest

import: https://raw.githubusercontent.com/MINT-the-GAP/lia-marker/cc8db78d1d93fd54d000e1090890fc110212ca85/README.md
import: ./freeze-harness.md
-->

# lia-marker 0.0.1

## Farbziele

Markiere jedes Wort in der vorgegebenen Farbe.

<div class="markerquiz">
@markred(Rot) @markblue(Blau) @markgreen(Grün) @markyellow(Gelb) @markpink(Pink) @markorange(Orange)
@TextmarkerQuiz
</div>

@ADetails(2;MarkerFarben)

## Beliebige Farbe

Markiere den Zieltext in einer beliebigen Farbe.

<div class="markerquiz">
@mark(Beliebige Farbe)
@TextmarkerQuiz
</div>

@ADetails(3;MarkerAny)

## Vorgefüllte Farben und Quiz

@markedred(Rot) @markedblue(Blau) @markedgreen(Grün) @markedyellow(Gelb) @markedpink(Pink) @markedorange(Orange)

<div class="markerquiz">
@markyellow(Ziel)
@TextmarkerQuiz
</div>

@ADetails(1;MarkerPrefill)

## Abgabe

@Abgabe

@Auswertung(F12;Tab;Time)
