<!--
author: MINT-the-GAP; Martin Lommatzsch; Jihad Hyadi
version: 1.0.0
language: de
comment: Regressionstest für den dokumentierten lia-Mathe-Tag ohne public getAllWidgets.
tags: LiaScript, Freeze, Mathematik, Regressionstest

import: https://raw.githubusercontent.com/MINT-the-GAP/lia-Mathe/0.0.2/README.md
import: ./freeze-harness.md
-->

# lia-Mathe 0.0.2

## CircleQuiz

@circleQuiz(3/8)

@ADetails(1;CircleQuiz)

## CircleQuizC

@circleQuizC(3/8,`<!-- data-solution-button="2" -->`)

@ADetails(2;CircleQuizC)

## RectQuiz

@rectQuiz(1/3)

@ADetails(3;RectQuiz)

## RectQuizC

@rectQuizC(1/3,`<!-- data-solution-button="2" -->`)

@ADetails(4;RectQuizC)

## Abgabe

@Abgabe

@Auswertung(F12;Tab;Time)
