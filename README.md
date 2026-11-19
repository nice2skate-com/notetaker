# Notetaker

Gespräche aufnehmen, mit Sprechererkennung transkribieren und als Protokoll auswerten:
Zusammenfassung, Entscheidungen, Terminplan und eine Follow-up-Tabelle – zum Versenden per E-Mail und zum Speichern.

Notetaker ist eine Web-App, die sich auf dem iPhone und auf dem Mac wie eine App installieren lässt. Es gibt keinen eigenen Server:
Aufnahmen und Protokolle liegen im Browser des jeweiligen Geräts; Audio geht nur zur Transkription an OpenAI, das Transkript nur zur Zusammenfassung an Anthropic.

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

1. In den Einstellungen zwei API-Schlüssel eintragen: [OpenAI](https://platform.openai.com/api-keys) für die Transkription und
   [Anthropic](https://console.anthropic.com/settings/keys) für die Zusammenfassung. Beide Dienste rechnen nach Verbrauch ab.
2. Namen eintragen und das Stimmprofil aufnehmen.
3. Installieren: auf dem iPhone in Safari über „Teilen → Zum Home-Bildschirm“, auf dem Mac in Safari über „Ablage → Zum Dock hinzufügen“
   (in Chrome über das Installieren-Symbol in der Adresszeile).

## Bereitstellung

Die App braucht eine HTTPS-Adresse. Der mitgelieferte Workflow `.github/workflows/deploy.yml` veröffentlicht sie bei jedem Push auf `main`
über GitHub Pages (im Repository unter *Settings → Pages → Source: GitHub Actions* aktivieren; bei kostenlosen GitHub-Konten muss das
Repository dafür öffentlich sein). Der Code enthält keine Schlüssel. Jeder andere statische Hoster (Netlify, Vercel, Cloudflare Pages)
funktioniert ebenso mit `npm run build` und dem Ordner `dist`.

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
- Es gibt keine automatische Synchronisierung zwischen Geräten. Protokolle lassen sich per Backup (Einstellungen) übertragen.
- Vor der Aufnahme das Einverständnis aller Beteiligten einholen – das Aufzeichnen von Gesprächen ohne Zustimmung ist in Deutschland strafbar (§ 201 StGB).
