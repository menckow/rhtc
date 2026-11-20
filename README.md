# RHTC II – Schiedsrichterverwaltung

Vollständige Web-Anwendung zur internen Verwaltung, Ansetzung, Weitergabe, Kasse und Dokumentation der Schiedsrichter der 2. Herrenmannschaft des RHTC auf Basis der Satzung.

---

## Features
* **Mobile UX & Desktop**: Vollwertige Oberfläche mit Tabs für Spielplan, Meine Spiele, Mannschaftsliste, Kassenbuch & Zahlungen, Admin & Import.
* **Satzungs-Konforme Ansetzungslogik**:
  * Automatische Zuweisung der alphabetisch nächsten freien Person (§ 1 Abs. 5, § 3 Abs. 4 & 7).
  * Reguläre Weitergabe (§ 4): 15,00 € (5,00 € Mannschaftskasse / 10,00 € Pott) + 48h-Frist-Erkennung.
  * Kostenfreie Ausnahmen: Kadernominierung (§ 3 Abs. 5) & Ehrenamtliche Tätigkeit (§ 7).
  * Freiwillige vorgezogene Übernahme (§ 5): Anfrage, Bestätigung & automatischer Vorab-Tausch.
  * Härtefallprüfung (§ 8): Vertrauliche Prüfung durch den Kassenwart.
  * WhatsApp- / Gruppenchat-Textgenerator für alle Ereignisse.
* **Import**: Schneller CSV-Import für Spiele und Spielerliste.

---

## Technische Architektur (Vercel + Supabase)
* **Frontend**: Responsive Single-Page-Application in `public/app.js` & `public/styles.css`, ausgeliefert über Next.js App Router (`src/app/page.tsx`).
* **Backend**: Serverless Next.js API-Routen unter `src/app/api/[...slug]/route.ts`.
* **Datenbank**: Supabase PostgreSQL (oder lokal SQLite).

---

## Setup & Lokaler Start

1. **Abhängigkeiten installieren**:
   ```bash
   npm install
   ```

2. **Lokal mit Next.js starten**:
   ```bash
   npm run dev
   ```
   Die App ist erreichbar unter `http://localhost:3000`.

3. **Alternativ (Standalone Node-Server)**:
   ```bash
   npm run server
   ```

---

## Supabase-Einrichtung

1. Öffne das [Supabase Dashboard](https://supabase.com/dashboard).
2. Gehe in den **SQL Editor** und führe das Migrationsskript aus:
   * [supabase/migrations/001_rhtc_schema_and_seed.sql](supabase/migrations/001_rhtc_schema_and_seed.sql)
   * Dieses Skript legt die Tabellen `seasons`, `users`, `games`, `assignment_chains` und `handoff_events` mit RLS-Policies und Startdaten an.

---

## Vercel Deployment

1. **Repository verknüpfen**:
   * Auf [vercel.com](https://vercel.com) neues Projekt anlegen und dieses GitHub-Repo auswählen.
   * Framework Preset: **Next.js**.

2. **Environment Variables**:
   In den Vercel Project Settings unter **Environment Variables** eintragen:
   * `NEXT_PUBLIC_SUPABASE_URL`: `https://hzjxprzxjhlhthnnnpif.supabase.co`
   * `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase Publishable / Anon Key
   * `SUPABASE_SERVICE_ROLE_KEY`: Supabase Secret Service Role Key
