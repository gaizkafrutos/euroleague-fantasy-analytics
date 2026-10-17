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

export function clubName(code: string | null | undefined): string {
  if (!code) return "—";
  return CLUB_SHORT[code] ?? code;
}
