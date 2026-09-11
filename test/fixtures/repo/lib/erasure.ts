// Synthetic fixture source. Invented for lantern's tests; not real code.

export async function eraseSubject(id: string, tables: string[]) {
  return { id, cleared: tables.length };
}

export async function verifyErasure(id: string, tables: string[]) {
  return tables.every((t) => t.length > 0) && id.length > 0;
}
