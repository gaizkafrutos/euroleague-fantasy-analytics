/** Cómo se emparejó cada jugador del Fantasy con el censo oficial, en
 *  palabras. Lo usan Metodología y el pie de la ficha (que enseñaba
 *  "initial-club" tal cual). */
export const METHOD_LABEL: Record<string, string> = {
  override: "Corrección manual",
  "initial-club": "Apellido e inicial, mismo club",
  "surname-club": "Apellido único en el club",
  exact: "Nombre completo idéntico",
  subset: "Apellido compuesto o con partícula",
  "fuzzy-club": "Similitud alta, mismo club",
  "initial-open": "Apellido e inicial, único en la liga",
  "exact-open": "Nombre exacto, club distinto",
  "prior-season": "Censo de la temporada anterior",
  "fuzzy-open": "Similitud muy alta, sin club",
  unmatched: "Sin cruzar (aún no inscrito)",
};
