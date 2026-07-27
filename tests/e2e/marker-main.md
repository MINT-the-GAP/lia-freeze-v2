<!--
author: MINT-the-GAP; Martin Lommatzsch; Jihad Hyadi
version: 1.0.0
language: de
comment: Regressionstest für alle öffentlichen lia-marker-Quizvarianten auf main.
tags: LiaScript, Freeze, Marker, Regressionstest

import: https://raw.githubusercontent.com/MINT-the-GAP/lia-marker/179de61a51ce8523ccdf517b4bdd777907fcb217/README.md
import: ./freeze-harness.md
-->

# lia-marker main

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

Die ersten sechs Wörter sind nur Demonstrationen. Markiere anschließend das Ziel.

@markedred(Rot) @markedblue(Blau) @markedgreen(Grün) @markedyellow(Gelb) @markedpink(Pink) @markedorange(Orange)

<div class="markerquiz">
@markgreen(Ziel)
@TextmarkerQuiz
</div>

@ADetails(1;MarkerPrefill)

## Abgabe

@Abgabe

@Auswertung(F12;Tab;Time)
