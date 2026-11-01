/** A text that depends on a count `{n}`: the forms Intl.PluralRules picks from (Polish needs few / many). */
export interface Plural {
  readonly plural: true;
  one?: string;
  few?: string;
  many?: string;
  other: string;
}

export const plural = (forms: Omit<Plural, "plural">): Plural => ({ plural: true, ...forms });
