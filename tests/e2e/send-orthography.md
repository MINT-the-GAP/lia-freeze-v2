<!--
author: MINT-the-GAP; Martin Lommatzsch; Jihad Hyadi
version: 1.0.0
language: de
comment: Fokussierter Regressionstest für lia-orthography mit verzögerter Send-Auswertung.
tags: LiaScript, Freeze, Orthography, Send, Regressionstest

import: https://raw.githubusercontent.com/MINT-the-GAP/lia-orthography/main/README.md
import: ./freeze-harness.md
-->

# Orthography-Prüfung mit verzögerter Auswertung

Die beiden Antworten werden vor der Abgabe nur gespeichert und erst beim
Erzeugen des Freeze-Links geprüft.

## Orthography A und B

<section class="dynFlex">
<div class="flex-child">

**Orthography A**

Korrigiere den Satz.

@orthography(`<!-- data-solution-button="true" -->`,`Der Apfl ist rot.`,`Der Apfel ist rot.`)

@ADetails(2;Orthography A)

</div>
<div class="flex-child">

**Orthography B**

Korrigiere den Satz.

@orthography(`<!-- data-solution-button="true" -->`,`Das Huus ist groß.`,`Das Haus ist groß.`)

@ADetails(3;Orthography B)

</div>
</section>

## Abgabe

@Abgabe

@Auswertung(F12;Tab;Time;Send)
