# Automatische Canvas-Fortschrittssicherung

Stand: 10. September 2026.

Automatische Sicherungen verwenden die rasterfreie Live-API und übernehmen nur geänderte Canvas. Geometrieaufbereitung und Komprimierung für den Abgabelink erfolgen an der Abgabegrenze. Der Fortschritt liegt wie bisher im Arbeitsspeicher; eine neue Sicherung über Browser-Reloads hinweg wurde nicht eingeführt.

## Ausgangsbefund und Veröffentlichungsstand

Der alte Pfad war:

```text
captureCanvasProgress
  → captureMountedCanvasStates
  → exportAllCanvasFreezeStatesFromRoot
  → Rasterzeichnung / getImageData / Pixelzuschnitt
  → Geometrieaufbereitung / compactCanvasStates
```

Die mitgeteilte ursprüngliche Vergleichsmessung ergab mit Freeze 15 Longtasks, zusammen 2804 ms, maximal 272 ms; ohne Freeze keine Longtasks. Diese Werte stammen aus dem Ausgangsbefund, nicht aus dem unten beschriebenen Testlauf.

Vor Änderungen wurde der lokale und öffentliche Stand geprüft:

| Artefakt | Stand / SHA256 |
| --- | --- |
| Ursprünglicher lokaler Freeze-Checkout | Commit `92c42db` |
| Ursprüngliches lokales Freeze-Bundle | `0A0AB034E0288D0BCA8CEF9345503F2B04DEF7FD189BCFE6998037F20850E75B` |
| Öffentliches Freeze-main | `e7088bd6ab0a9508658b02aca4081867f505fce3`, „clean ups“, 7. September 2026 |
| Öffentliches Freeze-Bundle | `CE1676066C6C6255F0D1C934B838C7D4913CAB83C074EEC1C5E5BA52B537A716` |
| Freeze-Bundle im Hauptmesslauf | `05840775AF35AC249F655252A98DB3E7DB4312C1D844D1735D0703BA3D4FDA40` |
| Final neu gebautes Freeze-Bundle | `9E0E39641B074B79670D15C277032FC0AE745A5CD9292473C2975EB9B0D47703` |
| Eingefrorenes Canvas-Bundle für beide modernen Vergleichsläufe | `0E3DE69D0009D7B3E801ABCE3854F9E49546DE46FFF89DA0C464DCD560CB7A80` |
| Veröffentlichtes Canvas-Bundle für abschließende Integration | `2792AB2FEA66EDDEC88CCF5C92EEEB4E15C3CC0346CDEC8872619FBE1D3BB0FE` |

Der öffentliche Commit wurde vor dem Fix per Fast-forward übernommen. Er ergänzt unter anderem HTML-Escaping und einen Guard für einen Restore-Observer. Der Vorher-Lauf verwendet ausdrücklich das ursprüngliche lokale Bundle; es war nicht identisch mit dem damaligen öffentlichen Bundle.

Bei der ersten Prüfung fehlte die angekündigte Live-API sowohl im lokalen als auch öffentlichen Canvas-main `c514142e0b241fd6dc3d40360a9d245cfdf8dddb`. Während der Bearbeitung entstand sie parallel im lokalen OCR-Checkout. Gelesen wurden die tatsächlichen Implementierungen in `src/canvas/live-state.ts`, `src/canvas/freeze.ts`, `src/canvas/store.ts` und ihre Anbindung in `src/canvas/index.ts`. Diese Änderungen waren beim Festhalten des Messbundles noch uncommitted. Daraus folgt keine Veröffentlichung der Canvas-Live-API. Da jener Checkout weiter bearbeitet wurde, verwenden die Vergleichsläufe eine unveränderte Bundlekopie. Der anschließend fertiggestellte Canvas-Build `2792AB…` ist davon getrennt ausgewiesen. Bei der Abschlussprüfung war Canvas-main auf `a139a851213c3b295d316da51aefecd1cb9019fe` veröffentlicht und der lokale OCR-Checkout sauber. Sowohl die öffentliche README als auch das öffentliche Bundle dieses Commits wurden bytegenau mit den Abschluss-Testartefakten abgeglichen. Freeze-main steht weiterhin auf `e7088bd…`; der Freeze-Fix liegt im lokalen Arbeitsbaum und im neu gebauten `dist/index.js`.

## Verwendeter API-Vertrag

Die Methoden liegen unter `window.__LIA_CANVAS_OCR__.freeze`. `freeze.version` bleibt `cvf1`, `liveStateVersion` ist `cvl1`. Freeze erkennt Fähigkeiten anhand der vorhandenen Methoden.

| Methode | Implementierter Vertrag |
| --- | --- |
| `listCanvasLiveStateRevisions(root)` | `{ uid, revision }[]` für vorhandene Storeeinträge der Canvas-Paare im Root, einschließlich Root selbst; keine Geometriekopie. |
| `exportCanvasLiveStateByUID(uid)` | Synchron `{ uid, revision, state }` oder `null`. |
| `getCanvasLiveActivityByUID(uid)` | `{ uid, revision, active, operations }` oder `null`; Freeze berücksichtigt diese optionale Methode. |
| `restoreCanvasLiveStateByUID(uid, state)` | Validiert `cvl1`, erzeugt bearbeitbare Daten und eine neue lokale Revision. Diese API gehört zu Canvas; Freeze-Abgabelinks bleiben statische Ansichten. |

Der Zustand enthält `v: 'cvl1'`, `ITEMS`, `REDO`, `VIEW`, `bgMode`, `bgStep`, `wrapW` und `canvasH`, optional außerdem `calculationReviewFreeze`, `editorDraft` und `ocr`. Die UID steht ausschließlich in der Snapshot-Hülle. Striche und Radierer bleiben geordnete Weltgeometrie einschließlich außerhalb des Viewports liegender Punkte. Pan/Zoom stehen in `VIEW`.

Revisionen werden nur auf Gleichheit innerhalb derselben API-Laufzeit verglichen. Neue Punkte eines laufenden Strichs ändern die Revision bereits synchron. Unveränderte Revisionen liefern dieselben Snapshot-Referenzen. Ausgegebene Objekte sind unveränderlich; unveränderte Striche werden zwischen Revisionen geteilt.

`lia:canvas-change` bleibt ein um 120 ms gebündeltes Ereignis. `lia:canvas-activity` meldet laufende Vorgänge synchron am Root-Window. Ein stillgehaltener, weiterhin gedrückter Stift bleibt aktiv. Das Modell ist bereits aktuell, bevor das verzögerte Änderungsereignis eintrifft.

## Umsetzung in Freeze

- [canvas-progress.ts](../src/canvas-progress.ts) bündelt `pointerup`, Klicks und `lia:canvas-change` in einer Warteschlange. Neue Zeigerkontakte oder Canvas-Aktivitäten verwerfen geplante Timer, erhalten aber geänderte UIDs. Eine Generation entwertet bereits eingeplante alte Callbacks. Die Wartezeit beträgt 160 ms nach dem letzten relevanten Signal.
- [canvas-state.ts](../src/canvas-state.ts) führt einen Cache je Canvas-API, UID und Revision. Unveränderte Zustandsobjekte bleiben erhalten. Fehlgeschlagene Exporte quittieren keine neue Revision. Bekannte UIDs bleiben auch nach Demontage oder einem fehlgeschlagenen Sicherungsversuch bekannt.
- [snapshot.ts](../src/snapshot.ts) hält intern die Live-Zustände. Automatische Sicherungen führen weder Rasterexport noch `buildFullCanvasFreezeState` oder `compactCanvasStates` aus. Aktivitätsabfragen verhindern Exporte während laufender Eingaben. Beobachtete UIDs werden auch nach einem schnellen Folienwechsel erstmals erfasst.
- [index.ts](../src/index.ts) verbindet die Erfassung mit Canvas-Ereignissen und Abgabe. Vor einer Auswertung, die Canvas-DOM verändern kann, wird der aktuelle Zustand übernommen. Die endgültige Erfassung liest gemountete und bekannte demontierte UIDs erneut, unabhängig von wartenden Timern.

Der Canvas-`pointerup`-Handler ergänzt den letzten Endpunkt synchron. Ein anschließender Abgabe-Klick sieht ihn bereits vor dem nächsten Animationsframe und `lia:canvas-change`. Final wird die vollständige `cvf1`-Ansicht aufgebaut und einmal pro Abgabeversuch zu `cvq1` komprimiert, soweit das Format dies unterstützt. Berechnungsprüfungen bleiben als `cr` erhalten. Raster- und Auswahlfarben werden erst bei Abgabe aus der aktuellen Canvas-Akzentfarbe ergänzt; diese Themefarbe ist kein Feld des Live-Zustands. Bestehende `cvf1`- und `cvq1`-Abgaben verwenden die bisherigen Wiederherstellungspfade.

Explizites Löschen ist bei Abgabe verbindlich; eine fehlende UID allein bedeutet keine Löschung. Nicht aufgelöste Exportfehler verhindern unvollständige Abgaben.

Ältere Versionen mit `getCanvasStoreEntry` verwenden abgelöste Kopien neuer, anhand der Store-Referenz geänderter oder durch Ereignisse als geändert markierter Canvas. Geometrieaufbereitung bleibt bis zur Abgabe aufgeschoben. Eine Version mit ausschließlich vollständigem Export wird automatisch nicht gerastert; ihr Export bleibt an der Abgabegrenze verfügbar.

## Prüfung und Reproduktion

`npm run build` führte TypeScript-Prüfung und **229/229 bestandene Tests** aus, anschließend einen erfolgreichen Parcel-Build. Protokoll: `tests/artifacts/canvas-progress-2026-09-10/build.log`.

Die 23 Snapshot-Integrationstests prüfen Revisionen, Referenzwiederverwendung, aktive Eingaben, unmittelbaren Endpunkt und Clear, schnellen Folienwechsel, Legacy-Fallbacks, Grenzen und Fehlerbehebung. Dabei sind automatisch jeweils null Rasterexporte, Pixelzugriffe, Geometrieaufbereitungen, Komprimierungen und Base64-Pfadkodierungen erlaubt. Scheduler-Tests prüfen zusammengeführte Ereignisse und Zurückstellen bei erneutem Zeichnen.

Der Browsertest öffnet den vollständigen [README-Kurs](../README.md), Folie `#27`, mit allen Imports: JSXGraph, DynFlex, Annotation, Canvas-OCR, Coordinate, Mathe, Orthography und Marker. Nur ausdrücklich angegebene Freeze- und Canvas-Bundles werden ersetzt. Geladene Kursdateien und Bundles werden mit URL, HTTP-Status und Hash erfasst.

Verwendet wurde Chrome 152.0.7977.83 unter Windows, headless, 1800 × 1300 Pixel, vierfache CPU-Drosselung. Der Hauptlauf bereitet zwei offene Canvas mit je 220 Pfaden zu 64 Punkten vor und zeichnet anschließend 24 echte Browser-Mausstriche mit jeweils 16 Bewegungen und 90/240 ms Schreibpausen. Die Vorbereitung liegt vor dem gemessenen Schreibabschnitt.

In einem Terminal im Repository:

```powershell
node node_modules/@liascript/devserver/dist/index.js --node_modules . --port 4174 --input ..
```

In einem zweiten Terminal dieselben gesicherten Canvas-Bytes für beide Läufe verwenden. Die Vergleichsdateien liegen im lokalen Artefaktverzeichnis. Für eine neue Messung das alte Freeze-Bundle aus Commit `92c42db`, das neue `dist/index.js` und ein Canvas-Bundle mit Live-API dorthin kopieren und die SHA256-Werte erneut festhalten.

```powershell
node tests/browser/canvas-progress.mjs before-modern tests/artifacts/canvas-progress-2026-09-10/before-index.js tests/artifacts/canvas-progress-2026-09-10/canvas-modern-index.js
node tests/browser/canvas-progress.mjs after-modern tests/artifacts/canvas-progress-2026-09-10/after-index.js tests/artifacts/canvas-progress-2026-09-10/canvas-modern-index.js
node tests/browser/canvas-progress-profile.mjs tests/artifacts/canvas-progress-2026-09-10/before-modern.cpuprofile tests/artifacts/canvas-progress-2026-09-10/before-index.js tests/artifacts/canvas-progress-2026-09-10/before-modern-cpu-summary.json
node tests/browser/canvas-progress-profile.mjs tests/artifacts/canvas-progress-2026-09-10/after-modern.cpuprofile tests/artifacts/canvas-progress-2026-09-10/after-index.js tests/artifacts/canvas-progress-2026-09-10/after-modern-cpu-summary.json
```

Der Browserpfad ist mit `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` überschreibbar; Standard: `C:/Program Files/Google/Chrome/Application/chrome.exe`. Für einen kleineren Zusatzlauf vor denselben Befehlen mit passenden Laufnamen:

```powershell
$env:CANVAS_PROGRESS_SEEDED_PATHS = '20'
$env:CANVAS_PROGRESS_POINTS = '24'
$env:CANVAS_PROGRESS_STROKES = '12'
```

`CANVAS_PROGRESS_CPU_RATE` setzt bei Bedarf die CPU-Drosselung. Berichte, CPU-Profile, Bundlekopien, Abgabepayloads und Screenshots liegen in `tests/artifacts/canvas-progress-2026-09-10/`; dieses Verzeichnis ist nicht versioniert. Die Testprogramme sind versioniert.

## Browserergebnisse

Der Hauptvergleich verwendet vor und nach dem Fix dasselbe eingefrorene Canvas-Bundle. Die Nachher-Messung bezieht sich auf Freeze `058407…`; der finale Build `9E0E39…` ergänzt anschließend die Absicherung älterer Canvas-Exporte und die Übernahme der Akzentfarbe bei Abgabe. Diese Bundle-Stände werden getrennt ausgewiesen.

| Messgröße im Schreibabschnitt | Vorher | Nachher |
| --- | ---: | ---: |
| Vollständige Canvas-Rasterexporte | 85 | 0 |
| `getImageData`-Aufrufe | 170 | 0 |
| `btoa`-Aufrufe einschließlich Pfadkodierungen | 38729 | 0 |
| Rasterexporte während gedrückter Maustaste | 13 | 0 |
| Longtasks: Anzahl | 1299 | 1208 |
| Longtasks: Summe / Maximum | 161252 / 1140 ms | 120651 / 201 ms |
| CPU-Samples, `captureCanvasProgress` inkl. Unteraufrufe | 21344 ms | 47 ms |
| CPU-Samples, Geometrieaufbereitung inkl. Unteraufrufe | 1287 ms | 0 ms |
| CPU-Samples, Canvas-Komprimierung inkl. Unteraufrufe | 4743 ms | 0 ms |
| CPU-Samples, `getImageData` | 10343 ms | 0 ms |

Im Nachher-Schreibabschnitt wurden 24 Revisionsabfragen und 37 Live-Exporte erfasst. Die Live-Exporte benötigten zusammen 19,3 ms, maximal 1 ms; keiner erfolgte während gedrückter Maustaste. Rasterexporte, `getImageData`, `btoa` und `CompressionStream` wurden dabei nicht aufgerufen. Die profilierten Laufzeiten betrugen vorher 218615 ms und nachher 174085 ms.

Undo/Redo, Radierer, Löschen, Pan/Zoom, Folienwechsel mit Rückkehr, unmittelbare Abgabe und Öffnen des erzeugten Abgabelinks bestanden im Hauptlauf. Nach dem Folienwechsel waren alle 241 Zeichenobjekte vorhanden. Die Abgabe startete 32,1 ms nach dem letzten `pointerup` und enthielt 242 Zeichenobjekte einschließlich des letzten Strichs sowie den explizit leeren zweiten Canvas. Die wiederhergestellte Ansicht war gesperrt. In der getrennten Abgabephase traten erwartungsgemäß 244 `btoa`-Aufrufe und ein `CompressionStream` auf. Berichte: `after-modern-report.json`, `after-modern-cpu-summary.json`, CPU-Profil, Abgabepayload und Screenshot im Artefaktverzeichnis.

CPU-Samples sind geschätzte Zeitanteile; Aufrufzahlen stammen aus gesonderter Instrumentierung. Die Funktionszuordnung berücksichtigt Exportnamen und Quellpositionen im tatsächlich gemessenen minifizierten Bundle. Longtasks umfassen den gesamten Kurs und alle Imports. Der große vorbereitete Datensatz, Drosselung und Instrumentierung unterscheiden sich vom ursprünglichen 15-Longtask-Befund; absolute Werte sind nicht direkt vergleichbar.

### Abschluss mit beiden fertigen Bundles

Der Schlusslauf `after-release-long` verwendete Freeze `9E0E39...` und das fertiggestellte Canvas-Bundle `2792AB...`, erneut den vollständigen Kurs mit zwei Canvas und je 220 vorbereiteten Pfaden zu 64 Punkten. Die funktionalen Prüfungen und die folgenden Pausensicherungen liefen bei normaler CPU-Geschwindigkeit; der oben ausgewiesene Haupt-Profilvergleich lief mit vierfacher CPU-Drosselung.

- Drei weitere echte Striche auf Canvas A mit je 650 ms Pause erzeugten drei separate Live-Exporte. Canvas B behielt Revision 240 und wurde dabei keinmal erneut exportiert. Es traten keine Rasterzugriffe oder Pfadkomprimierungen auf.
- Undo/Redo, Radierer, explizites Löschen, Pan/Zoom, Folienwechsel, Linien-/Rasterhintergrund und Übernahme der tatsächlichen Themefarbe bestanden. Die importierte Theme-Verwaltung setzte die Akzentfarbe auf `rgb(20,115,117)`; der Abgabepayload enthielt passend `rgba(20,115,117,0.65)`. Eine manuell gesetzte abweichende CSS-Variable wurde vom Import wieder überschrieben; der Test behauptet deren Fortbestand nicht.
- Die Abgabe startete 31,6 ms nach `pointerup` und enthielt alle 228 Zeichenobjekte einschließlich des letzten Strichs sowie einen ausdrücklich leeren zweiten Canvas. Die Vorschau wurde mit 444 × 245 Pixeln gesperrt wiederhergestellt.
- Sowohl der neue `cvq1`-Link als auch eine mit dem alten `cvf1`-Format kodierte Abgabe wurden im vollständigen Kurs erfolgreich geöffnet.

Ergebnis: PASS, keine protokollierten Browser-/Importfehler. Artefakte: `after-release-long-report.json`, `after-release-long-payload.json`, `after-release-long-restored.png` und die beiden Abgabelinks. Die 16 erfassten Importressourcen des Hauptvergleichs waren vor und nach dem Fix byteidentisch.

Reproduktion dieses funktionalen Schlusslaufs (nach Start des Devservers, Pfade entsprechend dem lokalen Archiv):

```powershell
$env:CANVAS_PROGRESS_SEEDED_PATHS = '220'
$env:CANVAS_PROGRESS_POINTS = '64'
$env:CANVAS_PROGRESS_STROKES = '0'
node tests/browser/canvas-progress.mjs after-release-long tests/artifacts/canvas-progress-2026-09-10/release-index.js tests/artifacts/canvas-progress-2026-09-10/canvas-final-index.js
```

### Kleinerer Vergleich

Ein Zusatzlauf mit zwei Canvas, je 20 vorbereiteten Pfaden zu 24 Punkten und 12 echten Strichen bei vierfacher CPU-Drosselung bestand ebenfalls:

| Messgröße | Vorher | Nachher |
| --- | ---: | ---: |
| Canvas-Sicherungs-CPU inkl. Unteraufrufe | 1394 ms | 14 ms |
| Longtasks: Anzahl | 624 | 617 |
| Longtasks: Summe / Maximum | 66216 / 187 ms | 53988 / 142 ms |

Nachher liefen 24 Live-Exporte mit zusammen rund 4 ms; kein Export fiel in eine aktive Pointer-Eingabe. Rasterexport, `getImageData`, Pfadpackung und gzip wurden im Schreibabschnitt nicht aufgerufen. Artefakte: `before-normal-report.json`, `after-normal-report.json` und die jeweiligen CPU-Profile/-Zusammenfassungen.

Das Canvas-JavaScript war in beiden Läufen byteidentisch (`0E3DE69D...`); 15 von 16 erfassten externen Ressourcen waren identisch. Die Canvas-README änderte sich zwischenzeitlich von 26682 auf 26873 Bytes. Der Commitvergleich `c514142..a139a85` zeigt ausschließlich drei Dokumentationszeilen mit einem Link zum Live-API-Vertrag, außerhalb des LiaScript-Dokumentkopfs. Der importierte Makro-/Script-Kopf war byteidentisch. Dieser Zusatzlauf wird dennoch getrennt vom Hauptvergleich mit 16 identischen Ressourcen ausgewiesen.

### Weitere beobachtete CPU-Kosten

Der vollständige Kurs enthält weiterhin erhebliche andere Arbeit. Die Vorher-CPU-Zuordnung zeigt unter anderem den Theme-Observer von lia-marker (`MutationObserver` → `adaptUIVars` → Eltern-/Hintergrundfarbenabfrage mit `getComputedStyle`), außerdem Freeze `captureNativeDomNow` und `refreshAssignmentDetailSidecars` für ADetails. Über alle Aufrufpfade summiert und ohne doppelte Zählung desselben Samples innerhalb einer Funktion ergeben sich folgende inklusive Samplingzeiten:

| Funktion | Vorher-Hauptlauf | Nachher-Hauptlauf |
| --- | ---: | ---: |
| lia-marker `adaptUIVars` | 106438 ms | 93251 ms |
| Freeze `captureNativeDomNow` | 34314 ms | 31136 ms |
| Freeze `refreshAssignmentDetailSidecars` | 12605 ms | 11686 ms |

Die Profillaufzeiten unterscheiden sich; diese absoluten Zeitanteile sind keine standardisierte Durchsatzmetrik und werden nicht zur Longtask-Gesamtdauer addiert. Der Marker wurde anhand des tatsächlich geladenen, identischen Bundle-Hashes `d1560c0c7476385a1ae8aee0a592475305e251cea555161118915f8e9fe30262` zugeordnet; im lokalen Marker-Quelltext entsprechen dem `src/theme/index.ts` ab Zeile 91 und `src/index.ts` ab Zeile 341.

Diese Befunde benennen zusätzliche Style-/DOM-Observer und weitere Freeze-Pfade. Das CPU-Profil beweist nicht, wer die auslösenden Root-Klassenmutationen verursacht. Eine pauschale Zuordnung zu Canvas- oder JSXGraph-Rendering wäre durch diese Daten nicht gedeckt. Diese anderen Pfade wurden in diesem Fix nicht geändert.

## Verbleibende Grenzen

- Der erste Live-Export kopiert vorhandene Punkte. Weitere Exporte durchlaufen die Strichcontainer und übernehmen unveränderte Strichkopien. Neue beziehungsweise aktive Striche verursachen weiterhin Kopierarbeit.
- Der Legacy-Store-Fallback kopiert einen geänderten Canvas vollständig; seine Kosten wachsen mit dessen Punktzahl. Versionen ohne Daten-API können demontierte Zeichnungen nicht zuverlässig durch einen späteren reinen DOM-Rasterexport rekonstruieren.
- Finale Geometrieaufbereitung und Komprimierung bleiben synchron und können bei sehr großen Zeichnungen Longtasks erzeugen. Die bestehende JSON-/gzip-Verarbeitung des Abgabepayloads verursacht zusätzliche Arbeit. Dies geschieht an der Abgabegrenze, nicht regelmäßig beim Schreiben.
- Bei Abgabe während laufender OCR wird der bereits verarbeitete Zustand übernommen. Freeze wartet nicht auf ein zukünftiges OCR-Ergebnis. Ein offener Editorentwurf ist Bestandteil des Live-Modells; die statische Abgabe übernimmt die vorhandene Canvas-/Reviewansicht.
- Die Live-Sicherung ist kein neues Reload-Backup. UID und Revision gelten innerhalb ihrer Laufzeit; gespeicherte Abgabelinks bleiben der bestehende Transport zur Wiederherstellung.
- Die Integration entfernt den untersuchten Freeze-Sicherungspfad. Sie garantiert keine vollständige Longtask-Freiheit des LiaScript-Kurses oder anderer importierter Plugins.

Die Freeze-Integration wurde in Headless Chrome 152 mit echten Browser-Mausereignissen getestet. Physischer Stift, Touch-Eingaben sowie Firefox/WebKit wurden in diesem Freeze-Vollkurslauf nicht geprüft.
