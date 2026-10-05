/** Filas completas del comparador, como JSON estático (se genera en el build). */
import { NextResponse } from "next/server";

import { compareRows } from "@/lib/compare";

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(compareRows());
}
