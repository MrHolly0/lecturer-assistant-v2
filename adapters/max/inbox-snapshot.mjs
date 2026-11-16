// SQLite's online backup API produces a standalone consistent database, including committed WAL pages.
import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, createReadStream, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
const source=process.env.MAX_INBOX_PATH ?? '/data/max-inbox/inbox.sqlite';
if(existsSync(source)) {
  const snapshot=join(dirname(source),'.backup-snapshot.sqlite');
  rmSync(snapshot,{force:true});
  const database=new DatabaseSync(source,{readOnly:true});
  try {await backup(database,snapshot);database.close();await pipeline(createReadStream(snapshot),process.stdout);}
  finally {if(database.isOpen)database.close();rmSync(snapshot,{force:true});}
}
