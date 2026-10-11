import { money, type Lang } from '../lib/format';

// R$ 12.684,32 on a Portuguese screen, R$ 12,684.32 on an English one. Tabular figures in
// a sentence; mono in columns and on the receipt, where amounts line up.
export function Money({ value, currency, lang, mono = false }: { value: string; currency: 'BRL' | 'USD'; lang: Lang; mono?: boolean }) {
  return <span className={mono ? 'valor valor--mono' : 'valor'}>{money(value, currency, lang)}</span>;
}
