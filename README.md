# Notetaker

Gespräche aufnehmen, mit Sprechererkennung transkribieren und als Protokoll auswerten:
Zusammenfassung, Entscheidungen, Terminplan und eine Follow-up-Tabelle – zum Versenden per E-Mail und zum Speichern.

Notetaker ist eine Web-App, die sich auf dem iPhone und auf dem Mac wie eine App installieren lässt.
Mit einem Konto (Supabase) werden Gespräche, Aufnahmen und das Stimmprofil zwischen den Geräten abgeglichen, und die API-Schlüssel
liegen auf dem Server statt auf dem Gerät. Ohne Konto arbeitet die App rein lokal mit eigenen Schlüsseln.

## Funktionen

- **Aufnahme** mit Pegelanzeige und Warnung bei zu leisem oder übersteuertem Ton, Pause, wählbarem Mikrofon und zwei Profilen (Gespräch im Raum / Headset).
  Lange Gespräche werden in 8-Minuten-Teilen gesichert, damit bei einem Absturz höchstens der laufende Teil verloren geht.
- **Online-Meetings am Mac** (Chrome/Edge): zusätzlich den Ton des Computers aufnehmen, damit auch die Gegenseite zu hören ist.
- **Transkription mit Sprechertrennung** (OpenAI `gpt-4o-transcribe-diarize`). Mit einem Stimmprofil (9 Sekunden, einmalig in den Einstellungen)
  werden die eigenen Beiträge unter dem eigenen Namen geführt; andere Sprecher lassen sich im Transkript benennen.
- **Protokoll** (Claude): Kurzfassung, Kernpunkte, Entscheidungen mit Begründung und Verantwortlichen, Terminplan, Follow-ups mit
  Verantwortlichen, Fälligkeit und Priorität, offene Fragen.
- **Versenden und Speichern**: E-Mail-Entwurf im Mailprogramm, Teilen mit Anhängen (iPhone/Mac), Kopieren mit Tabellen,
  Dateien: Protokoll als HTML (als PDF druckbar), Follow-ups als CSV für Excel, Termine als ICS für den Kalender.
- **Audiodatei importieren** (bis 25 MB), z. B. aus der Sprachmemos-App.

## Einrichtung

### Supabase (Konto, Abgleich, Schlüssel)

1. Schema einspielen: `supabase/migrations/` (Tabellen `meetings` und `profiles`, privater Speicher-Bucket `audio`, alles nur für den jeweiligen Besitzer lesbar).
2. Funktionen bereitstellen: `supabase/functions/transcribe` und `supabase/functions/anthropic`. Sie reichen Anfragen an OpenAI bzw. Anthropic weiter und fügen den Schlüssel hinzu.
3. Unter *Edge Functions → Secrets* drei Werte setzen: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` und `ALLOWED_EMAILS`
   (kommagetrennte Liste der E-Mail-Adressen, die auswerten dürfen – ohne diese Liste ist niemand freigeschaltet, denn registrieren kann sich jeder).
4. In der App unter Einstellungen registrieren, die Bestätigungs-E-Mail öffnen und anmelden.

### Cloudflare Pages (Hosting)

Im Cloudflare-Dashboard unter *Workers & Pages → Create → Pages → Connect to Git* dieses Repository wählen,
Build command `npm run build`, Build output directory `dist`. Danach wird jeder Push auf `main` automatisch veröffentlicht.
Projekt-URL und Publishable Key von Supabase stehen in `.env` (beide sind öffentlich); Umgebungsvariablen sind in Cloudflare nicht nötig.

### Auf den Geräten

Namen eintragen und das Stimmprofil aufnehmen (wird mit dem Konto abgeglichen). Installieren: auf dem iPhone in Safari über
„Teilen → Zum Home-Bildschirm“, auf dem Mac in Safari über „Ablage → Zum Dock hinzufügen“ (in Chrome über das Installieren-Symbol in der Adresszeile).

## Entwicklung

```bash
npm install
```

```bash
npm run dev
```

```bash
npm run build
```

## Grenzen

- Das iPhone beendet die Aufnahme, wenn die App in den Hintergrund geht oder der Bildschirm gesperrt wird. Die App hält den Bildschirm an;
  während der Aufnahme bitte nicht wechseln.
- Sprecher bleiben über die 8-Minuten-Teile hinweg für bis zu vier Personen zugeordnet; bei größeren Runden kann die Nummerierung
  weiterer Sprecher zwischen den Teilen wechseln.
- Der Abgleich läuft beim Öffnen der App und beim Zurückwechseln zu ihr, nicht in Echtzeit. Bei gleichzeitiger Bearbeitung auf zwei Geräten gewinnt die neuere Änderung.
- Vor der Aufnahme das Einverständnis aller Beteiligten einholen – das Aufzeichnen von Gesprächen ohne Zustimmung ist in Deutschland strafbar (§ 201 StGB).
