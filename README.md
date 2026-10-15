# Minecraft-HUD für Claude Code

Eine Mod, die deine Nutzung als originalgetreues Minecraft-HUD (Java Edition) über dem Prompt zeigt. In der Desktop-App erscheinen die echten Sprites, im Terminal eine reduzierte Zeile aus farbigen Zeichen, die sich auch abschalten lässt.

> **Öffentlicher Quellcode, keine mitgelieferten Minecraft-Assets.** Die Mod nutzt lokal bezogene Mojang-Sprites und Schrift. Der Code liegt in [`ron-mandic/cc-mod-minecraft-hud`](https://github.com/ron-mandic/cc-mod-minecraft-hud); installiert wird nach dem lokalen Asset-Abruf aus dem Marketplace `ron-mandic`. Siehe [Assets und Veröffentlichung](#assets-und-veröffentlichung).

## Kurzanleitung

- **User-weite Installation:** `minecraft-hud@ron-mandic` gilt nach der Installation mit `--scope user` in jedem Repo. Neue Sitzungen laden die Mod automatisch, eine offene Sitzung mit `/reload-plugins`.
- **Geändert?** Version in `plugin.json` erhöhen, `claude plugin update minecraft-hud@ron-mandic`, neu starten.
- **`/hud`** zeigt einen kurzen Status ohne Icons (normalerweise vier Zeilen).
- **`/hud details`** zeigt ausführliche Erklärungen und Einstellungen, ebenfalls ohne Icons; `/hud hilfe` zeigt die Befehle.
- **`/hud aus`** oder **`/hud an`** schaltet nur für das aktuelle Repo.
- **`/hud terminal aus`** blendet sie nur in der CLI aus.
- **`/hud größe auto|1|1.5|2|3`** und **`/hud zahlen voll|kurz|aus`** ändern Größe und Spalten.
- **Ganz aus:** `claude plugin disable minecraft-hud@ron-mandic` (überall) oder mit `--scope local` (nur im aktuellen Repo).

Eine Desktop-Vorschau lässt sich nach dem lokalen Asset-Abruf mit `bun plugins/minecraft-hud/tools/preview.ts` erzeugen und unter `docs/preview.html` öffnen. Bilder werden nicht veröffentlicht, weil sie Mojang-Sprites enthalten.

Im Terminal (reduziert, eine Zeile; Balken links, Werte rechts):

```
♥♥♥♥♥♥♥♥♥♡ ◆◆◆◆◆◆◆◆◆◆ ━━━━49━━━━ ◑●●●●●●●●●     Sitzung 6 % · Reset 16:30   Fable 0 %   Kontext 49 %
```

## Was du siehst

| Im HUD | Zeigt | Verhalten wie im Spiel |
| :- | :- | :- |
| **Herzen** (links) | 7-Tage-Limit über alle Modelle: übrige Herzen = übriges Wochenbudget. Jedes halbe Herz entspricht 5 %. | Ab 2 Herzen (≥ 80 % genutzt) zittern sie. Steigt die Nutzung um ein halbes Herz, blinken sie wie bei Schaden. Nach einem Reset läuft die Regenerations-Welle durch. |
| **Rüstung** (über den Herzen) | Fable-Wochenlimit, übrige Haltbarkeit | Bei 100 % verschwindet die Rüstung ganz, wie im Spiel ohne Rüstung. |
| **Hunger** (rechts, füllt von rechts) | Sitzungslimit, also das 5-Stunden-Fenster | Ab 80 % genutzt schüttelt sich die Leiste (keine Sättigung mehr). Bei 100 % wird sie grün (Hunger-Effekt). |
| **Luftblasen** (über dem Hunger) | Ausschließlich Sonnet-Wochenbudget, übriger Vorrat | Erscheinen bei aktuellen Sonnet-Limitdaten mit Nutzung über 0 %, unabhängig vom gerade gewählten Modell. Kein Ersatz durch Opus. Bei 100 % wackeln leere Blasen (du ertrinkst). |
| **XP-Leiste + Level** | Kontextfenster: Füllstand und Prozent als grüne Level-Zahl | Die Zahl ist in der Minecraft-Schrift mit schwarzem Rand gesetzt, genau wie im Spiel. |

Rechts neben dem HUD steht pro Wert eine Spalte in der **Minecraft-Schrift**, mit dem Textschatten des Spiels. Jede Spalte hat drei Zeilen, die genau auf den drei HUD-Reihen liegen: oben das Label, in der Mitte der Wert, unten das Detail. Die Zeilen liegen 10 Pixel auseinander, also mit Luft dazwischen.

| Spalte | Wert | Detail |
| :- | :- | :- |
| **Sitzung** | 5-Stunden-Limit, genutzt | `16:30`, die lokale Uhrzeit des Resets |
| **Woche** | 7-Tage-Limit, genutzt | `Mi 00:00` |
| **Fable** | Fable-Wochenlimit, genutzt | `Mi 00:00` |
| **Sonnet** | nur bei aktuellen Budgetdaten mit Nutzung über 0 % | Wochentag und Uhrzeit |
| **Kontext** | Kontextfenster, belegt; im neuen Chat zunächst `0 %` | `98K / 200K` (Tokens), ab einer Million `785K / 1M`; vor der ersten Messung `0 / 1M`, sofern die Fenstergröße bekannt ist, sonst `0 Tokens` |

Eine einzige feine senkrechte Linie (Label-Grau, 30 % Deckkraft) trennt **Sitzung** vom **Wochenblock** (Woche, Fable und ggf. Sonnet). Sie sitzt mittig zwischen dem sichtbaren Textende der Sitzung und dem ersten Wochenwert. Fehlt „Woche“, bleibt sie vor Fable bzw. Sonnet; fehlt die Sitzung oder der gesamte Wochenblock, entfällt sie. Zwischen Sitzung und Kontext allein steht also keine Linie. Nur in der Desktop-App, das Terminal bleibt unverändert.

Im Desktop-Band entfallen Füllwörter: Uhrzeiten ohne „Reset“, Token-Verhältnis mit `/`. CLI und `/hud` nennen Reset-Zeiten weiterhin ausdrücklich; `/hud details` zeigt Token-Zahlen ungekürzt. Das normale `/hud` verzichtet auf Icons, Befehlsliste, Einstellungsblock und reguläre Quellenangabe; Datenprobleme werden weiterhin kurz gemeldet. Labels und Details sind dunkelgrau, Werte hellgrau, beide ruhiger als die Sprites. Das Band ist ein **transparentes Bild** auf hellem und dunklem Theme. Ab 90 % zeigt die Mod einen einmaligen Hinweis pro Limit-Fenster, etwa „Dein Hunger-Balken ist fast leer …“.

## Breite und Größe

Das Band ist ein einziges SVG mit selbst berechnetem `space-between`: **HUD · Sitzung | Woche Fable Sonnet Kontext**. Alle Textspalten rechts vom Strich bilden eine gemeinsame Anzeigegruppe: feste 24 px Abstand zwischen ihren reservierten Spaltenbreiten, auch wenn Woche oder Sonnet bei schmalem Fenster entfallen. Kontext bekommt keinen eigenen wachsenden Außenabstand mehr. Für die Trennung zur Sitzung sind mindestens 64 px reserviert, damit auf beiden Seiten des Strichs mehr Luft bleibt als innerhalb der rechten Gruppe. Zwischen HUD und Text sind mindestens 32 px Platz; nur die äußeren Gruppenabstände wachsen mit der Chatbreite. Platzbedarf und Zeichnung verwenden dieselben Gruppenregeln.

- **Standard:** feste Größe **1,5**, auch in neuen Repos und Chats (42 px Bandhöhe). Zusätzliche Breite wächst in die Abstände, nicht in die Icons. Optional wählt `auto` Größe **2**, wenn HUD und alle Spalten hineinpassen, sonst **1,5**. Die Pixel-Art wird nie stufenlos skaliert.
- **Was bei Enge wegfällt,** in dieser Reihenfolge: das Wochen-Reset (der Fable-Reset gilt meist auch für die Woche), die Sonnet-Spalte, das Fable-Reset, die Wochen-Spalte, die Tokens, die Fable-Spalte. Danach folgen das Sitzungs-Reset und die Kontext-Spalte (den Kontext zeigt das XP-Level weiter an), zuletzt die Sitzung.
- **Die Spalten springen nicht:** Jede Spalte reserviert die Breite ihrer längsten Form (`100 %`, `Mi 00:00`, beim Kontext `000K / 1M` bzw. `000K / 200K`). Die kürzeren Texte sparen auch tatsächlich reservierten Platz.

Fable folgt derselben Abstandsregel wie alle anderen rechten Spalten und braucht keine nachträgliche Sonderzentrierung mehr. Die Textzeilen bleiben linksbündig. Bei Enge gilt weiterhin die bestehende Ausblendungsreihenfolge; die sichtbaren Spalten bleiben in derselben Gruppe.

Die Umschaltpunkte hängen von den vorhandenen Werten ab (z. B. Sonnet-Spalte und Fenstergröße). Die lokale Vorschau zeigt mehrere Breiten mit 200K- und 1M-Kontext; die kürzeren Uhrzeiten und Token-Verhältnisse lassen Details länger sichtbar bleiben.

Die Breite des Bands kennt die Mod in Zellen der Code-Schrift (`bodyColumns`). `CELL_PX` oben in `hooks/desktop.ts` rechnet sie in Pixel um (7,8 px je Zelle). `/hud debug` zeigt, wie viele Zellen dein Band hat.

## Woher die Zahlen kommen

- **5 Stunden, 7 Tage und Kontext** kommen aus `$.session.usage()` und `session.measure`. Das sind dieselben Werte wie in der Statuszeile, aus den Antwort-Headern jeder API-Antwort. Kostenlos, ohne zusätzliche Anfrage.
- **Fable (und Sonnet)** kommen aus dem undokumentierten Endpoint `GET https://api.anthropic.com/api/oauth/usage`, den auch `/usage` liest. Fable steht dort in `limits[]` als `weekly_scoped` mit `scope.model.display_name = "Fable"`. Ältere Felder wie `seven_day_*` werden ebenfalls gelesen. Die Mod fragt den Endpoint mit dem Login der laufenden Sitzung über `$.session.authorize()` und `$.http.fetch`. Der Token bleibt dabei in Claude Code und erreicht den Mod-Code nie.
- **Abfragehäufigkeit**: nach einem Turn höchstens alle 2 Minuten (nach einem Fable-Turn alle 60 Sekunden), im Leerlauf alle 5 Minuten. Alle offenen Sitzungen teilen sich ein Ergebnis über `$.store`, mehrere Fenster fragen also nicht öfter. Bei `429` wartet die Mod 10 Minuten, bei `401`/`403` 30 Minuten.
- Ist ein Reset-Zeitpunkt vorbei, gilt der alte Budgetwert als unbekannt, bis die Datenquelle den neuen Zeitraum bestätigt. Das HUD nimmt nicht mehr automatisch ein volles Budget an.
- Budgetmessungen sind höchstens **15 Minuten** gültig. Frische Sitzungswerte bleiben nutzbar, wenn nur der Endpoint ausfällt; Kontextdaten sind von dieser Altersgrenze ausgenommen. Bei längeren eigenen Abfrageintervallen kann die Budgetanzeige bis zum nächsten Abruf unbekannt werden.

**Unbekannt ist nicht voll und nicht verbraucht:** Fehlen aktuelle Wochen- oder Sitzungsdaten, zeigt das Desktop-HUD abgeblendete leere Konturen mit einem `?`, ohne Schaden-, Hunger- oder Heilanimation. Die CLI zeigt ebenfalls abgeblendete Konturen mit Fragezeichen. Nicht bekannte Budgetspalten entfallen; `/hud` erklärt „unbekannt (keine aktuellen Daten)“, `/hud debug` nennt den Budgetstatus. Rüstung und Luftblasen bleiben ohne passende Daten ausgeblendet. Frisch bestätigte `0 %` Nutzung zeigt dagegen einen vollen Vorrat.

**Neue Fable-/Sonnet-Versionen:** Die Erkennung orientiert sich am Familiennamen, nicht an einer Versionsliste. Namen wie `Claude Fable 6` oder `claude-sonnet-6-1` werden automatisch zu Fable bzw. Sonnet zusammengeführt; auch ältere Cache-Namen werden berücksichtigt. Voraussetzung sind passende Budgetdaten mit erkennbarem Familiennamen. Ein völlig anderer Name oder ein geändertes Datenformat kann eine Anpassung erfordern. Das ist keine Modellankündigung: Es gibt keine Veröffentlichungserkennung oder Verfügbarkeitsbenachrichtigung.

> Der Endpoint ist nicht dokumentiert und kann sich jederzeit ändern. Bei Ausfällen bleiben nur noch gültige Messungen sichtbar; fehlende oder veraltete Budgets werden als unbekannt behandelt.

## Installieren

Die Installation mit `--scope user` aktiviert die Mod benutzerweit (`~/.claude/settings.json` → `enabledPlugins`). Der Marketplace `ron-mandic` verweist auf den gewählten lokalen Klon. Claude Code installiert eine **Kopie** der Version aus `plugin.json` nach `~/.claude/plugins/cache/ron-mandic/`.

Nach einer Änderung hier: `version` in `plugins/minecraft-hud/.claude-plugin/plugin.json` erhöhen, dann

```bash
claude plugin update minecraft-hud@ron-mandic
```

Danach Claude Code neu starten oder `/reload-plugins` ausführen.

So geht es auf einem anderen Mac oder nach einer Neuinstallation:

```bash
gh repo clone ron-mandic/cc-mod-minecraft-hud "$HOME/projects/cc-mod-minecraft-hud"
```

```bash
claude plugin marketplace add "$HOME/projects/cc-mod-minecraft-hud"
```

```bash
python3 "$HOME/projects/cc-mod-minecraft-hud/plugins/minecraft-hud/tools/fetch_assets.py"
```

```bash
claude plugin install minecraft-hud@ron-mandic --scope user
```

Der dritte Befehl holt die Sprites von Mojangs Servern. Nach einem frischen Klon ist er nötig, weil die Assets nicht in Git stehen. Direkt vom GitHub-Repo zu installieren geht deshalb nicht: Claude Code würde den Klon ohne Assets laden. Statt `--scope user` installiert `--scope local` die Mod nur im aktuellen Repo, Eintrag in `.claude/settings.local.json`. Ob sie läuft, zeigt `/plugin` mit der Zeile `1 mod active · minecraft-hud`.

> Verschiebst du diesen Ordner, führe `claude plugin marketplace remove ron-mandic` aus und danach `add` mit dem neuen Pfad. `remove` deinstalliert die Mod, installiere sie danach also neu.

## Ein- und ausschalten

| Ich will … | So geht's | Wirkung |
| :- | :- | :- |
| das HUD **in diesem Repo** aus/an | `/hud aus` · `/hud an` | Sofort und dauerhaft für dieses Repo (Schlüssel: das Git-Root). Die Mod bleibt geladen, zeichnet aber nichts und fragt nichts ab. |
| die Mod **in einem Repo komplett** entladen | `claude plugin disable minecraft-hud@ron-mandic --scope local` (im Repo ausführen) | Schreibt `false` in `.claude/settings.local.json` dieses Repos. Zurück mit `claude plugin enable … --scope local`. |
| **im Terminal (CLI)** nichts sehen | `/hud terminal aus` | Die Desktop-App zeigt das HUD weiter. |
| im Terminal **nur Text** in der Statuszeile | `/hud terminal status` | Keine zusätzliche Zeile: `Sitzung 6 % · Reset 16:30 · Woche 16 % · Fable 0 % · Kontext 49 %` |
| im Terminal die **reduzierte Zeile** (Standard) | `/hud terminal kompakt` | Eine farbige Zeile ohne Sprites: Balken links, Werte rechts, bei schmalem Fenster nur die wichtigsten Werte. |
| das HUD **überall** aus | `/hud global aus` | Repos mit eigenem `/hud an` bleiben an. |
| die Mod **überall** deaktivieren | `claude plugin disable minecraft-hud@ron-mandic` | Wieder an mit `enable`. Komplett weg mit `claude plugin uninstall minecraft-hud@ron-mandic`. |
| **alle** Mods für eine Sitzung aus | `claude --safe-mode` | Schaltet auch deine anderen Anpassungen ab. |
| alles auf Anfang | `/hud reset` | Löscht deine `/hud`-Einstellungen (global und für dieses Repo). |

Der Vorrang ist `local` > `project` > `user`: Ein `false` im Repo schlägt ein `true` aus deinen Benutzer-Einstellungen.

## Anpassen

### Mit `/hud`, sofort, in Desktop-App und Terminal

| Befehl | Was |
| :- | :- |
| `/hud` | Kurzer Status ohne Icons: Herzen/Woche, Rüstung/Fable, Hunger/5 Std. und Kontext; Sonnet nur bei gemeldeter Nutzung |
| `/hud details` | Ausführliche Bedeutung, volle Token-Zahlen, Quelle und Einstellungen; ebenfalls ohne Icons |
| `/hud größe auto` · `1` · `1.5` · `2` · `3` | Größe in der Desktop-App. Standard: fest 1,5. Optional wählt `auto` 2, wenn alles in die Breite passt, sonst 1,5. Feste Werte gelten immer, `1` ist am kleinsten (HUD 182 × 28 px). |
| `/hud zahlen voll` · `kurz` · `aus` | Die Spalten neben dem HUD: mit Reset-Uhrzeit und Tokens (Standard), nur die Prozente, oder keine |
| `/hud warnungen an` · `aus` | Hinweise ab 90 % |
| `/hud refresh` | Usage-Endpoint sofort abfragen |
| `/hud debug` | Welche Felder der Endpoint lieferte, letzter Fehler, Repo-Schlüssel |

### Als Plugin-Optionen (Standardwerte)

Dieselben Einstellungen gibt es als Optionen der Mod: im Terminal unter `/config`, oder über `/plugin` → minecraft-hud → **Configure options**. Sie landen in `~/.claude/settings.json`:

```json
{
  "pluginConfigs": {
    "minecraft-hud@ron-mandic": {
      "options": {
        "desktop_scale": "1.5",
        "terminal_style": "compact",
        "numbers": "full",
        "warnings": true,
        "refresh_minutes": 5
      }
    }
  }
}
```

Was du mit `/hud` setzt, hat Vorrang vor diesen Optionen. `/hud reset` macht die Optionen wieder maßgeblich.

> `/hud`-Einstellungen speichert jede Installation für sich. Was du in dieser Hot-Reload-Testsitzung einstellst, setzt du nach der dauerhaften Installation einmal neu.

### Im Code

Die Mod liegt in `plugins/minecraft-hud/` (Hinweise für Agenten in [CLAUDE.md](CLAUDE.md)):

| Datei | Inhalt |
| :- | :- |
| `hooks/register.tsx` | Hooks, `/hud`, Abfrage des Endpoints, Zeichnen im Band über dem Prompt |
| `hooks/usage.ts` | Endpoint-Antwort lesen, Werte zusammenführen. **Welche Leiste was zeigt**, steht in `merge()`: `fable` → Rüstung, `air` → Luft, `week` → Herzen, `session` → Hunger. |
| `hooks/desktop.ts` | Die SVGs: das HUD im Vanilla-Layout mit Animationen und je Spalte ein Bild in Minecraft-Schrift. `layoutBand()` wählt Größe und Spalten, `GIVE_UP` legt fest, was bei Enge zuerst wegfällt. Farben, `MIN_GAP_PX` und `CELL_PX` stehen oben in der Datei. |
| `hooks/terminal.ts` | Die reduzierte Terminal-Zeile: Zeichen, Farben und welche Werte bei schmalem Fenster bleiben |
| `hooks/text.ts` | Alle deutschen Texte: die Spalten (`columnsOf`), die Reset-Uhrzeiten (`resetText`), die `/hud`-Ausgabe |
| `assets/…` | Die Original-PNGs aus Minecraft 26.3, die Schrift-Sheets und Mojangs Zeichentabelle `font/include/default.json`. Nicht in Git, siehe [Assets und Veröffentlichung](#assets-und-veröffentlichung). |
| `tools/fetch_assets.py` | Holt die Assets aus Mojangs offiziellem `client.jar` (SHA-1 geprüft) und baut `hooks/sprites.ts` neu. `--version latest` nimmt die neueste Minecraft-Version. |
| `tools/build_sprites.py` | Macht aus den PNGs `hooks/sprites.ts`. Eigene PNGs (etwa aus einem Resource Pack) einfach austauschen und `python3 tools/build_sprites.py` ausführen. |

Nach einer Änderung im Terminal prüfen:

```bash
claude plugin validate "$HOME/projects/cc-mod-minecraft-hud/plugins/minecraft-hud"
```

```bash
claude plugin test "$HOME/projects/cc-mod-minecraft-hud/plugins/minecraft-hud"
```

Danach Version erhöhen, `claude plugin update minecraft-hud@ron-mandic` ausführen und neu starten (siehe [Installieren](#installieren)). `bun plugins/minecraft-hud/tools/preview.ts` zeigt das Band vorher in `docs/preview.html` bei mehreren Chatbreiten. Am bequemsten: Claude bitten („Mach die Rüstung zur Opus-Nutzung“). Der eingebaute Skill `plugin-authoring` kennt die Mods-API und lädt Änderungen per Hot-Reload.

## Terminal (CLI): Voraussetzungen

- Mods benötigen Claude Code **2.1.287 oder neuer**. Die lokale Version lässt sich mit `claude --version` prüfen.
- Plan-Limits setzen einen passenden Login voraus. Status mit `claude auth status` prüfen, bei Bedarf mit `claude auth login` anmelden.
- Die Desktop-App bringt ihre eigene Claude-Code-Version mit; Desktop und CLI daher getrennt prüfen.

## Wenn etwas nicht stimmt

- **Kein HUD**: `/plugin` muss `1 mod active · minecraft-hud` zeigen. Läuft `/hud aus` im Repo? `/hud details` zeigt die Einstellungen.
- **Keine Rüstung**: `/hud debug` zeigt, was der Endpoint lieferte (`Felder: …`) und warum er schwieg (`Problem: …`).
- **Fehler der Mod**: `claude --debug`, dann im Debug-Log nach `minecraft-hud` suchen.

## Assets und Veröffentlichung

Die Sprites und die Schrift gehören Mojang/Microsoft und stammen unverändert aus dem offiziellen Client (`client.jar` 26.3, `piston-data.mojang.com`). Sie sind nur für deinen persönlichen Gebrauch gedacht. Deshalb gilt:

- Veröffentlicht wird ausschließlich der Quellcode, ohne Mojang-Sprites, Schriftdateien oder daraus erzeugte Vorschauen.
- Installiert wird aus dem **lokalen Ordner**, nachdem `tools/fetch_assets.py` die benötigten Assets direkt von Mojang bezogen hat.
- `.gitignore` hält `assets/`, die daraus erzeugte `hooks/sprites.ts` und Vorschaubilder aus Git heraus. Keine Asset-Dateien, generierten Sprite-Module oder Pakete mit diesen Inhalten hochladen.
- Für die Nutzung der Minecraft-Assets gelten Mojangs Bedingungen. Die öffentliche Sichtbarkeit dieses Repos erteilt keine Rechte an diesen Assets.
