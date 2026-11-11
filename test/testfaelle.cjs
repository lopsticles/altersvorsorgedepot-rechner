#!/usr/bin/env node
// Testtabelle Altersvorsorgedepot-Rechner: die 9 Testfälle aus dem Fachkonzept, ergänzt um Riester (10–14) und Prüfung 2026-11 (15–17).
// Aufruf: node test/testfaelle.cjs          → Prüfungen, Exit-Code 1 bei Fehlern
//         node test/testfaelle.cjs --md     → zusätzlich Markdown-Tabelle
'use strict';
const path = require('path');
const AVD = require(path.join(__dirname, '../src/avd-kern.js'));
const P = require(path.join(__dirname, '../data/parameter-2027.json'));
const W = AVD.werte(P);

const anlage = {produkt: 'standard', rendite: 0.05, renditeSicher: 0.02};
const auszahlung = {beginnAlter: 65, endAlter: 85, teilentnahme: 0, rendite: 0.03, inflation: 0.02};

// Alter im Beitragsjahr 2027 → Geburtsjahr
const gj = alter => 2027 - alter;

const faelle = [
  {nr: 1, titel: 'Single, angestellt, 30 J., 45.000 € brutto, 150 €/M', ziel: 'Grundzulage 540 €, Günstigerprüfung',
    annahmen: 'Rente 1.500 €/M ab 67',
    eingabe: {personen: [{geburtsjahr: gj(30), modus: 'angestellt', brutto: 45000, beitragMonat: 150, renteMonat: 1500}]},
    pruefe: (r, e) => [
      eq('Grundzulage', e.grundzulage, 540),
      eq('Bonus', e.bonus, 0),
      ok('Günstigerprüfung gerechnet', e.steuervorteil > 0, `Steuervorteil ${e.steuervorteil} €`),
    ]},
  {nr: 2, titel: 'Single, 23 J., Berufseinsteiger, 30.000 €, 30 €/M', ziel: '180 € + 200 € Bonus',
    annahmen: 'angestellt',
    eingabe: {personen: [{geburtsjahr: gj(23), modus: 'angestellt', brutto: 30000, beitragMonat: 30}]},
    pruefe: (r, e) => [
      eq('Grundzulage', e.grundzulage, 180),
      eq('Bonus', e.bonus, 200),
      eq('Bonus nur einmal (2. Jahr)', r.jahre[1].foerderung.personen[0].bonus, 0),
    ]},
  {nr: 3, titel: 'Paar, beide angestellt, Kinder 2018 + 2021, je 150 €/M', ziel: 'Kinderzulage 2 × 300 €, Splitting',
    annahmen: 'verheiratet; P1 55.000 €, P2 35.000 €; beide 38 J.; Kinderzulage bei P2',
    eingabe: {verheiratet: true, kinder: [{geburtsjahr: 2018}, {geburtsjahr: 2021}], kinderzulageAn: 1,
      personen: [{geburtsjahr: gj(38), modus: 'angestellt', brutto: 55000, beitragMonat: 150, renteMonat: 1700},
                 {geburtsjahr: gj(38), modus: 'angestellt', brutto: 35000, beitragMonat: 150, renteMonat: 1100}]},
    pruefe: (r, e, f) => [
      eq('Kinderzulage P2', f.personen[1].kinderzulage, 600),
      eq('Kinderzulage P1', f.personen[0].kinderzulage, 0),
      eq('Grundzulage je Person', f.personen[0].grundzulage + f.personen[1].grundzulage, 1080),
      ok('Splitting: Steuervorteil gemeinsam', Math.abs(f.personen[0].steuervorteil + f.personen[1].steuervorteil
        - (AVD.estTarif(f.zvE[0] + f.zvE[1], true, W) - AVD.estTarif(f.zvE[0] + f.zvE[1] - f.personen[0].abzug - f.personen[1].abzug, true, W))) < 0.05,
        `Vorteil ${r2(f.personen[0].steuervorteil + f.personen[1].steuervorteil)} €`),
      ok('Kinderzulage entfällt 2044 für Kind 2018 (25 J. in 2043)', r.jahre.find(z => z.jahr === 2044).foerderung.personen[1].kinderzulage === 300,
        `2044: ${r.jahre.find(z => z.jahr === 2044).foerderung.personen[1].kinderzulage} €`),
    ]},
  {nr: 4, titel: 'Paar, Partner mittelbar, 2 Kinder, 10 €/M beim Partner', ziel: '175-€-Deckel, 120 € Mindestbeitrag',
    annahmen: 'verheiratet; P1 angestellt 50.000 €, 150 €/M, Rente 1.600 €/M; Kinder 2020 + 2023; Kinderzulage beim mittelbaren P2',
    eingabe: {verheiratet: true, kinder: [{geburtsjahr: 2020}, {geburtsjahr: 2023}], kinderzulageAn: 1,
      personen: [{geburtsjahr: gj(35), modus: 'angestellt', brutto: 50000, beitragMonat: 150, renteMonat: 1600},
                 {geburtsjahr: gj(33), modus: 'mittelbar', brutto: 0, beitragMonat: 10}]},
    pruefe: (r, e, f) => [
      eq('Grundzulage mittelbar (Deckel)', f.personen[1].grundzulage, 175),
      eq('Kinderzulage mittelbar (auf Beiträge P1)', f.personen[1].kinderzulage, 600),
      eq('SA anrechenbar gesamt (1.800 + 120)', f.personen[0].anrechenbar + f.personen[1].anrechenbar, 1920),
      eq('9 €/M beim Partner: keine Zulage', AVD.foerderungJahr(AVD.normalisiere(Object.assign({}, faelle[3].eingabe,
        {personen: [faelle[3].eingabe.personen[0], Object.assign({}, faelle[3].eingabe.personen[1], {beitragMonat: 9})]}), W), W, 2027,
        [1800, 108], [false, false]).personen[1].zulagen, 0),
    ]},
  {nr: 5, titel: 'Beamter A13, 45 J., 150 €/M, Pension 3.500 €', ziel: 'Beamten-Modus, Grenzsteuer im Alter',
    annahmen: 'Brutto 5.800 €/M (A13, Annahme); Pension ab 67; ledig',
    eingabe: {personen: [{geburtsjahr: gj(45), modus: 'beamtet', brutto: 69600, beitragMonat: 150, pensionMonat: 3500}]},
    pruefe: (r, e) => {
      const a = r.personen[0].auszahlung, z = a.jahre.find(q => q.alter === 67);
      const grenz = z.steuer / z.steuerpflichtig; // nominal/nominal = Grenzsatz in Kaufkraft heute
      return [
        eq('Grundzulage', e.grundzulage, 540),
        ok('Hinweis Einwilligung', r.hinweise.some(h => h.typ === 'beamtet')),
        ok('Grenzsteuer im Alter ≥ 30 % (mit 67)', grenz >= 0.30, `${(grenz * 100).toFixed(1)} %`),
      ];
    }},
  {nr: 6, titel: 'Freiberuflerin, 40 J., Gewinn 80.000 €, 570 €/M', ziel: 'gefördert 1.800 € / ungefördert 5.040 €, Kombi-Hinweis',
    annahmen: 'zvE = 80.000 € (direkt); Rente 1.200 €/M ab 67',
    eingabe: {personen: [{geburtsjahr: gj(40), modus: 'selbststaendig', brutto: 80000, beitragMonat: 570, renteMonat: 1200}]},
    pruefe: (r, e) => [
      eq('Beitrag', e.beitrag, 6840),
      eq('gefördert', e.gefoerdert, 1800),
      eq('ungefördert', e.ungefoerdert, 5040),
      ok('Kombi-Hinweis Basisrente', r.hinweise.some(h => h.typ === 'selbststaendig')),
      ok('Erträge ungefördert hälftig (25 J. Laufzeit)', r.personen[0].auszahlung.haelftig),
    ]},
  {nr: 7, titel: 'Gutverdiener, 100.000 €, 150 €/M', ziel: 'Steuervorteil > Zulage',
    annahmen: 'angestellt, 40 J., ledig, Rente 2.200 €/M',
    eingabe: {personen: [{geburtsjahr: gj(40), modus: 'angestellt', brutto: 100000, beitragMonat: 150, renteMonat: 2200}]},
    pruefe: (r, e) => [
      ok('Steuervorteil > Zulage', e.steuervorteil > e.zulagen, `${e.steuervorteil} € > ${e.zulagen} €`),
      ok('Erstattung = Differenz', Math.abs(e.erstattung - (e.steuervorteil - e.zulagen)) < 0.01, `${e.erstattung} €`),
    ]},
  {nr: 8, titel: 'Geringverdienerin, GRV-pflichtig, 2 Kinder, 10 €/M', ziel: 'Mindestbeitrag + Kinderzulage-Auslegung',
    annahmen: 'angestellt 18.000 €, alleinerziehend, Kinder 2019 + 2022, Rente 900 €/M',
    eingabe: {kinder: [{geburtsjahr: 2019}, {geburtsjahr: 2022}], kinderzulageAn: 0,
      personen: [{geburtsjahr: gj(34), modus: 'angestellt', brutto: 18000, beitragMonat: 10, renteMonat: 900}]},
    pruefe: (r, e) => [
      eq('Grundzulage', e.grundzulage, 60),
      eq('Kinderzulage je Kind (2 × 120)', e.kinderzulage, 240),
      ok('Förderquote 250 %', Math.abs(e.zulagen / e.beitrag - 2.5) < 1e-9, `${(e.zulagen / e.beitrag * 100).toFixed(0)} %`),
    ]},
  {nr: 9, titel: 'Riester-Bestand 15.000 €, Vertrag 3 Jahre alt', ziel: 'Wechselkosten 150 € + 150 € Pauschale neuer Anbieter',
    annahmen: 'Vertragsbeginn 2024, Riester-Rendite 1,5 %; Person 45 J., 50.000 €, 100 €/M, Rente 1.500 €/M',
    eingabe: {personen: [{geburtsjahr: gj(45), modus: 'angestellt', brutto: 50000, beitragMonat: 100, renteMonat: 1500}],
      vergleich: {riester: {kapital: 15000, beginnJahr: 2024, rendite: 0.015}}},
    pruefe: r => [
      eq('Kosten abgebender Anbieter', r.riester.kostenAlt, 150),
      eq('Pauschale aufnehmender Anbieter (§ 1 Abs. 1 S. 4 AltZertG)', r.riester.pauschaleNeu, 150),
      ok('Wechsel lohnt bei 1,5 % Riester-Rendite', r.riester.vorteilWechsel > 0, `${r.riester.vorteilWechsel} €`),
    ]},
  // ── Riester-Vergleich: altes Recht (§§ 10a, 84–86 EStG a. F.) und die vier Wege ──────────────────────────────
  {nr: 10, titel: 'Riester alt: Angestellte, 45.000 €, 1.800 €/Jahr, Kind 2015', ziel: 'Grund 175 + Kind 300, Abzug bei 2.100 € gedeckelt',
    annahmen: 'Bestandsvertrag, altes Recht; 1 Kind mit Kindergeld',
    eingabe: {kinder: [{geburtsjahr: 2015}], kinderzulageAn: 0,
      personen: [{geburtsjahr: gj(37), modus: 'angestellt', brutto: 45000, beitragMonat: 150, renteMonat: 1500}],
      vergleich: {riester: {kapital: 15000, beginnJahr: 2015, rendite: 0.015}}},
    pruefe: (r, e, f) => {
      const H = AVD.normalisiere(faelle[9].eingabe, W);
      const a = AVD.foerderungJahr(H, W, 2027, [1800], [false], ['alt']).personen[0];
      const vorteil = AVD.estTarif(f.zvE[0], false, W) - AVD.estTarif(f.zvE[0] - 2100, false, W);
      return [
        eq('Grundzulage alt', a.grundzulage, 175), eq('Kinderzulage alt (Geburt ab 2008)', a.kinderzulage, 300),
        eq('Abzug: Beitrag + Zulage höchstens 2.100 €', a.abzug, 2100), eq('anrechenbarer Beitrag', a.anrechenbar, 1625),
        ok('Günstigerprüfung: Erstattung = Vorteil − Zulage', Math.abs(a.erstattung - Math.max(0, vorteil - 475)) < 0.05, `${a.erstattung} € (Vorteil ${r2(vorteil)} €)`),
      ];
    }},
  {nr: 11, titel: 'Riester alt: Beitrag unter dem Mindesteigenbeitrag, Kürzung', ziel: 'Zulage × Beitrag ÷ Mindesteigenbeitrag (§ 86 Abs. 1 S. 6)',
    annahmen: '45.000 € brutto, 600 €/Jahr, Kind 2015 → Mindesteigenbeitrag 1.800 − 175 − 300 = 1.325 €',
    eingabe: {kinder: [{geburtsjahr: 2015}], kinderzulageAn: 0,
      personen: [{geburtsjahr: gj(37), modus: 'angestellt', brutto: 45000, beitragMonat: 50, renteMonat: 1500}],
      vergleich: {riester: {kapital: 15000, beginnJahr: 2015}}},
    pruefe: () => {
      const H = AVD.normalisiere(faelle[10].eingabe, W);
      const a = AVD.foerderungJahr(H, W, 2027, [600], [false], ['alt']).personen[0];
      const k = 600 / 1325;
      return [eq('Grundzulage gekürzt', a.grundzulage, r2(175 * k)), eq('Kinderzulage gekürzt', a.kinderzulage, r2(300 * k)),
        eq('bei 60 € Sockel: höher als 4 %-Grenze ohne Zulage', AVD.foerderungJahr(AVD.normalisiere({personen: [{geburtsjahr: 1990, modus: 'angestellt', brutto: 1000, beitragMonat: 5}]}, W), W, 2027, [60], [false], ['alt']).personen[0].grundzulage, 175)];
    }},
  {nr: 12, titel: 'Riester alt: Kind 2005, Selbstständiger, Ehegatten-Sperre', ziel: '185 € vor 2008, Selbstständige ohne Zulage, § 90 Abs. 2 S. 7',
    annahmen: 'Kinderzulage 185 €; Selbstständiger im alten Recht 0 €; mittelbarer Partner mit neuem Vertrag ohne Zulage',
    eingabe: {verheiratet: true, kinder: [{geburtsjahr: 2005}], kinderzulageAn: 0,
      personen: [{geburtsjahr: gj(40), modus: 'angestellt', brutto: 60000, beitragMonat: 150, renteMonat: 1500},
                 {geburtsjahr: gj(40), modus: 'mittelbar', brutto: 0, beitragMonat: 10}],
      vergleich: {riester: {kapital: 15000, beginnJahr: 2015}}},
    pruefe: () => {
      const H = AVD.normalisiere(faelle[11].eingabe, W);
      const alt = AVD.foerderungJahr(H, W, 2027, [1800, 120], [false, false], ['alt', 'neu']).personen;
      const neu = AVD.foerderungJahr(H, W, 2027, [1800, 120], [false, false], ['neu', 'neu']).personen;
      const selbst = AVD.normalisiere({personen: [{geburtsjahr: 1990, modus: 'selbststaendig', brutto: 60000, beitragMonat: 150}]}, W);
      return [eq('Kinderzulage alt, Kind 2005', alt[0].kinderzulage, 185), eq('Partner ohne Zulage neben Bestandsvertrag', alt[1].zulagen, 0),
        eq('Partner mit Zulage, wenn beide neues Recht', neu[1].grundzulage, 175),
        eq('Selbstständiger im alten Recht: keine Zulage', AVD.foerderungJahr(selbst, W, 2027, [1800], [false], ['alt']).personen[0].zulagen, 0)];
    }},
  {nr: 13, titel: 'Riester-Vergleich: vier Wege, gleiche Beiträge', ziel: 'Zulagen alt < neu, B/C/D gleiche Förderung, Kapital B/C = Hauptlauf + Guthaben',
    annahmen: 'Angestellte 45.000 €, 150 €/M, Kind 2015, Riester 15.000 € seit 2015, 1,5 %, Wechselkosten 0',
    eingabe: {kinder: [{geburtsjahr: 2015}], kinderzulageAn: 0,
      personen: [{geburtsjahr: gj(37), modus: 'angestellt', brutto: 45000, beitragMonat: 150, renteMonat: 1500}],
      vergleich: {riester: {kapital: 15000, beginnJahr: 2015, rendite: 0.015, kostenAlt: 0, pauschaleNeu: 0}}},
    pruefe: r => {
      const w = r.riester.wege, hauptKapital = r.personen[0].auszahlung.kapital;
      return [
        ok('vier Wege gerechnet', w.A && w.B && w.C && w.D),
        ok('Zulagen altes Recht < neues Recht', w.A.zulagen < w.D.zulagen, `${w.A.zulagen} € gegen ${w.D.zulagen} €`),
        eq('Zulagen B = Hauptlauf', w.B.zulagen, r.personen[0].summen.zulagen), eq('Zulagen C = Hauptlauf', w.C.zulagen, r.personen[0].summen.zulagen),
        eq('Zulagen D = Hauptlauf (gleiches Recht, gleiche Beiträge)', w.D.zulagen, r.personen[0].summen.zulagen),
        eq('Eigenbeiträge in allen Wegen gleich (A = D)', w.A.eigen, w.D.eigen),
        ok('Kapital B = Hauptlauf + Riester-Guthaben', Math.abs(w.B.kapital - hauptKapital - r.riester.verbleib.kapital) < 0.05, `${w.B.kapital} €`),
        ok('Kapital C = Hauptlauf + übertragenes Guthaben', Math.abs(w.C.kapital - hauptKapital - r.riester.wechsel.kapital) < 0.05, `${w.C.kapital} €`),
        ok('bester Weg benannt', ['A', 'B', 'C', 'D'].includes(r.riester.beste), r.riester.beste),
      ];
    }},
  {nr: 14, titel: 'Riester-Vergleich: nicht berufstätige Riester-Person', ziel: 'Weg A entfällt, B/C/D bleiben',
    annahmen: 'Person ohne Erwerbstätigkeit mit Bestandsvertrag',
    eingabe: {personen: [{geburtsjahr: gj(40), modus: 'keine', taetigkeit: 'nicht', brutto: 0, beitragMonat: 50, renteMonat: 0}],
      vergleich: {riester: {kapital: 8000, beginnJahr: 2012, rendite: 0.015}}},
    pruefe: r => [ok('Weg A entfällt', r.riester.wege.A === null), ok('Weg D gerechnet', !!r.riester.wege.D)]},
  {nr: 15, titel: 'Soli und Kirchensteuer sinken mit der Steuererstattung', ziel: 'Erstattung mit KiSt = ESt-Erstattung × (1 + 9 %) zzgl. Soli-Anteil',
    annahmen: 'Single, 100.000 € brutto, 150 €/M, mit und ohne Kirchensteuer; § 51a Abs. 2 S. 1, § 2 Abs. 6 S. 2 EStG',
    eingabe: {personen: [{geburtsjahr: gj(40), modus: 'angestellt', brutto: 100000, beitragMonat: 150, renteMonat: 2000, kist: true}]},
    pruefe: (r, e) => {
      const ohne = AVD.berechne({anlage, auszahlung, personen: [{geburtsjahr: gj(40), modus: 'angestellt', brutto: 100000, beitragMonat: 150, renteMonat: 2000, kist: false}]}, P).jahre[0].foerderung.personen[0];
      const zvE = e.erstattung > 0 ? r.jahre[0].foerderung.zvE[0] : 0;
      const e0 = AVD.est(zvE, W), estErst = AVD.est(zvE, W) - AVD.est(zvE - e.abzug, W) - e.zulagen;
      const soli = x => (x > W.SOLI_FREIGRENZE ? Math.min(x * W.SOLI_SATZ, (x - W.SOLI_FREIGRENZE) * W.SOLI_MILDERUNG) : 0);
      const soll = r2(estErst + soli(e0) - soli(e0 - estErst));
      return [
        eq('Erstattung ohne KiSt = ESt + Soli-Anteil', ohne.erstattung, soll),
        ok('Erstattung mit KiSt höher', e.erstattung > ohne.erstattung, `${e.erstattung} € gegen ${ohne.erstattung} €`),
        eq('KiSt-Anteil = 9 % der ESt-Erstattung', r2(e.erstattung - ohne.erstattung), r2(0.09 * estErst)),
      ];
    }},
  {nr: 16, titel: 'ETF-Vergleich: gleiches Referenzjahr wie das Depot', ziel: 'Netto pro Monat beider im ersten Jahr mit Rente (67), nicht ETF mit 65',
    annahmen: 'Single, 45.000 €, 150 €/M, Rente ab 67, Auszahlung ab 65, 2 % Inflation',
    eingabe: {personen: [{geburtsjahr: gj(30), modus: 'angestellt', brutto: 45000, beitragMonat: 150, renteMonat: 1500, renteAb: 67}]},
    pruefe: r => {
      const v = r.vergleich[0], a = r.personen[0].auszahlung;
      return [
        eq('Referenzalter Depot', a.referenzAlter, 67),
        ok('ETF-Netto in Kaufkraft mit 67 ≤ Rate in Kaufkraft mit 65', v.etf.nettoMonat <= v.etf.rateMonat / Math.pow(1.02, gj(30) + 65 - 2027) + 0.01, `${v.etf.nettoMonat} € ≤ ${r2(v.etf.rateMonat / Math.pow(1.02, gj(30) + 65 - 2027))} €`),
      ];
    }},
  {nr: 17, titel: 'Zu alt für das Depot: Hinweis statt Nullen', ziel: 'Jahrgang 1960: Hinweis „zualt“; Auszahlung mit 70 → Beiträge 2027–2029',
    annahmen: 'angestellt, 45.000 €, 150 €/M',
    eingabe: {personen: [{geburtsjahr: 1960, modus: 'angestellt', brutto: 45000, beitragMonat: 150}]},
    pruefe: r => {
      const spaet = AVD.berechne({anlage, auszahlung: Object.assign({}, auszahlung, {beginnAlter: 70}), personen: [{geburtsjahr: 1960, modus: 'angestellt', brutto: 45000, beitragMonat: 150}]}, P);
      return [
        ok('Hinweis zualt', r.hinweise.some(h => h.typ === 'zualt')),
        eq('Beitragsjahre bei Auszahlung mit 70', spaet.jahre.length, 3),
        ok('kein Hinweis bei Auszahlung mit 70', !spaet.hinweise.some(h => h.typ === 'zualt')),
      ];
    }},
  {nr: 18, titel: 'Kosten einstellbar, im Standarddepot höchstens 1 %', ziel: 'Standard 0,4 % → 0,4 %; Standard 1,5 % → 1,0 %; frei 2 % → 2 %; weniger Kosten = mehr Kapital',
    annahmen: 'Single, 45.000 €, 150 €/M',
    eingabe: {personen: [{geburtsjahr: gj(30), modus: 'angestellt', brutto: 45000, beitragMonat: 150, renteMonat: 1500}]},
    pruefe: r => {
      const mit = an => AVD.berechne({auszahlung, anlage: Object.assign({}, anlage, an), personen: [{geburtsjahr: gj(30), modus: 'angestellt', brutto: 45000, beitragMonat: 150, renteMonat: 1500}]}, P);
      const s04 = mit({kosten: 0.004}), s15 = mit({kosten: 0.015}), f2 = mit({produkt: 'frei', kosten: 0.02});
      return [
        eq('ohne Angabe: Deckel 1 %', r.eingabe.anlage.kosten, 0.01),
        eq('Standard 0,4 %', s04.eingabe.anlage.kosten, 0.004),
        eq('Standard 1,5 % → 1 %', s15.eingabe.anlage.kosten, 0.01),
        eq('frei 2 %', f2.eingabe.anlage.kosten, 0.02),
        ok('0,4 % bringt mehr Kapital als 1 %', s04.personen[0].auszahlung.kapital > r.personen[0].auszahlung.kapital,
          `${Math.round(s04.personen[0].auszahlung.kapital)} € gegen ${Math.round(r.personen[0].auszahlung.kapital)} €`),
      ];
    }},
];

function r2(x) { return Math.round(x * 100) / 100; }
function eq(name, ist, soll) { return {name, ok: Math.abs(ist - soll) < 0.005, info: `${ist} (soll ${soll})`}; }
function ok(name, bed, info = '') { return {name, ok: !!bed, info}; }
const eur = x => x.toLocaleString('de-DE', {minimumFractionDigits: 0, maximumFractionDigits: 0}) + ' €';
const pct = x => (x * 100).toLocaleString('de-DE', {maximumFractionDigits: 0}) + ' %';

let fehler = 0;
const zeilen = [];
for (const f of faelle) {
  const eingabe = Object.assign({anlage, auszahlung}, f.eingabe);
  const r = AVD.berechne(eingabe, P);
  const f0 = r.jahre.length ? r.jahre[0].foerderung : {personen: r.personen.map(() => ({beitrag: 0, zulagen: 0, erstattung: 0}))};
  const e = f0.personen[0];
  const checks = f.pruefe(r, e, f0);
  console.log(`\nFall ${f.nr}: ${f.titel}\n  Ziel: ${f.ziel}\n  Annahmen: ${f.annahmen}`);
  checks.forEach(c => { console.log(`  ${c.ok ? 'OK  ' : 'FEHL'} ${c.name}: ${c.info}`); if (!c.ok) fehler++; });
  const zul = f0.personen.reduce((s, p) => s + p.zulagen, 0), erst = f0.personen.reduce((s, p) => s + p.erstattung, 0);
  const beitr = f0.personen.reduce((s, p) => s + p.beitrag, 0);
  const kap = r.personen.reduce((s, p) => s + p.auszahlung.kapital, 0);
  const netto = r.personen.reduce((s, p) => s + p.auszahlung.nettoMonat, 0);
  const kapReal = r.personen.reduce((s, p) => s + p.auszahlung.kapitalReal, 0);
  zeilen.push({f, beitr, zul, erst, quote: beitr ? (zul + erst) / beitr : 0, kap, kapReal, netto,
    ok: checks.every(c => c.ok), checks});
}
console.log(`\n${fehler ? fehler + ' Prüfung(en) fehlgeschlagen' : 'Alle Prüfungen bestanden'}.`);

if (process.argv.includes('--md')) {
  console.log('\n| # | Fall | Beitrag 2027 | Zulagen 2027 | Erstattung 2027 | Förderquote | Kapital mit 65 (nominal) | Kapital in Kaufkraft 2027 | netto/M (Kaufkraft 2027) | Prüfziel |');
  console.log('|---|---|---:|---:|---:|---:|---:|---:|---:|---|');
  zeilen.forEach(z => console.log(`| ${z.f.nr} | ${z.f.titel} | ${eur(z.beitr)} | ${eur(z.zul)} | ${eur(z.erst)} | ${pct(z.quote)} | ${eur(z.kap)} | ${eur(z.kapReal)} | ${eur(z.netto)} | ${z.ok ? '✓' : '✗'} ${z.f.ziel} |`));
}
process.exit(fehler ? 1 : 0);
