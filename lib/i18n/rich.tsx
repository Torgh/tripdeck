import { Fragment, type ReactNode } from "react";

/**
 * Turns `<b>bold</b>`-style tags in a translated text into elements, so a sentence keeps its links and
 * emphasis in every language. Tags don't nest; unknown tags are left as text.
 */
export function rich(text: string, tags: Record<string, (chunk: string) => ReactNode>): ReactNode {
  const out: ReactNode[] = [];
  const re = /<(\w+)>(.*?)<\/\1>/gs;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const render = tags[m[1]];
    if (!render) continue;
    out.push(text.slice(last, m.index), <Fragment key={m.index}>{render(m[2])}</Fragment>);
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}
