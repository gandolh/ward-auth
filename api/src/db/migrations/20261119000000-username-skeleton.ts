import type Database from "better-sqlite3";

import { usernameSkeleton } from "../users.js";

/**
 * `users.username_skeleton`: what each username looks like, as a key, so that a
 * new name that reads the same as an existing account's is taken
 * (`usernameSkeleton` and `createUser` in `../users.ts`).
 *
 * The backfill uses the same function every writer uses, so a filled row and a
 * new one agree. It changes nothing else on the row, `updated_at` included: the
 * account did not change.
 *
 * **Indexed, not UNIQUE.** Two existing accounts can already share a skeleton
 * (an `alice` and a Cyrillic `аlice`), and this migration must not fail on
 * them. It fills both rows, leaves both accounts as they are, and names their
 * subjects in the boot log; whether they are one person is the operator's call
 * in the console. `createUser` and `setUsername` refuse any new name or rename
 * that matches another account's skeleton, so such a group never grows. To list
 * the groups later:
 *
 *     SELECT username_skeleton, group_concat(subject, ' ')
 *       FROM users GROUP BY username_skeleton HAVING count(*) > 1;
 *
 * Nullable only because SQLite adds a NOT NULL column to a table with rows only
 * when it has a default, and no default is a skeleton. Every row has a value
 * after this, and both writers always set one.
 *
 * The skeleton depends on the version of Unicode's confusables table
 * (`../confusables.ts`, 17.0.0). A new version ships with a migration that
 * recomputes this column.
 */
export function up(db: Database.Database): void {
  db.exec(`ALTER TABLE users ADD COLUMN username_skeleton TEXT`);

  const rows = db
    .prepare<[], { subject: string; username: string }>(
      `SELECT subject, username FROM users ORDER BY created_at, subject`,
    )
    .all();
  const fill = db.prepare<[string, string]>(`UPDATE users SET username_skeleton = ? WHERE subject = ?`);

  const holders = new Map<string, string[]>();
  for (const row of rows) {
    const skeleton = usernameSkeleton(row.username);
    fill.run(skeleton, row.subject);
    holders.set(skeleton, [...(holders.get(skeleton) ?? []), row.subject]);
  }

  db.exec(`CREATE INDEX users_username_skeleton_idx ON users (username_skeleton)`);

  for (const subjects of holders.values()) {
    if (subjects.length < 2) continue;
    console.warn(
      `Ward: ${subjects.length} accounts have usernames that read the same: ${subjects.join(", ")}. ` +
        `They stay as they are, and no new account or rename can take that name. ` +
        `If they are not one person, rename one of them in the console.`,
    );
  }
}
