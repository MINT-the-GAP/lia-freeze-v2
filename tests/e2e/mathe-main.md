<!--
author: MINT-the-GAP; Martin Lommatzsch; Jihad Hyadi
version: 1.0.0
language: de
comment: Regressionstest für alle lia-Mathe-Fraction-Quizze auf main.
tags: LiaScript, Freeze, Mathematik, Regressionstest

import: https://raw.githubusercontent.com/MINT-the-GAP/lia-Mathe/ac57189202bc8398751b405b6a448a91525b6245/README.md
import: ./freeze-harness.md
-->

# lia-Mathe main

## CircleQuiz

Markiere drei Achtel.

@circleQuiz(3/8)

@ADetails(1;CircleQuiz)

## CircleQuizC

Markiere drei Achtel.

@circleQuizC(3/8,`<!-- data-solution-button="2" -->`)

@ADetails(2;CircleQuizC)

## RectQuiz

Markiere ein Drittel.

@rectQuiz(1/3)

@ADetails(3;RectQuiz)

## RectQuizC

Markiere ein Drittel.

@rectQuizC(1/3,`<!-- data-solution-button="2" -->`)

@ADetails(4;RectQuizC)

## Abgabe

@Abgabe

@Auswertung(F12;Tab;Time)
