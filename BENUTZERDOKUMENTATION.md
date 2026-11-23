# RHTC Schiri-Ansetzungen – Benutzerdokumentation

> **RHTC II. Herren • Schiedsrichterverwaltung & Satzung (§§ 1–8)**  
> Umfassendes Benutzerhandbuch für Spieler, Schiedsrichterwart, Mannschaftskassenwart und Vorstand.

---

## Inhaltsverzeichnis
1. [Ziel & Überblick](#1-ziel--überblick)
2. [Rollen & Zugriffsrechte](#2-rollen--zugriffsrechte)
3. [Die Menübereiche im Überblick](#3-die-menübereiche-im-überblick)
4. [Ablauf & Regelwerk (§§ 1–8)](#4-ablauf--regelwerk-18)
   - [§ 1 & § 2: Grundsatz & Schiedsrichterliste](#-1--2-grundsatz--schiedsrichterliste)
   - [§ 3: Spielansetzungen](#-3-spielansetzungen)
   - [§ 4: Die Weitergabe (Handoff-Logik)](#-4-die-weitergabe-handoff-logik)
   - [§ 5: Freiwillige Übernahme & Auszahlungstöpfe](#-5-freiwillige-übernahme--auszahlungstöpfe)
   - [§ 6: Einsatzmeldung & Bestätigung](#-6-einsatzmeldung--bestätigung)
   - [§ 7 & § 8: Ehrenamtliche Befreiung & Härtefälle](#-7--8-ehrenamtliche-befreiung--härtefälle)
5. [Schritt-für-Schritt-Anleitungen](#5-schritt-für-schritt-anleitungen)
   - [Ansetzung annehmen](#schritt-1-ansetzung-annehmen)
   - [Spiel weitergeben](#schritt-2-spiel-weitergeben)
   - [Freiwillige Übernahme mit Prämie anfragen](#schritt-3-freiwillige-übernahme-mit-prämie-anfragen)
   - [Übernahme bestätigen (nur durch vorgeschlagenen Schiri)](#schritt-4-übernahme-bestätigen)
   - [Spiel als gepfiffen melden](#schritt-5-spiel-als-gepfiffen-melden)
   - [Persönlichen Kalender abonnieren (iCal)](#schritt-6-persönlichen-kalender-abonnieren-ical)
   - [Kassenwart: Gebühren verbuchen & Töpfe auszahlen](#schritt-7-kassenwart-gebühren-verbuchen--töpfe-auszahlen)
6. [Häufige Fragen (FAQ)](#6-häufige-fragen-faq)

---

## 1. Ziel & Überblick

Das Tool **Schiri-Ansetzungen** dient der vollautomatischen, fairen und transparenten Einteilung und Verwaltung der Vereinsschiedsrichter der 2. Herrenmannschaft des RHTC.

### Kernprinzipien
- **Chancengleichheit:** Automatische Auslosung und Rotation anhand der offiziellen Mannschaftsliste.
- **Transparenz:** Nachvollziehbare Kettenhistorie aller Weitergaben und Geldflüsse für alle Spieler.
- **Verlässlichkeit:** Verbindliche Bestätigung, klare Eskalationsstufen (< 48h) und lückenlose Einsatzdokumentation.
- **Fairer Topf:** Wer für ein fremdes Spiel einspringt, erhält nach dem Pfeifen die vom Abgeber eingezahlte Prämie.

---

## 2. Rollen & Zugriffsrechte

| Rolle | Symbol | Berechtigungen & Aufgaben |
|---|---|---|
| **Spieler (Player)** | 👤 | Eigene Ansetzungen einsehen, annehmen, weitergeben; unbesetzte Spiele übernehmen; Kalender-Sync; Lesezugriff auf Ketten und Spielplan. |
| **Schiedsrichterwart** | 🏑 | Spielplan importieren/erstellen; Schiedsrichter manuell zuweisen oder tauschen; gemeldete Einsätze offiziell bestätigen (§ 6.1); Schiedsrichterliste pflegen (§ 2). |
| **Kassenwart** | 💰 | Einsicht in offene Weitergabegebühren; Zahlungen als bezahlt verbuchen; Härtefallanträge prüfen & entscheiden (§ 8); Schiri-Prämien nach Einsatz auszahlen (§ 5.4). |
| **Vorstand** | 🏛️ | Ehrenamtliche Schiri-Befreiungen im Spielerprofil freigeben (§ 7); Gesamteinsicht aller Berichte. |
| **Admin** | ⚙️ | Vollzugriff auf alle Bereiche, Saisons, Benutzerverwaltung und Systemkonfiguration. |

---

## 3. Die Menübereiche im Überblick

Das Navigationsmenü öffnet sich mobil und auf dem PC über den Button **`☰ Menü`** oben links in der Topleiste:

```
┌────────────────────────────────────────────────────────┐
│ ☰ Menü   [RHTC-Logo] Schiri-Ansetzungen    Bereich: ▾  │
└────────────────────────────────────────────────────────┘
```

### 1. 🏑 Schiri-Ansetzungen (Hauptansicht)
- **Monats-Gruppierung:** Spiele gegliedert nach Monat (z. B. `NOVEMBER 2026`).
- **Datums-Badge:** Markanter dunkler Block mit Wochentag (gold), Tageszahl (weiß), Monat und relativem Countdown (`heute`, `morgen`, `in 5 Tagen`).
- **Spielkarten:** Begegnung, Spieltag/Regelhinweis (`1. Saisonspiel (§ 3 Abs. 3)`), Prämien-Hinweis (`+10,00 € Prämie im Topf`).
- **Schiedsrichter-Slots:** Slot-Nummer (`SR-001`), Schiedsrichtername (`(Du)`-Markierung) und farbige Status-Pille:
  - ◒ **Unbesetzt** (Grau)
  - ◐ **Unbestätigt** (Gelb/Amber)
  - ● **Bestätigt** (Grün)
  - ✔ **Gepfiffen / Bestätigt** (Dunkelgrün / Blau)
- **Split-Button (`[Aktion | ▾]`):**
  - **Klick auf Text:** Löst die kontextuell wichtigste Hauptaktion sofort aus (z. B. *Annehmen*, *Übernehmen*, *Weiterleiten*, *Übernahme bestätigen*).
  - **Klick auf Pfeil `▾`:** Öffnet das erweiterte Kontextmenü (*In Kalender eintragen*, *Als gepfiffen melden*, *Manuell zuweisen* etc.).

### 2. 📅 Kalender
- Interaktiver Monatskalender und chronologische Agenda-Liste aller Saisonspiele.
- Goldene Markierung für Spiele, bei denen man selbst eingeteilt ist.
- Direkt-Abo via persönlichem **iCal-Link** für iOS, macOS, Google Kalender und Outlook.

### 3. 📋 Meine Aufgaben
- Direkter Überblick aller persönlichen To-Dos:
  - Offene Ansetzungen, die noch bestätigt werden müssen.
  - Eingehende Übernahme-Anfragen anderer Spieler, die freigegeben werden müssen.

### 4. 🔄 Weitergabeketten (Für alle Spieler lesbar)
- Visueller Graph jeder Ansetzung von der Erstzuteilung über alle Weitergaben bis zum endgültigen Schiedsrichter.
- **Schnellfilter `Meine Ketten`:** Zeigt sofort alle Ketten an, an denen man selbst beteiligt ist.
- Transparente Anzeige von Gebühren (15 €), Kassenanteil (5 €) und Schiri-Topf (10 € je Weitergabe).
- *Datenschutz:* Vertrauliche Härtefallbegründungen sind für normale Spieler ausgeblendet.

### 5. 👥 Schiedsrichterliste (§ 2) *(Schiriwart & Admin)*
- Komplette Mannschaftsliste mit Einsatzzählern, aktiven Ansetzungen, Offenen Gebühren und Ehrenamts-Status.
- **Bearbeiten-Modal:** Administratoren und Schiedsrichterwarte können bei jedem Spieler:
  - Vor- und Nachname, E-Mail und Mobilnummer bearbeiten
  - Rolle und Berechtigungen festlegen
  - Status "Aktiv in Schiedsrichterliste" und "Ehrenamtliche Befreiung (§ 7)" umschalten
  - **Einsätze („eingesetzt“ nach § 1 Abs. 4 / § 2):** Die Anzahl der geleisteten Schiedsrichter-Einsätze kann bei Bedarf manuell angepasst/vorgegeben werden (wird bei manueller Korrektur mit `korr.` gekennzeichnet und direkt vom automatischen Zuteilungs-Algorithmus berücksichtigt).
  - Rotationsreihenfolge (Listen-Position) überschreiben
  - Passwort zurücksetzen

### 6. 💰 Kasse & Härtefälle *(Kassenwart & Admin)*
- **Statistik-Kacheln:** Kassenanteil, offene Forderungen, bezahlte Gebühren, offene Auszahlungstöpfe.
- **Tabelle Weitergabe-Zahlungen:** Status offener 15 € Gebühren und Härtefallprüfung.
- **Tabelle Auszahlungstöpfe:** Zeigt für jeden Strang den tatsächlichen Schiedsrichter und erlaubt die Auszahlung der Prämie nach bestätigtem Einsatz.
- CSV-Export für die Mannschaftskasse.

### 7. 📄 Dokumentation (§ 6) *(Schiriwart & Admin)*
- Revisionssicheres Protokoll aller Systemereignisse (Import, Zuweisung, Weitergabe, Härtefall, Auszahlung).

---

## 4. Ablauf & Regelwerk (§§ 1–8)

### § 1 & § 2: Grundsatz & Schiedsrichterliste
1. Jedes gemeldete Hallenspiel muss von **zwei Vereins-Schiedsrichtern** der 2. Herren gepfiffen werden.
2. Die Zuteilung erfolgt strikt nach der offiziellen Liste: Es werden immer diejenigen Spieler eingeteilt, die in der laufenden Saison die **wenigsten Einsätze** absolviert haben.
3. Bei gleicher Einsatzanzahl entscheidet die feste Listenreihenfolge.

### § 3: Spielansetzungen
1. Der Schiedsrichterwart importiert den Spielplan vor Saisonbeginn per CSV-Datei.
2. Die Schiedsrichter werden automatisch durch das System eingesetzt.
3. **Erstes Saisonspiel (§ 3 Abs. 3):** Beim 1. Saisonspiel wird der Ansetzungszyklus traditionell gestartet.

### § 4: Die Weitergabe (Handoff-Logik)
Wer einen angesetzten Termin nicht wahrnehmen kann, muss den Slot über die Plattform weitergeben:
1. **Reguläre Weitergabe:**
   - Kostet **15,00 € Schutzgebühr**.
   - Aufteilung: **5,00 €** fließen in die Mannschaftskasse, **10,00 €** wandern in den **Schiri-Auszahlungstopf** des jeweiligen Spiels.
2. **Kurzfristige Weitergabe (< 48 Stunden vor Anpfiff nach § 4 Abs. 2):**
   - Erfordert zwingend die Angabe eines triftigen Verhinderungsgrundes im Textfeld.
3. **Nächste Person in der Kette:**
   - Das System ermittelt automatisch den nächsten verfügbaren Spieler mit den wenigsten Einsätzen.
   - Der abgebende Spieler scheidet damit aus der Verantwortung aus!

### § 5: Freiwillige Übernahme & Auszahlungstöpfe
1. Hat ein Spiel durch Weitergaben einen gefüllten Topf (z. B. 10 € oder 20 €), können andere Spieler die **freiwillige Übernahme** anfragen.
2. **Autoritätsregel:** Die Übernahme kann **ausschließlich von der zuletzt vorgeschlagenen Person** genehmigt oder abgelehnt werden (oder administrativ durch den Schiriwart). Der ursprüngliche Schiedsrichter hat kein Mitspracherecht mehr.
3. **Auszahlungsregel (§ 5 Abs. 4):** Die Prämie steht **immer und ausnahmslos** demjenigen Schiedsrichter zu, der das Spiel bestätigt übernommen und **auch tatsächlich gepfiffen hat**.
4. **Vorgezogene Übernahme (§ 5 Abs. 5):** Wer freiwillig ein fremdes Spiel übernimmt, dessen nächste eigene Ansetzung in der Zukunft wird automatisch und **kostenlos** an den nächsten Spieler weitergegeben!

### § 6: Einsatzmeldung & Bestätigung
1. **Nach Spielende:** Der Schiedsrichter meldet das Spiel über den Button *„Als gepfiffen melden (§ 6.2)“*.
2. **Offizielle Bestätigung:** Der Schiedsrichterwart prüft den Spielbericht und bestätigt den Einsatz (*„Einsatz bestätigen (§ 6.1)“*).
3. **Auszahlung:** Nach Bestätigung gibt der Kassenwart den angesammelten Topf an den Schiri frei.

### § 7 & § 8: Ehrenamtliche Befreiung & Härtefälle
- **§ 7 Ehrenamt:** Vorstandsmitglieder, Jugendtrainer oder Schiedsrichterwarte können durch den Vorstand freigestellt werden; Weitergaben erfolgen dann ohne 15 € Gebühr.
- **§ 8 Härtefall:** Bei unverschuldeten Notfällen (Krankheit, Verletzung, Trauerfall) kann bei der Weitergabe ein Härtefallantrag mit vertraulicher Begründung gestellt werden. Der Kassenwart entscheidet über Teilerlass oder Vollerlass der Gebühr.

---

## 5. Schritt-für-Schritt-Anleitungen

### Schritt 1: Ansetzung annehmen
1. Gehe auf **`Schiri-Ansetzungen`** oder **`Meine Aufgaben`**.
2. Suche deine Karte (gelbe Pille *„Unbestätigt“* oder *„Vorgeschlagen“*).
3. Klicke direkt auf den schwarzen Haupt-Button **`Annehmen`**.
4. Der Status wechselt sofort auf grün **`● Bestätigt`**.

---

### Schritt 2: Spiel weitergeben
1. Klicke auf deiner Spielkarte auf den Pfeil **`▾`** des Split-Buttons und wähle **`Weiterleiten ...`**.
2. Wähle den Grund:
   - *Reguläre Weitergabe (15,00 €)*
   - *Härtefallantrag gem. § 8 (mit vertraulicher Begründung)*
   - *Ehrenamtliche Befreiung gem. § 7 (sofern freigeschaltet)*
3. Falls das Spiel in weniger als 48 Stunden stattfindet: Kurze Begründung ins Textfeld eingeben.
4. Klicke auf **`Weitergeben & nächsten Schiri bestimmen`**.
5. Das System wählt den nächsten Schiri aus und generiert eine fertige WhatsApp-Nachricht zur Information der Mannschaft.

---

### Schritt 3: Freiwillige Übernahme mit Prämie anfragen
1. In der Übersicht **`Schiri-Ansetzungen`** siehst du Spiele mit Prämie (z. B. `+10,00 € Prämie im Topf`).
2. Klicke beim unbestätigten Slot auf den Button **`Übernehmen (+10,00 €)`**.
3. Deine Anfrage wird registriert; der aktuell vorgeschlagene Schiri erhält eine Benachrichtigung.

---

### Schritt 4: Übernahme bestätigen
*(Nur für die Person, an die das Spiel zuletzt weitergegeben wurde)*
1. Wenn jemand anbietet, dein unbestätigtes Spiel zu übernehmen, erscheint auf der Karte: **`Übernahme durch [Name] angefragt`**.
2. Klicke direkt auf den Button **`Übernahme bestätigen`**.
3. Der anfragende Spieler wird als fester Schiedsrichter eingetragen; du bist von dem Termin befreit!
4. *(Alternativ über das Menü `▾`: `Übernahme ablehnen`, falls du das Spiel doch selbst pfeifen möchtest).*

---

### Schritt 5: Spiel als gepfiffen melden
1. Öffne nach Spielende die Spielkarte in **`Schiri-Ansetzungen`**.
2. Klicke auf den Menüpfeil **`▾`** und wähle **`Als gepfiffen melden (§ 6.2)`**.
3. Der Status springt auf **`✔ Gepfiffen`**. Der Schiriwart wird über den Einsatz informiert.

---

### Schritt 6: Persönlichen Kalender abonnieren (iCal)
1. Öffne das Menü **`☰`** und wähle **`👤 Mein Profil`** oder **`📅 Kalender`**.
2. Klicke auf **`Kalender abonnieren`**.
3. Kopiere die Webcal-/ICS-URL in deine Kalender-App (Apple Kalender, Google Kalender, Outlook).
4. Alle deine bestätigten Spiele synchronisieren sich ab sofort vollautomatisch!

---

### Schritt 7: Kassenwart: Gebühren verbuchen & Töpfe auszahlen
1. Öffne den Bereich **`💰 Kasse & Härtefälle`**.
2. **Gebühren eingezahlt:** Klicke bei bezahlter Überweisungsgebühr auf **`Als bezahlt verbuchen`**.
3. **Prämie auszahlen:** Sobald ein Spiel mit Topf vom Schiriwart bestätigt wurde (`Gepfiffen`), klicke in der Tabelle der Auszahlungstöpfe auf **`An [Schiri] auszahlen`**.

---

## 6. Häufige Fragen (FAQ)

#### F: Ich habe mein Spiel weitergegeben. Warum steht mein Name noch in den Weitergabeketten?
**A:** In den Weitergabeketten wird transparent die Historie dargestellt, wer das Spiel ursprünglich hatte und an wen es weitergereicht wurde. In den aktiven Ansetzungen ist jedoch sofort die neue Person eingeteilt.

#### F: Wann erhalte ich meine Prämie für ein übernommenes Spiel?
**A:** Die Auszahlung erfolgt nach Spielende, sobald du das Spiel als gepfiffen gemeldet hast und der Schiriwart den Einsatz bestätigt hat. Der Kassenwart überweist bzw. händigt dir den Betrag dann aus.

#### F: Kann ich ein Spiel weitergeben, wenn ich gar keine 15 € zahlen kann?
**A:** Wenn ein unverschuldeter Notfall vorliegt (z. B. plötzliche Krankheit oder familiärer Notfall), wähle bei der Weitergabe die Option *„Härtefallantrag (§ 8)“* und trage deine Begründung ein. Der Kassenwart prüft den Antrag vertraulich.

#### F: Wie kopiere ich Spielinfos für die WhatsApp-Gruppe?
**A:** Klicke auf einer beliebigen Spielkarte oben rechts auf das Dreipunkt-Menü **`···`** und wähle **`WhatsApp-Nachricht kopieren`**. Der fertige Text liegt sofort in deiner Zwischenablage.
