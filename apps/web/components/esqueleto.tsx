// A gray bar where text will be: the screen keeps its shape while it loads, and nothing
// shimmers (only the ID and the stamp ever move).
export function Esqueleto({ largura = '100%', altura = '1em', margem = 0 }: { largura?: string; altura?: string; margem?: number }) {
  return <span className="esqueleto" style={{ width: largura, height: altura, marginTop: margem }} aria-hidden="true" />;
}
