/** Nombre corto de cada club a partir del código de la Euroliga.
 *
 *  Los códigos internos (ULK es Fenerbahce, IST es Efes, PAM es Valencia) se
 *  colaban en frases y etiquetas como si fueran nombres. En las celdas
 *  estrechas sigue yendo el código, con este nombre en el `title`; donde cabe
 *  una palabra, va el nombre.
 *
 *  Es un mapa literal y no una importación de teams.json para no meter 100 KB
 *  de datos en el JavaScript del navegador. Si cambia la lista de clubes, un
 *  código sin entrada cae al propio código.
 */
const CLUB_SHORT: Record<string, string> = {
  ASV: "ASVEL",
  BAR: "Barça",
  BAS: "Baskonia",
  BES: "Besiktas",
  DUB: "Dubai",
  HTA: "Hapoel",
  IST: "Efes",
  MAD: "Real Madrid",
  MIL: "Milan",
  MUN: "Bayern",
  OLY: "Olympiacos",
  PAM: "Valencia",
  PAN: "Panathinaikos",
  PAR: "Partizan",
  PRS: "Paris",
  RED: "Crvena Zvezda",
  TEL: "Maccabi",
  ULK: "Fenerbahce",
  VIR: "Virtus",
  ZAL: "Zalgiris",
};

/** Tres letras que se leen como el club (FEN, EFE, VAL) para las celdas
 *  donde no cabe el nombre: los códigos de la Euroliga (ULK, IST, PAM) no
 *  se parecen al nombre y había que sabérselos. */
const CLUB_ABBR: Record<string, string> = {
  HTA: "HAP",
  IST: "EFE",
  MAD: "RMA",
  MUN: "BAY",
  PAM: "VAL",
  PAN: "PAO",
  RED: "CZV",
  TEL: "MTA",
  ULK: "FEN",
};

export function clubAbbr(code: string | null | undefined): string {
  if (!code) return "—";
  return CLUB_ABBR[code] ?? code;
}

export function clubName(code: string | null | undefined): string {
  if (!code) return "—";
  return CLUB_SHORT[code] ?? code;
}
