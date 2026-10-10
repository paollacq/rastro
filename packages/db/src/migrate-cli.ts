import { connect } from './client.ts';
import { migrate } from './migrate.ts';

const db = connect(undefined, { max: 1 });
await migrate(db);
const tables = await db<{ tableName: string }[]>`
  select table_name from information_schema.tables where table_schema = 'public' order by table_name`;
console.log(`schema up to date: ${tables.map((t) => t.tableName).join(', ')}`);
await db.end();
