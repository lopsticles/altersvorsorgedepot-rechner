// Rechenkern Altersvorsorgedepot-Rechner. Läuft im Browser (window.AVD) und unter node (module.exports).
// Werte kommen aus parameter-2027.json; Rechenregeln nach dem Altersvorsorgereformgesetz
// (BGBl. 2026 I Nr. 156); Fundstelle je Wert in parameter-2027.json.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AVD = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

// parameter-2027.json → {NAME: wert}
function werte(P) {
  const W = {};
  for (const [k, v] of Object.entries(P.werte || P)) W[k] = (v && typeof v === 'object' && 'wert' in v) ? v.wert : v;
  return W;
}

const MODI_UNMITTELBAR = ['angestellt', 'beamtet', 'selbststaendig'];
const BASISJAHR = 2027; // Beträge im Alter werden in Kaufkraft dieses Jahres umgerechnet

// ── Steuer ─────────────────────────────────────────────────────────

// § 32a Abs. 1 EStG (VZ 2026), Grundtarif
function est(zvE, W) {
  zvE = Math.floor(Math.max(0, zvE));
  if (zvE <= W.GRUNDFREIBETRAG) return 0;
  let st;
  if (zvE <= W.TARIF_ZONE2_BIS) {
    const y = (zvE - W.GRUNDFREIBETRAG) / 10000;
    st = (W.TARIF_ZONE2_A * y + W.TARIF_ZONE2_B) * y;
  } else if (zvE <= W.TARIF_ZONE3_BIS) {
    const z = (zvE - W.TARIF_ZONE2_BIS) / 10000;
    st = (W.TARIF_ZONE3_A * z + W.TARIF_ZONE3_B) * z + W.TARIF_ZONE3_C;
  } else if (zvE <= W.TARIF_ZONE4_BIS) {
    st = 0.42 * zvE - W.TARIF_ZONE4_ABZUG;
  } else {
    st = 0.45 * zvE - W.TARIF_ZONE5_ABZUG;
  }
  return Math.floor(st);
}

// Tarifliche ESt, bei Zusammenveranlagung Splitting (§ 32a Abs. 5 EStG)
function estTarif(zvE, splitting, W) {
  return splitting ? 2 * est(Math.floor(Math.max(0, zvE) / 2), W) : est(zvE, W);
}

// ESt + Soli (§ 3 Abs. 3, § 4 SolZG) + KiSt (Satz auf die ESt, ohne Kappung und ohne Sonderausgabenabzug der KiSt)
function soliVon(e, splitting, W) {
  const frei = splitting ? W.SOLI_FREIGRENZE_SPLITTING : W.SOLI_FREIGRENZE;
  return e > frei ? Math.min(e * W.SOLI_SATZ, (e - frei) * W.SOLI_MILDERUNG) : 0;
}

// Zuschlagsteuern (Soli + KiSt) auf eine festzusetzende ESt
function zuschlag(e, splitting, kistSatz, W) {
  return soliVon(e, splitting, W) + e * (kistSatz || 0);
}

function jahressteuer(zvE, splitting, kistSatz, W) {
  const e = estTarif(zvE, splitting, W);
  return e + zuschlag(e, splitting, kistSatz, W);
}

// Besteuerungsanteil der gesetzlichen Rente nach Jahr des Rentenbeginns, § 22 Nr. 1 S. 3 a aa EStG
// (übernommen aus dem Rentenrechner lopsticles)
function besteuerungsanteil(jahr) {
  if (jahr <= 2005) return 0.5;
  if (jahr <= 2020) return 0.5 + (jahr - 2005) * 0.02;
  if (jahr <= 2022) return 0.8 + (jahr - 2020) * 0.01;
  return Math.min(1, 0.825 + (jahr - 2023) * 0.005);
}

// zvE-Schätzung aus dem Jahresbrutto. Angestellte wie im Rentenrechner (schaetzeNettoLohn): SV-Arbeitnehmeranteile
// bis zur BBG, KV ohne Krankengeldanteil (4 %), Arbeitnehmer-Pauschbetrag, § 10c. Beamte: Pauschbeträge und
// PKV-Basisanteil (Annahme). Selbstständige geben das zvE direkt ein.
function schaetzeZvE(bruttoJahr, modus, hatKinder, W) {
  const m = Math.max(0, bruttoJahr) / 12;
  if (m === 0) return 0;
  if (modus === 'beamtet') {
    return Math.max(0, bruttoJahr - W.ARBEITNEHMER_PAUSCHBETRAG - W.SONDERAUSGABEN_PAUSCHBETRAG - 12 * W.PKV_BASIS_BEAMTE_MONAT);
  }
  if (modus === 'selbststaendig') return Math.max(0, bruttoJahr);
  const rvBasis = Math.min(m, W.BBG_RV_MONAT), kvBasis = Math.min(m, W.BBG_KV_MONAT);
  const pvSatz = hatKinder ? W.BEITRAG_PV : W.BEITRAG_PV_KINDERLOS;
  const rv = rvBasis * W.BEITRAG_RV / 2;
  const kv = kvBasis * W.BEITRAG_KV / 2;
  const pv = kvBasis * (W.BEITRAG_PV / 2 + pvSatz - W.BEITRAG_PV);
  return Math.max(0, 12 * (m - rv - kv * 0.96 - pv) - W.ARBEITNEHMER_PAUSCHBETRAG - W.SONDERAUSGABEN_PAUSCHBETRAG);
}

// zvE im Alter aus gesetzlicher Rente (Besteuerungsanteil, § 9a Nr. 3, § 10c, KV/PV-Anteil wie im Rentenrechner)
// bzw. Pension (§ 19, Versorgungsfreibetrag nicht angesetzt – konservativ, PKV-Basisanteil wie oben)
function zvEAlter(p, jahr, hatKinder, W) {
  if (jahr < p.geburtsjahr + p.renteAb) return 0;
  const beginn = p.geburtsjahr + p.renteAb;
  let zvE = 0;
  if (p.renteMonat > 0) {
    const kvpv = W.BEITRAG_KV / 2 + (hatKinder ? W.BEITRAG_PV : W.BEITRAG_PV_KINDERLOS);
    zvE += 12 * p.renteMonat * (besteuerungsanteil(beginn) - kvpv) - W.WERBUNGSKOSTEN_RENTE;
  }
  if (p.pensionMonat > 0) zvE += 12 * (p.pensionMonat - W.PKV_BASIS_BEAMTE_MONAT) - W.WERBUNGSKOSTEN_RENTE;
  return zvE > 0 ? Math.max(0, zvE - W.SONDERAUSGABEN_PAUSCHBETRAG) : 0;
}

// Schätzung der gesetzlichen Rente in heutigen Werten, wenn keine Renteninformation eingetragen ist:
// Entgeltpunkte aus dem heutigen Brutto (bis zur BBG) je Jahr ab Berufsbeginn bis Rentenbeginn × aktueller Rentenwert
// (§§ 63, 64, 70 SGB VI; Rechengrößen wie im Rentenrechner). Bewusst grob – nur für die Vorbelastung im Alter.
function schaetzeRente(p, W) {
  if (!(p.brutto > 0)) return 0;
  const jahre = Math.max(0, p.renteAb - W.BERUFSBEGINN_ALTER);
  return Math.min(p.brutto, 12 * W.BBG_RV_MONAT) / W.DURCHSCHNITTSENTGELT * jahre * W.RENTENWERT;
}

// Schätzung der Pension: Ruhegehaltssatz 1,79375 % je Dienstjahr, höchstens 71,75 % (§ 14 Abs. 1 BeamtVG),
// auf das heutige Brutto als ruhegehaltfähige Dienstbezüge.
function schaetzePension(p, W) {
  if (!(p.brutto > 0)) return 0;
  const satz = Math.min(W.RUHEGEHALT_MAX, W.RUHEGEHALT_SATZ_JAHR * Math.max(0, p.renteAb - W.DIENSTBEGINN_ALTER));
  return p.brutto / 12 * satz;
}

// ── Eingaben normalisieren ─────────────────────────────────────────

function normalisiere(e, W) {
  const kinder = (e.kinder || []).map(k => ({geburtsjahr: +k.geburtsjahr, kgBis: k.kgBis != null ? +k.kgBis : 25}));
  const personen = (e.personen || []).map(p => {
    const q = Object.assign({
      modus: 'angestellt', brutto: 0, zve: null, kist: false, beitragMonat: 0, dynamik: 0,
      beginn: 2027, renteMonat: null, pensionMonat: null, renteAb: 67, versorgungswerk: false,
    }, p);
    q.geburtsjahr = +q.geburtsjahr;
    // Rente bzw. Pension nicht angegeben → schätzen (angestellt: Rente, beamtet: Pension, sonst keine)
    if (q.renteMonat == null && q.pensionMonat == null) {
      q.vorbelastungGeschaetzt = q.modus === 'angestellt' || q.modus === 'beamtet';
      q.renteMonat = q.modus === 'angestellt' ? schaetzeRente(q, W) : 0;
      q.pensionMonat = q.modus === 'beamtet' ? schaetzePension(q, W) : 0;
    }
    q.renteMonat = +q.renteMonat || 0; q.pensionMonat = +q.pensionMonat || 0;
    q.beitragMonat = Math.max(0, +q.beitragMonat || 0);
    return q;
  });
  const aus = Object.assign({beginnAlter: 65, endAlter: 85, teilentnahme: 0, rendite: 0.03, inflation: 0.02}, e.auszahlung);
  aus.beginnAlter = Math.min(W.AUSZAHLUNG_BIS_ALTER, Math.max(W.AUSZAHLUNG_AB_ALTER, aus.beginnAlter));
  aus.endAlter = Math.max(W.AUSZAHLPLAN_MIN_ENDALTER, aus.endAlter);
  aus.teilentnahme = Math.min(W.TEILENTNAHME_MAX, Math.max(0, aus.teilentnahme));
  const anl = Object.assign({produkt: 'standard', kosten: null, rendite: 0.05, renditeSicher: 0.02, risikoAnteil: 1}, e.anlage);
  // Kosten frei wählbar; im Standarddepot gedeckelt (§ 2a Abs. 2 AltZertG n. F.), ohne Angabe gilt der Deckel
  if (anl.kosten == null || !isFinite(anl.kosten)) anl.kosten = anl.produkt === 'standard' ? W.KOSTEN_STANDARDDEPOT_MAX : 0.005;
  anl.kosten = Math.max(0, +anl.kosten);
  if (anl.produkt === 'standard') anl.kosten = Math.min(W.KOSTEN_STANDARDDEPOT_MAX, anl.kosten);
  const vgl = Object.assign({etfKosten: 0.002, erstattungAnlegen: false, riester: null}, e.vergleich);
  return {
    verheiratet: !!e.verheiratet, kinder, personen, auszahlung: aus, anlage: anl, vergleich: vgl,
    kinderzulageAn: e.kinderzulageAn === 'auto' ? 'auto' : e.kinderzulageAn != null ? +e.kinderzulageAn : (personen.length > 1 ? 1 : 0),
    kistSatz: e.kistSatz != null ? +e.kistSatz : W.KIST_SATZ,
  };
}

const auszahlJahr = (p, H) => p.geburtsjahr + H.auszahlung.beginnAlter;
// Kaufkraftfaktor: nominaler Betrag im Jahr / Faktor = Betrag in Kaufkraft von BASISJAHR
const kaufkraft = (H, jahr) => Math.pow(1 + H.auszahlung.inflation, jahr - BASISJAHR);
const endJahr = (p, H) => p.geburtsjahr + H.auszahlung.endAlter; // erstes Jahr ohne Auszahlung

function beitragImJahr(p, jahr, H, W) {
  if (jahr < p.beginn || jahr >= auszahlJahr(p, H) || p.beitragMonat <= 0) return 0;
  const b = 12 * p.beitragMonat * Math.pow(1 + (p.dynamik || 0), jahr - p.beginn);
  return Math.min(W.HOECHSTEINZAHLUNG_VERTRAG, b);
}

// Kinder mit Kindergeld im Jahr (vereinfacht: ab Geburtsjahr bis zum Jahr des kgBis-ten Geburtstags)
function kinderMitKindergeld(H, jahr) {
  return H.kinder.filter(k => jahr >= k.geburtsjahr && jahr - k.geburtsjahr <= k.kgBis).length;
}

// Unmittelbar förderberechtigt im Jahr? Selbstständige nur unter 67 (§ 10a Abs. 1 S. 5 EStG n. F.)
// alt: Bestandsvertrag im Recht bis 2026 (§ 10a Abs. 1, § 79 S. 1 a. F.): nur Pflichtversicherte und Beamte,
// keine Selbstständigen und keine Versorgungswerk-Mitglieder
function unmittelbar(p, jahr, W, alt) {
  if (!MODI_UNMITTELBAR.includes(p.modus)) return false;
  if (alt && (p.modus === 'selbststaendig' || p.versorgungswerk)) return false;
  if (p.modus === 'selbststaendig' && jahr - p.geburtsjahr >= W.SELBSTSTAENDIG_ALTER_UNTER) return false;
  return true;
}

// ── Förderung ──────────────────────────────────────────────────────

// § 84 S. 1 EStG n. F.
function grundzulage(b, W) {
  const s1 = Math.min(b, W.GRUNDZULAGE_STUFE1_BIS);
  const s2 = Math.max(0, Math.min(b, W.GEFOERDERT_BIS) - W.GRUNDZULAGE_STUFE1_BIS);
  return r2(W.GRUNDZULAGE_STUFE1_SATZ * s1 + W.GRUNDZULAGE_STUFE2_SATZ * s2);
}

// Förderung eines Haushalts in einem Beitragsjahr. beitraege: Array der Jahresbeiträge je Person.
// bonusOffen: je Person, ob der Berufseinsteigerbonus noch nicht gezahlt wurde.
// recht: optional je Person 'alt' (Riester-Bestandsvertrag, §§ 10a, 79, 84–86 EStG a. F.) oder 'neu' (Standard).
// Altes Recht nur für Personen im Riester-Bestand (Vergleich, siehe riesterVergleich).
function foerderungJahr(H, W, jahr, beitraege, bonusOffen, recht) {
  const n = H.personen.length;
  const alt = i => !!recht && recht[i] === 'alt';
  const zvE = H.personen.map(p => p.zve != null ? +p.zve : schaetzeZvE(p.brutto, p.modus, H.kinder.length > 0, W));
  const res = H.personen.map((p, i) => ({
    person: i, jahr, beitrag: r2(beitraege[i]), status: 'keine',
    grundzulage: 0, bonus: 0, kinderzulage: 0, kinder: 0, zulagen: 0,
    anrechenbar: 0, abzug: 0, erstattung: 0, gefoerdert: 0, ungefoerdert: r2(beitraege[i]),
  }));
  const u = H.personen.map((p, i) => beitraege[i] > 0 && unmittelbar(p, jahr, W, alt(i)));
  const mind = W.MINDESTEIGENBEITRAG;

  // Mittelbar: verheiratet, anderer Ehegatte unmittelbar berechtigt (§ 79 S. 2 EStG). Im Vergleich mit altem Recht
  // entfällt die mittelbare Zulage: hat der unmittelbar Berechtigte einen Bestandsvertrag, gibt es für den neuen
  // Vertrag des Ehegatten keine (§ 90 Abs. 2 S. 7 n. F.); ein mittelbar berechtigter Bestandsinhaber wird nicht gerechnet.
  const partnerVon = i => (n === 2 ? 1 - i : -1);
  const mittelbar = H.personen.map((p, i) => {
    const j = partnerVon(i);
    return p.modus === 'mittelbar' && H.verheiratet && j >= 0 && u[j] && beitraege[i] > 0 && !alt(i) && !alt(j);
  });

  // Altes Recht: Zulagen mit Mindesteigenbeitrag und Kürzung (§ 86 a. F.); Kinderzulage in fester Höhe je Kind (§ 85 a. F.)
  const kz = H.kinderzulageAn;
  const nk = kinderMitKindergeld(H, jahr);
  const altZulage = i => {
    const p = H.personen[i], B = beitraege[i];
    const kinderAlt = kz === i ? H.kinder.filter(k => jahr >= k.geburtsjahr && jahr - k.geburtsjahr <= k.kgBis)
      .reduce((s, k) => s + (k.geburtsjahr >= W.ALT_KINDER_GEBURTSJAHR_AB ? W.ALT_KINDERZULAGE_AB2008 : W.ALT_KINDERZULAGE_VOR2008), 0) : 0;
    const einnahmen = p.modus === 'angestellt' ? Math.min(p.brutto, 12 * W.BBG_RV_MONAT) : p.brutto;
    const ungekuerzt = W.ALT_GRUNDZULAGE + kinderAlt;
    const meb = Math.max(W.ALT_MINDESTEIGENBEITRAG_SOCKEL, Math.min(W.ALT_MINDESTEIGENBEITRAG_SATZ * einnahmen, W.ALT_SA_HOECHSTBETRAG) - ungekuerzt);
    const faktor = B >= meb ? 1 : B / meb;
    return {grund: r2(W.ALT_GRUNDZULAGE * faktor), kind: r2(kinderAlt * faktor), kinder: kinderAlt > 0 ? nk : 0};
  };

  // Grundzulage und Bonus
  H.personen.forEach((p, i) => {
    const B = beitraege[i];
    if (u[i] && alt(i)) {
      const z = altZulage(i);
      res[i].status = 'unmittelbar';
      res[i].grundzulage = z.grund; res[i].kinderzulage = z.kind; res[i].kinder = z.kinder;
    } else if (u[i]) {
      res[i].status = 'unmittelbar';
      if (B >= mind) {
        res[i].grundzulage = grundzulage(B, W);
        if (bonusOffen[i] && jahr - p.geburtsjahr <= W.BONUS_ALTER_UNTER) res[i].bonus = W.BERUFSEINSTEIGERBONUS;
      }
    } else if (mittelbar[i]) {
      res[i].status = 'mittelbar';
      const Bu = beitraege[partnerVon(i)];
      if (B >= mind && Bu >= mind) res[i].grundzulage = Math.min(W.GRUNDZULAGE_MITTELBAR_MAX, grundzulage(Bu, W));
    }
  });

  // Kinderzulage je Kind (§ 85 Abs. 1 n. F.), beim mittelbar Berechtigten auf die Beiträge des Ehegatten
  if (nk > 0 && kz >= 0 && kz < n && !alt(kz) && beitraege[kz] >= mind) {
    let basis = 0;
    if (u[kz]) basis = beitraege[kz];
    else if (mittelbar[kz] && beitraege[partnerVon(kz)] >= mind) basis = beitraege[partnerVon(kz)];
    basis = Math.min(basis, W.GEFOERDERT_BIS);
    res[kz].kinder = basis > 0 ? nk : 0;
    res[kz].kinderzulage = r2(res[kz].kinder * Math.min(W.KINDERZULAGE_SATZ * basis, W.KINDERZULAGE_MAX_JE_KIND));
  }
  res.forEach(r => { r.zulagen = r2(r.grundzulage + r.bonus + r.kinderzulage); });

  // Anrechenbare Beiträge für den Sonderausgabenabzug (§ 10a Abs. 1, Abs. 3 S. 2–4 EStG)
  H.personen.forEach((p, i) => {
    if (u[i] && alt(i)) res[i].anrechenbar = Math.min(beitraege[i], Math.max(0, W.ALT_SA_HOECHSTBETRAG - res[i].zulagen)); // Beitrag + Zulage ≤ 2.100 €
    else if (u[i]) res[i].anrechenbar = Math.min(beitraege[i], W.SA_HOECHSTBETRAG);
  });
  H.personen.forEach((p, i) => {
    if (!mittelbar[i]) return;
    const j = partnerVon(i), cap = W.SA_HOECHSTBETRAG + W.SA_ERHOEHUNG_MITTELBAR;
    const resM = Math.min(beitraege[i], W.SA_ERHOEHUNG_MITTELBAR);
    res[j].anrechenbar = Math.min(beitraege[j], cap - resM);
    res[i].anrechenbar = Math.min(beitraege[i], cap - res[j].anrechenbar);
  });
  res.forEach((r, i) => {
    r.gefoerdert = r2(r.anrechenbar);
    r.ungefoerdert = r2(beitraege[i] - r.anrechenbar);
    r.abzug = r2(r.anrechenbar + r.zulagen);
  });

  // Günstigerprüfung (§ 10a Abs. 2, Abs. 3 S. 5 EStG). Der mittelbar Berechtigte hat keinen eigenen Abzug:
  // sein Abzug läuft beim Ehegatten. Verheiratete gemeinsam mit Splitting, sonst je Person.
  // Zuschlagsteuern: Bemessungsgrundlage ist die festzusetzende ESt (§ 51a Abs. 2 S. 1 EStG). Ist der Abzug günstiger,
  // sinkt sie um die Erstattung (ESt nach Abzug + Zulage, § 2 Abs. 6 S. 2 EStG) – Soli und KiSt sinken mit.
  const kistVon = i => (H.personen[i].kist ? H.kistSatz : 0);
  const vergleich = (idx, zvESumme, splitting) => {
    const abzug = idx.reduce((s, i) => s + res[i].abzug, 0);
    const zul = idx.reduce((s, i) => s + res[i].zulagen, 0);
    if (abzug <= 0) return;
    const e0 = estTarif(zvESumme, splitting, W);
    const vorteilESt = e0 - estTarif(zvESumme - abzug, splitting, W);
    const erstESt = Math.max(0, vorteilESt - zul);
    const ks = splitting ? (kistVon(0) + kistVon(1)) / 2 : kistVon(idx[0]); // Ehegatten: KiSt-Satz im Mittel (vereinfacht)
    const zu = erstESt > 0 ? zuschlag(e0, splitting, ks, W) - zuschlag(e0 - erstESt, splitting, ks, W) : 0;
    const vorteil = vorteilESt + zu, erst = erstESt + zu;
    idx.forEach(i => {
      res[i].steuervorteil = r2(vorteil * res[i].abzug / abzug);
      res[i].erstattung = r2(erst * res[i].abzug / abzug);
    });
  };
  const beteiligt = res.map((r, i) => i).filter(i => u[i] || mittelbar[i]);
  if (H.verheiratet && n === 2) {
    vergleich(beteiligt, zvE[0] + zvE[1], true);
  } else {
    beteiligt.forEach(i => vergleich([i], zvE[i], false));
  }
  res.forEach(r => {
    r.steuervorteil = r.steuervorteil || 0;
    r.foerderung = r2(r.zulagen + r.erstattung);
    r.foerderquote = r.beitrag > 0 ? r.foerderung / r.beitrag : 0;
  });
  return {jahr, zvE, personen: res, kinderMitKindergeld: nk};
}

// ── Ansparphase ────────────────────────────────────────────────────

// Risikoanteil im Standarddepot: 5 Jahre vor Auszahlbeginn höchstens 50 %, 2 Jahre davor höchstens 30 %
function risikoAnteil(H, W, jahreBisAuszahlung) {
  const a = H.anlage;
  if (a.produkt !== 'standard') return 1;
  if (jahreBisAuszahlung <= 2) return Math.min(a.risikoAnteil, W.ABLAUF_2J_RISIKO_MAX);
  if (jahreBisAuszahlung <= 5) return Math.min(a.risikoAnteil, W.ABLAUF_5J_RISIKO_MAX);
  return a.risikoAnteil;
}

function renditeJahr(H, W, jahreBisAuszahlung) {
  const q = risikoAnteil(H, W, jahreBisAuszahlung);
  return q * H.anlage.rendite + (1 - q) * H.anlage.renditeSicher - H.anlage.kosten;
}

const monatsZins = r => Math.pow(1 + r, 1 / 12) - 1;

// Jahr für Jahr: Förderung, Depotstand je Person mit zwei Töpfen (gefördert / ungefördert mit Beitragssumme).
// Zulagen werden im Folgejahr gutgeschrieben (zu Jahresbeginn), die letzte spätestens zu Auszahlbeginn.
// opt (nur Riester-Vergleich): recht = Recht je Person ('alt'/'neu'); vertrag = {Person: {kapital, rendite}} – die Beiträge
// dieser Person fließen in einen bestehenden Vertrag mit Startguthaben und fester Rendite nach Kosten statt ins Depot.
function ansparphase(H, W, opt) {
  opt = opt || {};
  const n = H.personen.length;
  const start = Math.min(...H.personen.map(p => p.beginn));
  const ende = Math.max(...H.personen.map(p => auszahlJahr(p, H)));
  const depot = H.personen.map((p, i) => ({gef: opt.vertrag && opt.vertrag[i] ? opt.vertrag[i].kapital : 0, unge: 0, basisUnge: 0, eigen: 0, zulagen: 0, erstattung: 0, offen: 0}));
  const bonusOffen = H.personen.map(() => true);
  const jahre = [];
  for (let jahr = start; jahr < ende; jahr++) {
    const beitraege = H.personen.map(p => beitragImJahr(p, jahr, H, W));
    const f = foerderungJahr(H, W, jahr, beitraege, bonusOffen, opt.recht);
    const zeile = {jahr, foerderung: f, depot: []};
    H.personen.forEach((p, i) => {
      const d = depot[i];
      if (jahr >= auszahlJahr(p, H)) { zeile.depot.push(null); return; }
      if (f.personen[i].bonus > 0) bonusOffen[i] = false;
      d.gef += d.offen; d.zulagen += d.offen; d.offen = 0;
      const rm = monatsZins(opt.vertrag && opt.vertrag[i] ? opt.vertrag[i].rendite : renditeJahr(H, W, auszahlJahr(p, H) - jahr));
      const B = beitraege[i], anteilGef = B > 0 ? f.personen[i].gefoerdert / B : 0;
      for (let m = 0; m < 12; m++) {
        d.gef *= 1 + rm; d.unge *= 1 + rm;
        d.gef += B / 12 * anteilGef; d.unge += B / 12 * (1 - anteilGef);
      }
      d.basisUnge += B * (1 - anteilGef);
      d.eigen += B;
      d.offen = f.personen[i].zulagen;
      d.erstattung += f.personen[i].erstattung;
      zeile.depot.push({kapital: r2(d.gef + d.unge), eigen: r2(d.eigen), zulagen: r2(d.zulagen),
        ertraege: r2(d.gef + d.unge - d.eigen - d.zulagen)});
    });
    jahre.push(zeile);
  }
  // Letzte Zulage zu Auszahlbeginn
  depot.forEach(d => { d.gef += d.offen; d.zulagen += d.offen; d.offen = 0; });
  return {jahre, depot};
}

// ── Auszahlphase ───────────────────────────────────────────────────

function annuitaet(k, rm, n) {
  if (n <= 0) return k;
  return rm > 0 ? k * rm / (1 - Math.pow(1 + rm, -n)) : k / n;
}

// Auszahlplan mit gleichbleibender Rate bis zum Endalter (vereinfachte Darstellung des 80-%-Mechanismus nach
// § 1 Abs. 1 S. 1 Nr. 4 b AltZertG), Teilentnahme zu Beginn. Steuerpflichtiger Teil je Jahr nach § 22 Nr. 5 EStG:
// geförderter Topf voll; ungeförderter Topf nur der Ertragsanteil der Entnahme (S. 2 c), hälftig nach 12 Jahren
// Vertragslaufzeit und ab 62 (§ 20 Abs. 1 Nr. 6 S. 2, § 52 Abs. 28 S. 7).
function auszahlungPerson(p, d, H, W) {
  const a = H.auszahlung;
  const kapital = d.gef + d.unge;
  const rm = monatsZins(a.rendite - H.anlage.kosten);
  const monate = (a.endAlter - a.beginnAlter) * 12;
  const start = auszahlJahr(p, H);
  const haelftig = start - p.beginn >= W.UNGEFOERDERT_HAELFTE_JAHRE && a.beginnAlter >= W.UNGEFOERDERT_HAELFTE_ALTER;
  const faktorUnge = haelftig ? 0.5 : 1;
  let gef = d.gef, unge = d.unge, basis = d.basisUnge;
  const entnimm = betrag => {
    const summe = gef + unge;
    if (summe <= 0) return {brutto: 0, steuerpflichtig: 0};
    betrag = Math.min(betrag, summe);
    const wg = betrag * gef / summe, wu = betrag - wg;
    const basisTeil = unge > 0 ? wu * basis / unge : 0;
    gef -= wg; unge -= wu; basis -= basisTeil;
    return {brutto: betrag, steuerpflichtig: wg + Math.max(0, wu - basisTeil) * faktorUnge};
  };
  const teil = entnimm(kapital * a.teilentnahme);
  const rate = annuitaet(gef + unge, rm, monate);
  const jahre = [];
  for (let j = 0; j < a.endAlter - a.beginnAlter; j++) {
    let brutto = 0, stpfl = 0;
    for (let m = 0; m < 12; m++) {
      gef *= 1 + rm; unge *= 1 + rm;
      const letzte = j === a.endAlter - a.beginnAlter - 1 && m === 11;
      const w = entnimm(letzte ? gef + unge : rate); // Restkapital mit der letzten Zahlung
      brutto += w.brutto; stpfl += w.steuerpflichtig;
    }
    jahre.push({jahr: start + j, alter: a.beginnAlter + j, brutto: r2(brutto), steuerpflichtig: r2(stpfl),
      kapitalEnde: r2(gef + unge)});
  }
  return {
    kapital: r2(kapital), gefoerdertAnteil: kapital > 0 ? d.gef / kapital : 0,
    teilentnahme: {brutto: r2(teil.brutto), steuerpflichtig: r2(teil.steuerpflichtig)},
    kapitalReal: r2(kapital / kaufkraft(H, start)), rateMonat: r2(rate), rateMonatReal: r2(rate / kaufkraft(H, start)),
    haelftig, jahre,
    // Bezugsgröße von heute gegen die Rate in heutiger Kaufkraft
    kleinbetrag: rate > 0 && rate / kaufkraft(H, start) <= W.KLEINBETRAG_QUOTE * W.BEZUGSGROESSE_MONAT,
  };
}

// Steuer im Alter als Differenz ESt(Vorbelastung + Depot) − ESt(Vorbelastung), je Jahr für den Haushalt.
// Rechnung in Kaufkraft von heute: Die nominale Depotauszahlung wird abgezinst, mit dem Tarif von heute und der
// Rente bzw. Pension in heutigen Euro besteuert und die Steuer wieder auf nominal hochgerechnet.
// Verteilung auf die Personen nach ihrem steuerpflichtigen Depotanteil.
function steuerImAlter(H, W, aus) {
  const hatKinder = H.kinder.length > 0;
  const kist = i => (H.personen[i].kist ? H.kistSatz : 0);
  const steuerFuer = (jahr, depotNominal) => {
    const k = kaufkraft(H, jahr);
    return steuerReal(jahr, depotNominal.map(v => v / k)).map(v => v * k);
  };
  const steuerReal = (jahr, depotStpfl) => {
    const basis = H.personen.map(p => zvEAlter(p, jahr, hatKinder, W));
    if (H.verheiratet && H.personen.length === 2) {
      const ks = (kist(0) + kist(1)) / 2; // vereinfacht: KiSt-Satz im Mittel der Ehegatten
      const b = basis[0] + basis[1], x = depotStpfl[0] + depotStpfl[1];
      const st = jahressteuer(b + x, true, ks, W) - jahressteuer(b, true, ks, W);
      return depotStpfl.map(v => (x > 0 ? st * v / x : 0));
    }
    return depotStpfl.map((v, i) => jahressteuer(basis[i] + v, false, kist(i), W) - jahressteuer(basis[i], false, kist(i), W));
  };
  const jahre = new Set();
  aus.forEach(a => a.jahre.forEach(z => jahre.add(z.jahr)));
  const sortiert = [...jahre].sort((x, y) => x - y);
  // Laufende Raten
  sortiert.forEach(jahr => {
    const stpfl = aus.map(a => (a.jahre.find(z => z.jahr === jahr) || {steuerpflichtig: 0}).steuerpflichtig);
    const st = steuerFuer(jahr, stpfl);
    aus.forEach((a, i) => {
      const z = a.jahre.find(q => q.jahr === jahr);
      if (!z) return;
      z.steuer = r2(st[i]);
      z.netto = r2(z.brutto - z.steuer);
      z.nettoReal = r2(z.netto / kaufkraft(H, jahr));
      z.bruttoReal = r2(z.brutto / kaufkraft(H, jahr));
    });
  });
  // Teilentnahme: Mehrsteuer im ersten Auszahlungsjahr gegenüber den Raten allein
  aus.forEach((a, i) => {
    if (a.teilentnahme.brutto <= 0) { a.teilentnahme.steuer = 0; a.teilentnahme.netto = 0; return; }
    const jahr = a.jahre[0].jahr;
    const ohne = aus.map(b => (b.jahre.find(z => z.jahr === jahr) || {steuerpflichtig: 0}).steuerpflichtig);
    const mit = ohne.slice(); mit[i] += a.teilentnahme.steuerpflichtig;
    const s1 = steuerFuer(jahr, ohne).reduce((s, v) => s + v, 0), s2 = steuerFuer(jahr, mit).reduce((s, v) => s + v, 0);
    a.teilentnahme.steuer = r2(s2 - s1);
    a.teilentnahme.netto = r2(a.teilentnahme.brutto - a.teilentnahme.steuer);
    a.teilentnahme.nettoReal = r2(a.teilentnahme.netto / kaufkraft(H, jahr));
  });
  // Kennzahl "netto pro Monat" in Kaufkraft von heute: erstes Auszahlungsjahr, in dem die Rente bzw. Pension schon
  // läuft, sonst das erste
  aus.forEach((a, i) => {
    const p = H.personen[i];
    const ref = a.jahre.find(z => z.jahr >= p.geburtsjahr + p.renteAb) || a.jahre[0];
    if (!ref) { a.nettoMonat = a.nettoMonatNominal = a.steuerMonat = 0; a.referenzAlter = null; return; }
    const k = kaufkraft(H, ref.jahr);
    a.referenzAlter = ref.alter;
    a.nettoMonat = r2(ref.netto / 12 / k);
    a.bruttoMonat = r2(ref.brutto / 12 / k);
    a.steuerMonat = r2(ref.steuer / 12 / k);
    a.nettoMonatNominal = r2(ref.netto / 12);
    a.nettoSummeReal = r2(a.jahre.reduce((s, z) => s + z.nettoReal, 0) + (a.teilentnahme.nettoReal || 0));
  });
}

// ── Vergleich freier ETF und Riester-Wechsel ───────────────────────

// Freier ETF mit gleichem Netto-Eigenaufwand: ohne Anlage der Erstattung spart der ETF Beitrag − Erstattung,
// mit Anlage spart er den vollen Beitrag und das Depot bekommt die Erstattung als ETF-Nebentopf.
// Steuer: Abgeltungsteuer mit Soli/KiSt (§ 32d Abs. 1 S. 4), Teilfreistellung 30 %, Sparerpauschbetrag je Person;
// Vorabpauschale vereinfacht nicht angesetzt (Steuer erst bei Entnahme).
function etfSparplan(H, W, i, einzahlungen, refAlter) {
  const p = H.personen[i], a = H.auszahlung;
  const rmA = monatsZins(H.anlage.rendite - H.vergleich.etfKosten);
  let k = 0, basis = 0;
  einzahlungen.forEach(e => {
    for (let m = 0; m < 12; m++) { k *= 1 + rmA; k += e / 12; }
    basis += e;
  });
  const kist = p.kist ? H.kistSatz : 0;
  const satz = (1 / (4 + kist)) * (1 + W.SOLI_SATZ + kist);
  const rmP = monatsZins(a.rendite - H.vergleich.etfKosten);
  const monate = (a.endAlter - a.beginnAlter) * 12;
  const kapital = k;
  let gewinnJahr = 0, steuerErstesJahr = 0;
  const entnimm = w => {
    const g = k > 0 ? w * (1 - basis / k) : 0;
    basis -= k > 0 ? w * basis / k : 0; k -= w;
    return Math.max(0, g) * (1 - W.TEILFREISTELLUNG_AKTIENFONDS);
  };
  const teil = kapital * a.teilentnahme;
  gewinnJahr += entnimm(teil);
  const rate = annuitaet(k, rmP, monate);
  const teilGewinn = gewinnJahr;
  const start = auszahlJahr(p, H);
  let netto = 0, nettoReal = 0, bruttoSumme = teil;
  const laufend = []; // je Jahr Netto der Raten ohne Teilentnahme, real
  for (let j = 0; j < a.endAlter - a.beginnAlter; j++) {
    let g = j === 0 ? gewinnJahr : 0, brutto = 0;
    for (let m = 0; m < 12; m++) {
      k *= 1 + rmP;
      const w = (j === a.endAlter - a.beginnAlter - 1 && m === 11) ? k : rate;
      g += entnimm(w); brutto += w;
    }
    const steuer = Math.max(0, g - W.SPARERPAUSCHBETRAG) * satz;
    if (j === 0) steuerErstesJahr = Math.max(0, g - teilGewinn - W.SPARERPAUSCHBETRAG) * satz;
    laufend.push((brutto - (j === 0 ? steuerErstesJahr : steuer)) / kaufkraft(H, start + j));
    netto += brutto - steuer; bruttoSumme += brutto;
    nettoReal += (brutto - steuer + (j === 0 ? teil : 0)) / kaufkraft(H, start + j);
  }
  netto += teil; // Steuer der Teilentnahme ist im ersten Jahr enthalten
  // Sparerpauschbetrag bleibt nominal fest (gesetzlich nicht indexiert)
  return {kapital: r2(kapital), kapitalReal: r2(kapital / kaufkraft(H, start)), rateMonat: r2(rate),
    // gleiches Referenzjahr wie beim Depot (erstes Jahr mit Rente bzw. Pension), sonst wäre der ETF bei Inflation bevorzugt
    nettoMonat: r2((laufend[Math.min(laufend.length - 1, Math.max(0, (refAlter != null ? refAlter : a.beginnAlter) - a.beginnAlter))] || 0) / 12),
    nettoSumme: r2(netto),
    nettoSummeReal: r2(nettoReal), bruttoSumme: r2(bruttoSumme)};
}

function vergleichEtf(H, W, anspar, aus) {
  return H.personen.map((p, i) => {
    const zeilen = anspar.jahre.filter(z => z.depot[i]);
    const beitr = zeilen.map(z => z.foerderung.personen[i].beitrag);
    const erst = zeilen.map(z => z.foerderung.personen[i].erstattung);
    const anlegen = H.vergleich.erstattungAnlegen;
    const a = aus[i];
    const etf = etfSparplan(H, W, i, beitr.map((b, j) => (anlegen ? b : Math.max(0, b - erst[j]))), a.referenzAlter);
    const neben = anlegen ? etfSparplan(H, W, i, erst, a.referenzAlter) : null;
    const depotNettoSumme = a.jahre.reduce((s, z) => s + z.netto, 0) + (a.teilentnahme.netto || 0);
    return {
      person: i,
      eigenaufwandNetto: r2(beitr.reduce((s, b) => s + b, 0) - (anlegen ? 0 : erst.reduce((s, e) => s + e, 0))),
      depot: {kapital: r2(a.kapital + (neben ? neben.kapital : 0)), kapitalReal: r2(a.kapitalReal + (neben ? neben.kapitalReal : 0)),
        nettoMonat: r2(a.nettoMonat + (neben ? neben.nettoMonat : 0)),
        nettoSumme: r2(depotNettoSumme + (neben ? neben.nettoSumme : 0)),
        nettoSummeReal: r2(a.nettoSummeReal + (neben ? neben.nettoSummeReal : 0))},
      etf,
    };
  });
}

// Riester-Wechsel-Check: Verbleib mit bisheriger Rendite vs. Übertrag ins Depot. Kosten: abgebender Anbieter
// höchstens 150 € innerhalb von 5 Jahren nach Abschluss, aufnehmender Anbieter einmalig höchstens 150 €
// (§ 1 Abs. 1 S. 3–4 AltZertG n. F.). Laufende Beiträge fließen in beiden Fällen ins neue Depot (Hauptrechnung).
function riesterCheck(H, W, jahrWechsel) {
  const r = H.vergleich.riester;
  if (!r || !(r.kapital > 0)) return null;
  const i = r.person || 0, p = H.personen[i];
  const bis = auszahlJahr(p, H);
  const alter = jahrWechsel - r.beginnJahr;
  const kostenAlt = alter < W.WECHSELKOSTEN_FRIST_JAHRE ? (r.kostenAlt != null ? r.kostenAlt : W.WECHSELKOSTEN_MAX) : 0;
  const pauschaleNeu = r.pauschaleNeu != null ? r.pauschaleNeu : W.WECHSEL_PAUSCHALE_NEU_MAX;
  let verbleib = r.kapital, wechsel = Math.max(0, r.kapital - kostenAlt - pauschaleNeu);
  for (let jahr = jahrWechsel; jahr < bis; jahr++) {
    verbleib *= 1 + (r.rendite != null ? r.rendite : 0.015);
    wechsel *= 1 + renditeJahr(H, W, bis - jahr);
  }
  const rm = monatsZins(H.auszahlung.rendite - H.anlage.kosten);
  const monate = (H.auszahlung.endAlter - H.auszahlung.beginnAlter) * 12;
  return {
    person: i, vertragAlterJahre: alter, kostenAlt, pauschaleNeu, kosten: kostenAlt + pauschaleNeu,
    verbleib: {kapital: r2(verbleib), kapitalReal: r2(verbleib / kaufkraft(H, bis)), rateMonat: r2(annuitaet(verbleib, rm, monate))},
    wechsel: {kapital: r2(wechsel), kapitalReal: r2(wechsel / kaufkraft(H, bis)), rateMonat: r2(annuitaet(wechsel, rm, monate))},
    vorteilWechsel: r2(wechsel - verbleib),
  };
}

// Riester-Vergleich mit vier Wegen (§ 52 Abs. 50a EStG n. F.):
//   A Riester weiterführen, altes Recht      – Beiträge der Riester-Person in den Vertrag, Zulagen/Abzug nach §§ 10a, 84–86 a. F.
//   B Riester ruhen lassen, neues Depot      – bisheriger „Verbleib“: Hauptlauf plus Riester-Guthaben mit Riester-Rendite
//   C Riester ins Depot übertragen           – bisheriger „Wechsel“: Hauptlauf plus Guthaben abzüglich Wechselkosten mit Depotrendite
//   D Riester weiterführen mit Erklärung     – Beiträge in den Vertrag, Förderung nach neuem Recht (§ 52 Abs. 50a S. 4)
// Beiträge sind in allen Wegen gleich; der Partner zahlt wie im Hauptlauf ins neue Depot.
function wegErgebnis(H, anspar, aus) {
  const summe = feld => anspar.jahre.reduce((s, z) => s + z.foerderung.personen.reduce((t, f, k) => t + (z.depot[k] ? f[feld] : 0), 0), 0);
  const eigen = summe('beitrag'), zulagen = summe('zulagen'), erstattung = summe('erstattung');
  const ges = feld => aus.reduce((s, a) => s + (a[feld] || 0), 0);
  return {
    eigen: r2(eigen), zulagen: r2(zulagen), erstattung: r2(erstattung), foerderung: r2(zulagen + erstattung),
    nettoAufwand: r2(eigen - erstattung),
    kapital: r2(ges('kapital')), kapitalReal: r2(ges('kapitalReal')), nettoMonat: r2(ges('nettoMonat')), nettoSummeReal: r2(ges('nettoSummeReal')),
  };
}

function riesterVergleich(H, W, anspar, aus) {
  const chk = riesterCheck(H, W, Math.min(...H.personen.map(p => p.beginn)));
  if (!chk) return null;
  const r = H.vergleich.riester, i = chk.person, p = H.personen[i];
  const rendite = r.rendite != null ? r.rendite : 0.015;
  const neuLauf = (recht, kapitalZusatz) => {
    const a = H.personen.map((q, k) => auszahlungPerson(q, kapitalZusatz && k === i ? Object.assign({}, anspar.depot[k], {gef: anspar.depot[k].gef + kapitalZusatz}) : anspar.depot[k], H, W));
    steuerImAlter(H, W, a);
    return a;
  };
  // Beiträge der Riester-Person fließen in den Vertrag. Die Kinderzulage wird der Person zugeordnet, bei der der Weg mehr
  // bringt (gemeinsame Erklärung der Eltern, § 85 Abs. 2 EStG); im alten Recht liegt sie sonst beim gesperrten Ehegatten.
  const vertragLauf = recht => {
    const optionen = H.kinder.length && H.personen.length > 1 ? H.personen.map((q, k) => k) : [H.kinderzulageAn];
    let beste = null;
    optionen.forEach(kz => {
      const H2 = Object.assign({}, H, {kinderzulageAn: kz});
      const an = ansparphase(H2, W, {recht: H2.personen.map((q, k) => (k === i ? recht : 'neu')), vertrag: {[i]: {kapital: r.kapital, rendite}}});
      const a = H2.personen.map((q, k) => auszahlungPerson(q, an.depot[k], H2, W));
      steuerImAlter(H2, W, a);
      const w = wegErgebnis(H2, an, a);
      if (!beste || w.nettoSummeReal > beste.nettoSummeReal) beste = Object.assign(w, {kinderzulageAn: kz});
    });
    return beste;
  };
  const wege = {
    B: wegErgebnis(H, anspar, neuLauf(null, chk.verbleib.kapital)),
    C: wegErgebnis(H, anspar, neuLauf(null, chk.wechsel.kapital)),
    D: vertragLauf('neu'),
  };
  // Altes Recht: nur Pflichtversicherte und Beamte werden gerechnet; Selbstständige haben keinen Anspruch (Zulage 0), bei
  // mittelbar Berechtigten oder ohne Erwerbstätigkeit gilt durch S. 6/8 ohnehin das neue Recht → Weg A entfällt
  if (p.modus === 'angestellt' || p.modus === 'beamtet' || p.modus === 'selbststaendig') wege.A = vertragLauf('alt');
  else wege.A = null;
  const rang = Object.entries(wege).filter(([, w]) => w).sort((x, y) => y[1].nettoSummeReal - x[1].nettoSummeReal);
  return Object.assign(chk, {wege, beste: rang.length ? rang[0][0] : null, rendite,
    hinweisA: wege.A ? (p.modus === 'selbststaendig' ? 'selbststaendig' : null) : 'ohneAnspruch'});
}

// ── Förderkurve ────────────────────────────────────────────────────

// Förderquote des Haushalts je Monatsbeitrag der Person i im ersten Beitragsjahr (ohne Berufseinsteigerbonus).
// Haushalt, weil der Beitrag des unmittelbar Berechtigten auch Grund- und Kinderzulage des mittelbaren Ehegatten
// trägt (§ 84 S. 4, § 85 Abs. 1 S. 2 EStG n. F.). Die übrigen Beiträge bleiben fest.
// "effizient": höchste Förderquote, bei Gleichstand der höchste Beitrag; "voll": kleinster Beitrag mit der
// höchsten absoluten Förderung.
function foerderkurve(H, W, i, schritt = 5) {
  const p = H.personen[i], jahr = p.beginn;
  const maxMonat = W.HOECHSTEINZAHLUNG_VERTRAG / 12;
  const punkte = [];
  const werteMonat = new Set([10, 25, 30, 150]);
  for (let b = 0; b <= maxMonat + 1e-9; b += schritt) werteMonat.add(b);
  [...werteMonat].sort((a, b) => a - b).forEach(bm => {
    const beitraege = H.personen.map((q, j) => (j === i ? 12 * bm : beitragImJahr(q, jahr, H, W)));
    const f = foerderungJahr(H, W, jahr, beitraege, H.personen.map(() => false));
    const foerderung = f.personen.reduce((s, r) => s + r.foerderung, 0);
    const beitrag = beitraege.reduce((s, b) => s + b, 0);
    punkte.push({monat: bm, jahr: 12 * bm, foerderung: r2(foerderung), beitragHaushalt: r2(beitrag),
      quote: beitrag > 0 ? foerderung / beitrag : 0,
      zulagen: r2(f.personen.reduce((s, r) => s + r.zulagen, 0)), erstattung: r2(f.personen.reduce((s, r) => s + r.erstattung, 0))});
  });
  const mitBeitrag = punkte.filter(q => q.monat > 0);
  const maxQuote = Math.max(...mitBeitrag.map(q => q.quote));
  const effizient = mitBeitrag.filter(q => q.quote >= maxQuote - 1e-9).pop();
  const maxFoerd = Math.max(...mitBeitrag.map(q => q.foerderung));
  const voll = mitBeitrag.find(q => q.foerderung >= maxFoerd - 0.005);
  return {person: i, jahr, punkte, effizient, voll};
}

// ── Gesamtrechnung ─────────────────────────────────────────────────

// kinderzulageAn: 'auto' rechnet beide Zuordnungen und nimmt die mit der höheren Förderung über die Laufzeit
// (die Zuordnung ist durch gemeinsame Erklärung der Eltern wählbar, § 85 Abs. 2 EStG).
function berechne(eingabe, P) {
  if (eingabe.kinderzulageAn === 'auto') {
    const n = (eingabe.personen || []).length;
    if (n < 2 || !(eingabe.kinder || []).length) return berechne(Object.assign({}, eingabe, {kinderzulageAn: 0}), P);
    const varianten = [0, 1].map(k => berechne(Object.assign({}, eingabe, {kinderzulageAn: k}), P));
    const wert = r => r.personen.reduce((s, p) => s + p.summen.zulagen + p.summen.erstattung, 0);
    const beste = wert(varianten[1]) >= wert(varianten[0]) ? 1 : 0;
    const r = varianten[beste];
    r.kinderzulageAuto = {person: beste, vorteil: r2(wert(varianten[beste]) - wert(varianten[1 - beste]))};
    return r;
  }
  const W = werte(P);
  const H = normalisiere(eingabe, W);
  const anspar = ansparphase(H, W);
  const aus = H.personen.map((p, i) => auszahlungPerson(p, anspar.depot[i], H, W));
  steuerImAlter(H, W, aus);
  const summe = (i, feld) => anspar.jahre.reduce((s, z) => s + (z.depot[i] ? z.foerderung.personen[i][feld] : 0), 0);
  const personen = H.personen.map((p, i) => {
    const erstes = anspar.jahre.find(z => z.jahr === p.beginn);
    const eigen = summe(i, 'beitrag');
    const zulagen = summe(i, 'zulagen'), erstattung = summe(i, 'erstattung');
    return {
      person: i, modus: p.modus,
      erstesJahr: erstes ? erstes.foerderung.personen[i] : null,
      summen: {eigen: r2(eigen), zulagen: r2(zulagen), erstattung: r2(erstattung),
        foerderquote: eigen > 0 ? (zulagen + erstattung) / eigen : 0},
      auszahlung: aus[i],
    };
  });
  return {
    eingabe: H,
    personen,
    jahre: anspar.jahre,
    kurven: H.personen.map((p, i) => (p.beitragMonat > 0 || p.modus !== 'keine' ? foerderkurve(H, W, i) : null)),
    vergleich: vergleichEtf(H, W, anspar, aus),
    riester: riesterVergleich(H, W, anspar, aus),
    hinweise: hinweise(H, W, personen),
  };
}

function hinweise(H, W, personen) {
  const h = [];
  H.personen.forEach((p, i) => {
    const wer = H.personen.length > 1 ? `Person ${i + 1}: ` : '';
    if (p.modus === 'beamtet') h.push({typ: 'beamtet', person: i, text: `${wer}Die Förderung setzt eine Einwilligung gegenüber der Besoldungsstelle voraus, spätestens bis zum Ende des Beitragsjahres (§ 10a Abs. 1 S. 1 EStG).`});
    if (p.modus === 'selbststaendig') h.push({typ: 'selbststaendig', person: i, text: `${wer}Förderberechtigt nur mit Einkünften aus Gewerbe oder selbstständiger Arbeit, unter 67 und mit abgegebener Steuererklärung für das Beitragsjahr. Über 1.800 € hinaus ist das Depot ungefördert; für den Steuerabzug darüber passt die Basisrente.`});
    if (p.versorgungswerk) h.push({typ: 'versorgungswerk', person: i, text: `${wer}Angestellte Pflichtmitglieder eines Versorgungswerks brauchen eine Einwilligung gegenüber dem Versorgungswerk (§ 10a Abs. 1 S. 5 Nr. 2 EStG).`});
    if (p.modus === 'mittelbar' && !(H.verheiratet && H.personen.some((q, j) => j !== i && MODI_UNMITTELBAR.includes(q.modus))))
      h.push({typ: 'mittelbar', person: i, text: `${wer}Mittelbar gefördert wird nur, wer mit einer unmittelbar berechtigten Person verheiratet ist.`});
    if (p.modus === 'mittelbar' && p.beitragMonat * 12 < W.MINDESTEIGENBEITRAG)
      h.push({typ: 'mindestbeitrag', person: i, text: `${wer}Mittelbar Berechtigte müssen selbst mindestens 120 € im Jahr einzahlen (10 €/Monat).`});
    if (MODI_UNMITTELBAR.includes(p.modus) && p.beitragMonat > 0 && p.beitragMonat * 12 < W.MINDESTEIGENBEITRAG)
      h.push({typ: 'mindestbeitrag', person: i, text: `${wer}Unter 120 € im Jahr gibt es keine Zulagen (Mindesteigenbeitrag, § 86 EStG).`});
    const a = personen[i].auszahlung;
    const start = Math.max(p.beginn, BASISJAHR), auszahlBeginn = auszahlJahr(p, H);
    if (auszahlBeginn <= start) {
      const spaetest = p.geburtsjahr + W.AUSZAHLUNG_BIS_ALTER;
      h.push({typ: 'zualt', person: i, text: spaetest > start
        ? `${wer}Mit Jahrgang ${p.geburtsjahr} beginnt die Auszahlung mit ${H.auszahlung.beginnAlter} schon ${auszahlBeginn}, also vor dem ersten Beitragsjahr ${start}. Einzahlen lässt sich nur bis zum Auszahlbeginn, spätestens mit ${W.AUSZAHLUNG_BIS_ALTER} (${spaetest}) – dafür unter „Auszahlung im Alter“ einen späteren Beginn wählen.`
        : `${wer}Mit Jahrgang ${p.geburtsjahr} ist kein Altersvorsorgedepot mehr möglich: Die Auszahlung muss spätestens mit ${W.AUSZAHLUNG_BIS_ALTER} beginnen (${spaetest}), das erste Beitragsjahr ist ${start}.`});
    } else if (p.modus === 'selbststaendig' && start - p.geburtsjahr >= W.SELBSTSTAENDIG_ALTER_UNTER) {
      h.push({typ: 'selbststaendig67', person: i, text: `${wer}Selbstständige werden nur bis zum 67. Lebensjahr gefördert; die Beiträge sind hier ungefördert gerechnet.`});
    }
    if (a.kleinbetrag) h.push({typ: 'kleinbetrag', person: i, text: `${wer}Die Monatsrate liegt unter 1,5 % der Bezugsgröße (${(W.KLEINBETRAG_QUOTE * W.BEZUGSGROESSE_MONAT).toFixed(2).replace('.', ',')} €). Der Anbieter darf dann eine Abfindung als Kleinbetragsrente anbieten.`});
    if (!a.haelftig && a.kapital > 0 && personen[i].summen.eigen > 0 && a.gefoerdertAnteil < 0.999)
      h.push({typ: 'zwoelfjahre', person: i, text: `${wer}Weniger als 12 Jahre zwischen Abschluss und Auszahlbeginn: Die Erträge auf ungeförderte Beiträge werden voll statt hälftig besteuert.`});
    if (!(p.renteMonat > 0) && !(p.pensionMonat > 0) && MODI_UNMITTELBAR.includes(p.modus) && !p.vorbelastungGeschaetzt)
      h.push({typ: 'vorbelastung', person: i, text: `${wer}Ohne Angabe der gesetzlichen Rente bzw. Pension fehlt die Vorbelastung im Alter; die Steuer auf die Depotauszahlung ist dann zu niedrig angesetzt.`});
  });
  if (H.kinder.length && !H.personen[H.kinderzulageAn]) h.push({typ: 'kinderzulage', text: 'Die Kinderzulage ist keiner Person zugeordnet.'});
  h.push({typ: 'vertraege', text: 'Gefördert werden höchstens zwei ab 2027 abgeschlossene Verträge je Person (§ 82 Abs. 5 EStG).'});
  h.push({typ: 'kv', text: 'Kranken- und Pflegeversicherung im Alter sind nicht eingerechnet – dafür gibt es den KV-Rechner.'});
  return h;
}

function r2(x) { return Math.round(x * 100) / 100; }

return {werte, est, estTarif, jahressteuer, besteuerungsanteil, schaetzeZvE, schaetzeRente, schaetzePension, zvEAlter, grundzulage,
  foerderungJahr, normalisiere, ansparphase, auszahlungPerson, foerderkurve, riesterCheck, riesterVergleich, berechne};
});
