import type { Sql } from '@rastro/db';
import type { SimTransaction, SimulatorStore } from '@rastro/pix';

interface Row {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAW';
  reference: string;
  amountBrl: string;
  pixKey: string | null;
  status: SimTransaction['status'];
  e2eId: string | null;
  createdAt: Date;
  settlesAt: Date | null;
}

const toTx = (row: Row): SimTransaction => ({
  id: row.id,
  type: row.type,
  reference: row.reference,
  amountBrl: row.amountBrl,
  pixKey: row.pixKey,
  status: row.status,
  endToEndId: row.e2eId,
  createdAt: row.createdAt,
  settlesAt: row.settlesAt,
});

// The simulator keeps its state in Postgres, so the app and the worker see the same Pix.
export function simulatorStore(sql: Sql): SimulatorStore {
  const byReference = async (reference: string) => {
    const [row] = await sql<Row[]>`select * from sim_transactions where reference = ${reference}`;
    return row ? toTx(row) : null;
  };

  return {
    async insert(tx) {
      await sql`
        insert into sim_transactions ${sql({
          id: tx.id,
          type: tx.type,
          reference: tx.reference,
          amountBrl: tx.amountBrl,
          pixKey: tx.pixKey,
          status: tx.status,
          e2eId: tx.endToEndId,
          createdAt: tx.createdAt,
          settlesAt: tx.settlesAt,
        })}
        on conflict (reference) do nothing`;
      const stored = await byReference(tx.reference);
      if (!stored) throw new Error(`simulated transaction ${tx.reference} vanished`);
      return stored;
    },
    byReference,
    async settle(id, endToEndId) {
      const [row] = await sql<Row[]>`
        update sim_transactions set status = 'COMPLETED', e2e_id = ${endToEndId}
        where id = ${id} and status = 'PENDING'
        returning *`;
      if (row) return { tx: toTx(row), changed: true };
      const [current] = await sql<Row[]>`select * from sim_transactions where id = ${id}`;
      if (!current) throw new Error(`no simulated transaction ${id}`);
      return { tx: toTx(current), changed: false };
    },
    async all() {
      return (await sql<Row[]>`select * from sim_transactions`).map(toTx);
    },
  };
}
