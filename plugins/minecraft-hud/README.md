# minecraft-hud

Die Mod hinter dem Minecraft-HUD. Bedienung, Ein- und Ausschalten und Anpassen stehen in der [Anleitung](../../README.md), Hinweise für Agenten in [CLAUDE.md](../../CLAUDE.md).

```bash
python3 tools/fetch_assets.py
```

Holt Mojangs Sprites und Schrift aus dem offiziellen `client.jar` und baut `hooks/sprites.ts` neu. Das ist nötig nach einem frischen Klon, denn die Assets stehen nicht in Git.

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

```bash
python3 tools/build_sprites.py
```

Der letzte Befehl baut `hooks/sprites.ts` aus den PNGs in `assets/` neu, nachdem du dort etwas getauscht hast.
