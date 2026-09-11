// Synthetic fixture source. Invented for lantern's tests; not real code.

export function withinAskWindow(lastAskedDaysAgo: number, cooldownDays: number) {
  return lastAskedDaysAgo < cooldownDays;
}

export function holdbackActive(today: string, windows: Array<[string, string]>) {
  return windows.some(([from, to]) => today >= from && today <= to);
}
