<!--
author: MINT-the-GAP; Martin Lommatzsch; Jihad Hyadi
version: 1.0.0
language: de
comment: Fokussierter Regressionstest für lia-marker mit verzögerter Send-Auswertung.
tags: LiaScript, Freeze, Marker, Send, Regressionstest

import: https://raw.githubusercontent.com/MINT-the-GAP/lia-marker/179de61a51ce8523ccdf517b4bdd777907fcb217/README.md
import: ./freeze-harness.md
-->

# Marker-Prüfung mit verzögerter Auswertung

Die Marker-Antworten werden vor der Abgabe nur gespeichert und erst beim
Erzeugen des Freeze-Links geprüft.

## Marker A und B

<section class=dynFlex>
<div class=flex-child>

**Marker A**

Markiere das Wort „ROT“ vollständig rot.

<div class=markerquiz>
@markred(ROT)
@TextmarkerQuiz
</div>

@ADetails(2;Marker A)

</div>
<div class=flex-child>

**Marker B**

Markiere das Wort „BLAU“ vollständig blau.

<div class=markerquiz>
@markblue(BLAU)
@TextmarkerQuiz
</div>

@ADetails(3;Marker B)

</div>
</section>

## Abgabe

@Abgabe

@Auswertung(F12;Tab;Time;Send)
