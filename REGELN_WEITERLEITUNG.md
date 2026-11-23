# 📜 Regelwerk: Weiterleitung von Schiedsrichteransetzungen

Diese Dokumentation beschreibt die verbindlichen Regeln, Berechtigungen, Gebühren und Algorithmen für die Weiterleitung (Weitergabe) von Schiedsrichteransetzungen beim RHTC (2. Herren) gemäß der Schiedsrichterordnung (§§ 1–8).

---

## 1. Grundprinzip & Verantwortlichkeit (§ 4)

1. **Persönliche Dienstpflicht:** Jeder aktive Spieler auf der Mannschaftsliste ist verpflichtet, die ihm zugewiesenen Schiedsrichter-Einsätze wahrzunehmen (§ 1 Abs. 1).
2. **Weiterleitungspflicht:** Wer an einem Termin verhindert ist, muss die Ansetzung unverzüglich über die Plattform weiterleiten. Ein einfaches Nicht-Erscheinen ist unzulässig.
3. **Befreiung aus der Pflicht:** Sobald die Weiterleitung im System ausgelöst wurde, ist der abgebende Spieler von der Schiedsrichterpflicht für diesen Termin befreit. Die Verantwortung geht auf den vom System ermittelten Nachfolger über (§ 4 Abs. 4).

---

## 2. Berechtigung: Wer darf weiterleiten?

Eine Weiterleitung kann im System ausschließlich ausgelöst werden durch:
- **Den aktuell eingeteilten Schiedsrichter** (`current_assignee_id`)
- **Die aktuell vorgeschlagene Person** (`pending_assignee_id`), falls die Ansetzung bereits weitergeleitet wurde
- **Den Schiedsrichterwart** oder **Administrator** (für administrative Eingriffe / Notfälle)

*Andere Spieler haben keinen Zugriff auf den Weiterleiten-Button dieser Ansetzung.*

---

## 3. Die 4 Arten der Weiterleitung (Gründe & Gebühren)

Beim Klick auf **`Weiterleiten ...`** muss die Art der Weitergabe ausgewählt werden:

| Art der Weitergabe | Rechtsgrundlage | Gebühr Weitergebender | Kassenanteil | Schiri-Prämientopf | Voraussetzung / Nachweis |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Reguläre Weitergabe** | § 5 Abs. 1 | **15,00 €** | 5,00 € | +10,00 € | Keine Voraussetzungen. Standardfall bei privater/beruflicher Verhinderung. |
| **Ehrenamtliche Befreiung** | § 7 | **0,00 €** | 0,00 € | 0,00 € | Im Spielerprofil muss `Ehrenamtliche Befreiung` durch den Vorstand aktiviert sein (z. B. Trainer, Schiriwart). |
| **Härtefallantrag** | § 8 | **15,00 €** *(vorläufig)* | 5,00 € | +10,00 € | Vertrauliche Begründung an Kassenwart (z. B. plötzliche Krankheit, Unfall, Todesfall). Kassenwart entscheidet über Erlass. |
| **Kader-Nominierung** | § 3 Abs. 5 / § 4.2 | **0,00 €** | 0,00 € | 0,00 € | Spieler steht im offiziellen Spielkader (1. oder 2. Herren) für dasselbe Spiel. |

---

## 4. Fristen & Pflichtangaben (< 48-Stunden-Regel)

- **Reguläre Frist (≥ 48 Stunden vor Anpfiff):**
  - Die Weiterleitung erfolgt ohne Sonderauflagen.
  - Das Textfeld *„Öffentlicher Hinweis“* ist optional.
- **Kurzfristige Weitergabe (< 48 Stunden vor Anpfiff gem. § 4 Abs. 2):**
  - Das System blendet einen Warnhinweis ein.
  - Das Feld *„Öffentlicher Hinweis / Verhinderungsgrund“* wird zum **Pflichtfeld**.
  - Der Grund wird im Revisionsprotokoll und in der Benachrichtigung für das Team vermerkt.

---

## 5. Algorithmus: Wie wird der Nachfolger ermittelt? (§ 1 Abs. 5 & § 3 Abs. 4)

Das System wählt vollautomatisch die nächste Person nach einem mehrstufigen Rotationsprinzip aus:

### A. Ausschlusskriterien (Wer kommt NICHT in Frage?)
1. **Der Weitergebende selbst**
2. **Alle bisherigen Weitergebenden** desselben Spielstrangs (kein Hin-und-Her-Kreisen)
3. **Schiedsrichter des Parallel-Slots** desselben Spiels (kein Spieler pfeift beide Slots gleichzeitig)
4. **Ehrenamtlich Befreite** (§ 7)
5. **Spieler, die für diese Weitergabe bereits abgelehnt haben** (`DECLINE`)
6. **Inaktive / ausgenommene Spieler** (`is_active_in_list = 0`)

### B. Priorisierung & Reihenfolge
1. **1. Priorität – Minimale Einsätze & frei:**
   Spieler mit den in der laufenden Saison **wenigsten geleisteten Einsätzen** (`deployedCount`), die aktuell für kein anderes Spiel angesetzt sind.
2. **2. Priorität – Minimale Einsätze (auch wenn zukünftig verplant):**
   Spieler mit den wenigsten Einsätzen, selbst wenn sie bereits für ein späteres Saisonspiel vorgemerkt sind.
3. **3. Priorität – Feste Listenreihenfolge (§ 2 Abs. 4):**
   Haben mehrere Spieler dieselbe minimale Einsatzanzahl, entscheidet:
   - Die hinterlegte manuelle Listen-Position (`list_order_override`)
   - Alphabetisch nach Nachname, dann Vorname

---

## 6. Reaktionsmöglichkeiten des Nachfolgers

Sobald die Weiterleitung erfolgt ist, steht der Slot auf **`PENDING_HANDOFF`**. Der vorgeschlagene Spieler sieht die Ansetzung in seinen Aufgaben und hat zwei Optionen:

### Option A: Annehmen (`ACCEPT`)
- Der Status wechselt auf **`CONFIRMED`** (grün).
- Der Nachfolger wird zum festen Schiedsrichter des Spiels ernannt.
- Eine automatische Benachrichtigung wird für die Mannschafts-WhatsApp-Gruppe bereitgestellt.

### Option B: Ablehnen / Verhindert (`DECLINE`)
- Wenn auch der vorgeschlagene Spieler verhindert ist, klickt er auf **`Ablehnen`** (mit kurzer Begründung).
- Das System erfasst ein Ereignis `HANDOFF_SKIPPED_UNAVAILABLE`.
- Das System sucht **ohne Verzögerung den übernächsten Spieler** nach denselben Rotationsregeln (unter Ausschluss aller bisherigen Beteiligten).
- Der Slot bleibt in `PENDING_HANDOFF` und wird an die neue Person übergeben.

---

## 7. Freiwillige Übernahme & Prämientopf (§ 5)

1. **Prämienakkumulation:** Bei jeder regulären Weitergabe wächst der Schiri-Topf des Spiels um **+10,00 €** (z. B. nach 2 Weitergaben: 20,00 € Prämie).
2. **Freiwilliges Angebot:** Jeder unbeteiligte Spieler kann über den Button **`Übernehmen (+X €)`** anbieten, das Spiel zu pfeifen.
3. **Entscheidungshoheit (§ 5 Abs. 3):**
   - Das Angebot kann **ausschließlich von der zuletzt vorgeschlagenen Person** angenommen oder abgelehnt werden.
   - Der ursprüngliche Schiedsrichter hat kein Widerspruchsrecht mehr.
4. **Auszahlungsgarantie (§ 5 Abs. 4):**
   - Die Prämie wird erst nach Spielende und nach offizieller Bestätigung durch den Schiriwart fällig.
   - Das Geld erhält **immer derjenige, der das Spiel tatsächlich gepfiffen hat** (`CONFIRMED_DEPLOYED`), unabhängig davon, wann er in die Kette eingestiegen ist.
5. **Bonusregel – Vorgezogene Entlastung (§ 5 Abs. 5):**
   - Wer freiwillig ein fremdes Spiel mit Prämie übernimmt, dessen **nächste eigene Ansetzung in der Zukunft wird automatisch und ohne 15 € Gebühr** an den nächsten Spieler der Liste weitergereicht.

---

## 8. Härtefallprüfung durch den Kassenwart (§ 8)

1. **Antrag:** Wird bei der Weitergabe `Härtefallantrag` gewählt, wird die 15,00 € Gebühr zunächst mit dem Status `PENDING` erfasst.
2. **Datenschutz:** Die vertrauliche Begründung kann **ausschließlich vom Kassenwart** und Admin eingesehen werden. Für alle anderen Spieler und in öffentlichen Übersichten steht lediglich der neutrale Vermerk *„Härtefallantrag gestellt“*.
3. **Entscheidung des Kassenwarts:**
   - **Genehmigen / Vollerlass:** Die 15 € Gebühr wird erlassen (`WAIVED`).
   - **Teilerlass:** Die Gebühr wird auf einen Teilbetrag reduziert.
   - **Ablehnen:** Die reguläre 15 € Gebühr bleibt zur Zahlung offen.
4. **Schutz des Prämientopfs:** Wird ein Härtefall bewilligt, gleicht die Mannschaftskasse den 10 € Prämientopf aus, damit der einspringende Schiedsrichter seine verdiente Prämie nicht verliert.
