<!--
author: MINT-the-GAP; Martin Lommatzsch; Jihad Hyadi
version: 1.0.0
language: de
comment: Regressionstest für die lia-Mathe-Formelquizze im Proposals-Branch.
tags: LiaScript, Freeze, Mathematik, Formelquiz, Regressionstest

import: https://raw.githubusercontent.com/MINT-the-GAP/lia-Mathe/8603623a4cc56b53abe740d18ced27d6a3b85ef7/README.md
import: ./freeze-harness.md
-->

# lia-Mathe Proposals

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

## LiaQuiz

$\dfrac{\liaquiz}{3} = \dfrac{5}{15}$

@liaQuiz(1)

@ADetails(5;LiaQuiz)

## LiaQuizC

$\dfrac{5}{\liaquiz} = \dfrac{1}{3}$

@liaQuizC(15,`<!-- data-solution-button="2" -->`)

@ADetails(6;LiaQuizC)

## Mehrere Formel-Eingaben

$\dfrac{\liaquiz}{3} = \dfrac{5}{\liaquiz}$

@liaQuiz(1)

@ADetails(7;LiaQuizMehrfachA)

@liaQuiz(15)

@ADetails(8;LiaQuizMehrfachB)

## Abgabe

@Abgabe

@Auswertung(F12;Tab;Time)
