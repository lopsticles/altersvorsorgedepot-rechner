# Altersvorsorgedepot-Rechner – Rechenkern

Geförderte Altersvorsorge ab 2027 (Altersvorsorgedepot, BGBl. 2026 I Nr. 156): Grund- und Kinderzulage, Steuervorteil mit Günstigerprüfung, Standard- und freies Depot, Auszahlung netto, Vergleich mit Riester und ETF-Sparplan.

👉 **Zum Rechner mit Oberfläche:** <https://vorsorge.lopsticles.com/>
(kostenlos, ohne Anmeldung, rechnet komplett im Browser)

Derselbe Code rechnet auch im Online-Rechner. Hier liegt er ohne Oberfläche, damit
die Rechnung nachvollzogen und geprüft werden kann.

## Grundlagen

| Thema | Grundlage |
|---|---|
| Grundzulage, Kinderzulage, Berufseinsteigerbonus | §§ 83–85 EStG n. F. |
| Sonderausgabenabzug, Günstigerprüfung | § 10a EStG n. F. |
| Förderberechtigte, zwei Verträge je Person | §§ 79, 82 EStG n. F. |
| Besteuerung der Auszahlung | § 22 Nr. 5 EStG |
| Riester-Bestand, Übergang | § 52 Abs. 50a EStG n. F. |

## Tests

```sh
node test/testfaelle.cjs   # Node.js >= 20, keine Abhängigkeiten
```

## Grenzen

Rechnet nach dem beschlossenen Gesetz (in Kraft 01.01.2027); Renditen sind Annahmen. Jeder Wert mit Fundstelle in data/parameter-2027.json. Keine Anlage- oder Steuerberatung.

Fehler gefunden oder neue Rechengrößen? Gern als Issue melden.

## Weitere Rechner

Pension (NRW), Rente, Krankenversicherung im Alter, Pflege, Risiko, Bausparen und
geförderte Altersvorsorge: <https://lopsticles.com/> · alle Rechenkerne: <https://github.com/lopsticles>

## Lizenz

MIT – siehe [LICENSE](LICENSE).
