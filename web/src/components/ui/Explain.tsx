/** Explicación plegada: una frase a la vista y el porqué a un toque.
 *
 *  Cada sección abría con dos a cinco líneas de explicación que competían con
 *  la cifra. Siguen ahí, completas, pero ya no son lo primero que se lee. Es un
 *  <details> nativo: funciona sin JavaScript y con teclado. */
import type { ReactNode } from "react";

export default function Explain({
  summary = "Cómo se calcula",
  children,
  className = "",
}: {
  summary?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={`explain${className ? ` ${className}` : ""}`}>
      <summary>{summary}</summary>
      <div>{children}</div>
    </details>
  );
}
