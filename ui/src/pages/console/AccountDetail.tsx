/**
 * One account: what it can reach, what sessions it holds, and its state.
 *
 * This is the screen the console exists for. Six concerns, one panel each, and
 * each panel says what its buttons will actually do:
 *
 *  - **Access.** Grants grouped by app, roles as a set. Adding a role and
 *    removing one are a single click each, which the console's spec asks for by name.
 *  - **Sessions.** One row per live device, each with its own revoke, plus a
 *    single call that ends every one of them at once. Ward still records no
 *    device name and no address for a family — see the panel's own note.
 *  - **Username.** What the person types at Ward's login. The subject, the
 *    grants and the sessions stay through a rename.
 *  - **Password.** The only recovery channel an owner-issued account has.
 *  - **State.** Disable and re-enable, with what each one does and does not
 *    bring back written next to the button.
 *  - **Delete.** The one action here nothing undoes: the account, its grants
 *    and its sessions go, and the subject is retired.
 *
 * ## Where a confirmation is required and where it is in the way
 *
 * Removing one role is one click with no dialog. It is the spec's explicit
 * requirement, it is reversible by the click next to it, and the outcome line
 * names the role that went so it can be put back verbatim. Everything wider
 * than that — revoking an app entirely, ending sessions, renaming, rotating a
 * password, disabling an account — is behind a confirmation that names the
 * consequence, because none of those are undone by clicking again. (A rename
 * can be renamed back, but the person can't sign in under the old name
 * meanwhile, and only the operator can tell them.)
 *
 * ## Focus after a write
 *
 * The reload after a write remounts the whole body, so the screen asks for
 * focus by a `data-wc-focus` key before it reloads and settles it once the
 * account is back (`focus-after-write.ts`). After a confirmed write that is the
 * opener: Disable and Re-enable share a key; everything else lands on the
 * heading, because its button is gone or disabled after the reload. Adding or
 * removing a role has no confirmation and lands on the Access panel's heading:
 * the `×` is gone, and the add form comes back empty with its button disabled.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { consoleApi, type AccountDetailResult, type AppView, type GrantView } from "../../console-api.js";
import { consoleHref } from "./nav.js";
import { formatWhen, plural } from "./format.js";
import { useFocusAfterWrite } from "./focus-after-write.js";
import { describeGrantRevoke, describeGrantWrite, groupGrantsByApp } from "./grant-set.js";
import { useConsole, useConsoleLoad, useWriter } from "./session.js";
import { Alert, Empty, Panel, TextField } from "./ui.js";
import { Confirm } from "./ui/Confirm.js";

export function AccountDetailScreen({ subject }: { subject: string }): React.JSX.Element {
  const { basePath } = useConsole();
  const account = useConsoleLoad(`account:${subject}`, () => consoleApi.getAccount(subject));
  const apps = useConsoleLoad("apps", () => consoleApi.listApps());
  const { request: requestFocus, settle: settleFocus } = useFocusAfterWrite();

  useEffect(() => {
    if (account.result.state === "ready") settleFocus();
  }, [account.result, settleFocus]);

  return (
    <>
      <Link className="wc-back" to={consoleHref(basePath, { kind: "accounts" })}>
        Back to accounts
      </Link>

      {account.result.state === "loading" ? <p className="wc-lede">Loading the account…</p> : null}

      {account.result.state === "failed" ? (
        <Alert tone="error" title="The account did not load" takeFocus>
          {account.result.message}
        </Alert>
      ) : null}

      {account.result.state === "ready" ? (
        <AccountBody
          detail={account.result.data}
          apps={apps.result.state === "ready" ? apps.result.data : []}
          reload={account.reload}
          requestFocus={requestFocus}
        />
      ) : null}
    </>
  );
}

type Pending =
  | { kind: "none" }
  | { kind: "disable" }
  | { kind: "enable" }
  | { kind: "rename"; to: string }
  | { kind: "delete" }
  | { kind: "rotate" }
  | { kind: "revokeApp"; appSlug: string; roles: string[] };

/**
 * The `data-wc-focus` keys on this screen: the buttons that open a `Confirm`,
 * and the Access panel's heading, where adding or removing a role lands.
 */
const FOCUS = {
  access: "access",
  state: "account-state",
  rename: "rename",
  rotate: "rotate-password",
  revokeApp: (appSlug: string) => `revoke-app:${appSlug}`,
  endSession: (familyId: string) => `end-session:${familyId}`,
  endAll: "end-all-sessions",
} as const;

function AccountBody({
  detail,
  apps,
  reload,
  requestFocus,
}: {
  detail: AccountDetailResult;
  apps: AppView[];
  reload: () => void;
  /** Where focus goes once the reload after a write is on screen. */
  requestFocus: (key: string) => void;
}): React.JSX.Element {
  const { account, grants, liveSessions } = detail;
  const { basePath } = useConsole();
  const writer = useWriter();
  const [pending, setPending] = useState<Pending>({ kind: "none" });
  const [deleted, setDeleted] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [newUsername, setNewUsername] = useState(account.username);
  const renameTo = newUsername.trim();

  const close = (): void => {
    setPending({ kind: "none" });
  };

  async function finish(action: () => Promise<boolean>, focusKey: string): Promise<void> {
    const ok = await action();
    if (ok) requestFocus(focusKey);
    close();
    if (ok) reload();
  }

  if (deleted) {
    return (
      <Alert tone="done" title={`${account.username} was deleted`} takeFocus>
        The account, its grants and its sessions are gone, and its subject is retired.{" "}
        <Link to={consoleHref(basePath, { kind: "accounts" })}>Back to accounts</Link>.
      </Alert>
    );
  }

  return (
    <>
      <div className="wc-head">
        <h1 tabIndex={-1}>{account.username}</h1>
        <span className="wc-state" data-state={account.disabled ? "disabled" : undefined}>
          {account.disabled
            ? `Disabled${account.disabledAt === null ? "" : ` since ${formatWhen(account.disabledAt)}`}`
            : "Active"}
        </span>
      </div>

      <p className="wc-lede">
        Subject <span className="wc-id">{account.subject}</span> — the value that appears in this account&rsquo;s access
        tokens and in every grant row below. Created {formatWhen(account.createdAt)}.
        {account.email === null
          ? " No email address: this account was created from the console, so it has no reset link."
          : ` Email ${account.email}${account.emailVerified ? " (verified)" : " (unverified)"}.`}
      </p>

      {writer.error === undefined ? null : (
        <Alert tone="error" title="Ward refused the change" takeFocus>
          {writer.error}
        </Alert>
      )}

      <AccessPanel
        subject={account.subject}
        grants={grants}
        apps={apps}
        onRevokeApp={(appSlug, roles) => {
          setPending({ kind: "revokeApp", appSlug, roles });
        }}
        reload={reload}
        requestFocus={requestFocus}
      />

      <SessionsPanel subject={account.subject} onChanged={reload} requestFocus={requestFocus} />

      <Panel
        title="Username"
        note="What the person types at Ward's login. A rename keeps the subject, the grants and every live session. Apps keep the name they took at their first sign-in with Ward; each app renames its own."
      >
        <form
          className="wc-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (renameTo !== "" && renameTo !== account.username) {
              setPending({ kind: "rename", to: renameTo });
            }
          }}
        >
          <TextField
            label="Username"
            name="username"
            value={newUsername}
            onChange={setNewUsername}
            autoComplete="off"
            spellCheck={false}
            opaque
            required
            disabled={writer.busy}
            hint="Ward folds case and Unicode form before comparing, so Alice and alice are the same account."
          />
          <div className="wc-actions">
            <button
              type="submit"
              className="wc-btn"
              data-wc-focus={FOCUS.rename}
              disabled={writer.busy || renameTo === "" || renameTo === account.username}
            >
              Rename
            </button>
          </div>
        </form>
      </Panel>

      <Panel
        title="Password"
        note="The only recovery channel this account has. Set a new one here and tell the person out of band; Ward never shows a password back, and this console never puts one in a URL."
      >
        <form
          className="wc-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (newPassword !== "") setPending({ kind: "rotate" });
          }}
        >
          <TextField
            label="New password"
            name="new-password"
            type="password"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
            required
            disabled={writer.busy}
            hint="At least 8 characters. Every live session for this account ends when it is set."
          />
          <div className="wc-actions">
            <button
              type="submit"
              className="wc-btn"
              data-wc-focus={FOCUS.rotate}
              disabled={writer.busy || newPassword === ""}
            >
              Rotate password
            </button>
          </div>
        </form>
      </Panel>

      <Panel
        title="Account state"
        tone={account.disabled ? undefined : "danger"}
        note={
          account.disabled
            ? "Re-enabling restores the grants exactly as they are above — they were never touched. It does not bring the revoked sessions back; the person signs in again."
            : "Disabling locks the account and revokes its live sessions in the same write, so the sessions genuinely end rather than only future sign-ins being blocked. The grants survive, so a later re-enable restores exactly what is above."
        }
      >
        <div className="wc-actions">
          {account.disabled ? (
            <button
              type="button"
              className="wc-btn"
              data-tone="primary"
              data-wc-focus={FOCUS.state}
              disabled={writer.busy}
              onClick={() => {
                setPending({ kind: "enable" });
              }}
            >
              Re-enable account
            </button>
          ) : (
            <button
              type="button"
              className="wc-btn"
              data-tone="danger"
              data-wc-focus={FOCUS.state}
              disabled={writer.busy}
              onClick={() => {
                setPending({ kind: "disable" });
              }}
            >
              Disable account
            </button>
          )}
        </div>
      </Panel>

      <Panel
        title="Delete this account"
        tone="danger"
        note="Deleting removes the account, its grants and its sessions in one write, and nothing brings them back. The subject is retired for good, so no later account inherits what apps hold for it; the username is freed. Disable instead if the person may return."
      >
        <div className="wc-actions">
          <button
            type="button"
            className="wc-btn"
            data-tone="danger"
            disabled={writer.busy}
            onClick={() => {
              setPending({ kind: "delete" });
            }}
          >
            Delete {account.username}
          </button>
        </div>
      </Panel>

      <Confirm
        open={pending.kind === "disable"}
        title={`Disable ${account.username}?`}
        confirmLabel="Disable and end sessions"
        busy={writer.busy}
        onCancel={close}
        onConfirm={() => {
          void finish(
            () =>
              writer.run(
                () => consoleApi.disableAccount(account.subject),
                (result) =>
                  result.sessionsRevoked === 0
                    ? `Disabled ${account.username}. It held no live sessions.`
                    : `Disabled ${account.username} and revoked ${plural(result.sessionsRevoked, "session", "sessions")}.`,
              ),
            FOCUS.state,
          );
        }}
      >
        <p>
          The account will no longer be able to sign in, and its {plural(liveSessions, "live session", "live sessions")}{" "}
          will be revoked immediately rather than left to expire.
        </p>
        <p>
          Its {plural(grants.length, "grant", "grants")} will be left in place, so re-enabling restores exactly the
          access shown above.
        </p>
      </Confirm>

      <Confirm
        open={pending.kind === "enable"}
        title={`Re-enable ${account.username}?`}
        confirmLabel="Re-enable"
        tone="primary"
        busy={writer.busy}
        onCancel={close}
        onConfirm={() => {
          void finish(
            () =>
              writer.run(
                () => consoleApi.enableAccount(account.subject),
                (result) =>
                  result.changed
                    ? `Re-enabled ${account.username}. Its grants came back with it; its old sessions did not.`
                    : `${account.username} was already enabled. Nothing changed and no audit row was written.`,
              ),
            FOCUS.state,
          );
        }}
      >
        <p>
          The account will be able to sign in again, with the {plural(grants.length, "grant", "grants")} shown above.
          The sessions revoked when it was disabled stay revoked.
        </p>
      </Confirm>

      <Confirm
        open={pending.kind === "rename"}
        title={`Rename ${account.username} to ${pending.kind === "rename" ? pending.to : ""}?`}
        confirmLabel="Rename"
        tone="primary"
        busy={writer.busy}
        onCancel={close}
        onConfirm={() => {
          if (pending.kind !== "rename") return;
          const to = pending.to;
          void finish(
            () =>
              writer.run(
                () => consoleApi.renameAccount(account.subject, to),
                (result) =>
                  result.changed
                    ? `Renamed ${account.username} to ${result.account.username}. They sign in with the new name from now on.`
                    : `${account.username} already has that name. Nothing changed and no audit row was written.`,
              ),
            FOCUS.rename,
          );
        }}
      >
        <p>
          From now on the person signs in to Ward as <strong>{pending.kind === "rename" ? pending.to : ""}</strong>, and
          the old name stops working. Tell them: Ward has no way to.
        </p>
        <p>
          The subject, the {plural(grants.length, "grant", "grants")} and the{" "}
          {plural(liveSessions, "live session", "live sessions")} stay. Apps keep the name they already have.
        </p>
      </Confirm>

      <Confirm
        open={pending.kind === "delete"}
        title={`Delete ${account.username}?`}
        confirmLabel={`Delete ${account.username}`}
        busy={writer.busy}
        onCancel={close}
        onConfirm={() => {
          void writer
            .run(
              () => consoleApi.deleteAccount(account.subject),
              (result) =>
                `Deleted ${result.username}, ${plural(result.grantsRevoked, "grant", "grants")} and ${plural(result.sessionsRevoked, "live session", "live sessions")}.`,
            )
            .then((ok) => {
              close();
              if (ok) setDeleted(true);
            });
        }}
      >
        <p>
          The account, its {plural(grants.length, "grant", "grants")} and its{" "}
          {plural(liveSessions, "live session", "live sessions")} will be removed for good. Apps end its Ward sessions
          within 30 seconds.
        </p>
        <p>
          Each app keeps its own user for this person, and that user&rsquo;s data; delete those in the app. The name{" "}
          <strong>{account.username}</strong> becomes free, and a new account under it is a stranger to every app.
        </p>
      </Confirm>

      <Confirm
        open={pending.kind === "rotate"}
        title={`Rotate the password for ${account.username}?`}
        confirmLabel="Set the new password"
        busy={writer.busy}
        onCancel={close}
        onConfirm={() => {
          void finish(async () => {
            const ok = await writer.run(
              () => consoleApi.setPassword(account.subject, newPassword),
              (result) =>
                `Password rotated. ${
                  result.sessionsRevoked === 0
                    ? "There were no live sessions to end."
                    : `${plural(result.sessionsRevoked, "session", "sessions")} ended with it.`
                }`,
            );
            // Out of state either way: a password must not sit in the form
            // after the request that carried it.
            setNewPassword("");
            return ok;
          }, FOCUS.rotate);
        }}
      >
        <p>
          The account&rsquo;s password will be replaced and its {plural(liveSessions, "live session", "live sessions")}{" "}
          revoked, because a rotation that leaves a thirty-day refresh token alive has not achieved the thing it was
          performed for.
        </p>
        <p>
          Ward will not show the new password again. Pass it on before you leave this page — there is no reset link for
          an account created in this console.
        </p>
      </Confirm>

      <Confirm
        open={pending.kind === "revokeApp"}
        title={pending.kind === "revokeApp" ? `Revoke all access to ${pending.appSlug}?` : "Revoke app access?"}
        confirmLabel="Revoke every role"
        busy={writer.busy}
        onCancel={close}
        onConfirm={() => {
          if (pending.kind !== "revokeApp") return;
          const appSlug = pending.appSlug;
          void finish(
            () =>
              writer.run(
                () => consoleApi.revokeGrant({ subject: account.subject, appSlug }),
                (result) => describeGrantRevoke(appSlug, result.removed, result.roles),
              ),
            FOCUS.revokeApp(appSlug),
          );
        }}
      >
        <p>
          {pending.kind === "revokeApp"
            ? `Every role ${account.username} holds in ${pending.appSlug} will be removed: ${pending.roles.join(", ")}.`
            : ""}
        </p>
        <p>
          The account keeps its access to every other app. Access tokens already minted stay valid for up to fifteen
          minutes, so the app may still admit it until they expire.
        </p>
      </Confirm>
    </>
  );
}

/**
 * The account's live sessions — one row per device, not a count.
 *
 * `GET /console/accounts/:subject/sessions` lists the newest live refresh row
 * per family. `issuedAt` is that row's own issuance — the **last refresh**,
 * not the original sign-in — because the family's first row is deliberately
 * not fetched: it would be one extra query per device to report a timestamp
 * nobody can act on, where a refresh four minutes ago is the fact that says
 * whether a device is in use.
 *
 * Ward records no device name and no address for a family: `refresh_tokens`
 * has no such column. A family id is the only handle a session has here, and
 * this panel says so rather than letting a list of rows imply an operator can
 * tell which device is which.
 */
function SessionsPanel({
  subject,
  onChanged,
  requestFocus,
}: {
  subject: string;
  onChanged: () => void;
  requestFocus: (key: string) => void;
}): React.JSX.Element {
  const sessions = useConsoleLoad(`sessions:${subject}`, () => consoleApi.listSessions(subject));
  const writer = useWriter();
  const [revoking, setRevoking] = useState<string | undefined>();
  const [endingAll, setEndingAll] = useState(false);

  async function revokeOne(familyId: string): Promise<void> {
    const ok = await writer.run(
      () => consoleApi.revokeSession(subject, familyId),
      (result) =>
        result.changed
          ? "That session was ended. The device signs out the next time it tries to refresh."
          : "That session had already ended.",
    );
    if (ok) requestFocus(FOCUS.endSession(familyId));
    setRevoking(undefined);
    if (ok) {
      sessions.reload();
      onChanged();
    }
  }

  async function revokeAll(): Promise<void> {
    const ok = await writer.run(
      () => consoleApi.revokeAllSessions(subject),
      (result) =>
        result.revoked === 0
          ? "No live sessions to end."
          : `Ended ${plural(result.revoked, "session", "sessions")}. The account itself was untouched.`,
    );
    if (ok) requestFocus(FOCUS.endAll);
    setEndingAll(false);
    if (ok) {
      sessions.reload();
      onChanged();
    }
  }

  return (
    <Panel
      title="Sessions"
      note="Ward keeps no device name and no address for a live session — refresh_tokens has no such column — so a family id below is the only handle it has. What's shown as issued is the last refresh, not the original sign-in."
    >
      {writer.error === undefined ? null : (
        <Alert tone="error" title="The session was not ended" takeFocus>
          {writer.error}
        </Alert>
      )}

      {sessions.result.state === "loading" ? <p className="wc-panel-note">Loading sessions…</p> : null}

      {sessions.result.state === "failed" ? (
        <Alert tone="error" title="The sessions did not load">
          {sessions.result.message}
        </Alert>
      ) : null}

      {sessions.result.state === "ready" ? (
        sessions.result.data.sessions.length === 0 ? (
          <Empty title="No live sessions">
            <p>Nothing is currently signed in as this account.</p>
          </Empty>
        ) : (
          <>
            <div className="wc-table-scroll">
              <table className="wc-table">
                <caption>{plural(sessions.result.data.sessions.length, "live session", "live sessions")}.</caption>
                <thead>
                  <tr>
                    <th scope="col">Device</th>
                    <th scope="col">Last refreshed</th>
                    <th scope="col">Expires</th>
                    <th scope="col">
                      <span className="wc-sr">Revoke</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.result.data.sessions.map((session) => (
                    <tr key={session.familyId}>
                      <td className="wc-id">{session.familyId}</td>
                      <td>{formatWhen(session.issuedAt)}</td>
                      <td>{formatWhen(session.expiresAt)}</td>
                      <td>
                        <button
                          type="button"
                          className="wc-btn-link"
                          data-wc-focus={FOCUS.endSession(session.familyId)}
                          disabled={writer.busy}
                          onClick={() => {
                            setRevoking(session.familyId);
                          }}
                        >
                          End this session
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="wc-actions">
              <button
                type="button"
                className="wc-btn"
                data-tone="danger"
                data-wc-focus={FOCUS.endAll}
                disabled={writer.busy}
                onClick={() => {
                  setEndingAll(true);
                }}
              >
                End all sessions
              </button>
              <span className="wc-field-hint">
                Rotating the password below also ends every session, and is the better move if the password itself is
                what you no longer trust.
              </span>
            </div>
          </>
        )
      ) : null}

      <Confirm
        open={revoking !== undefined}
        title="End this session?"
        confirmLabel="End session"
        busy={writer.busy}
        onCancel={() => {
          setRevoking(undefined);
        }}
        onConfirm={() => {
          if (revoking !== undefined) void revokeOne(revoking);
        }}
      >
        <p>
          The device on this session is signed out the next time it tries to refresh its access token — within about
          fifteen minutes if it is in active use.
        </p>
      </Confirm>

      <Confirm
        open={endingAll}
        title="End every session for this account?"
        confirmLabel="End all sessions"
        busy={writer.busy}
        onCancel={() => {
          setEndingAll(false);
        }}
        onConfirm={() => {
          void revokeAll();
        }}
      >
        <p>
          Every live session ends in one call. The account&rsquo;s grants, password and email are untouched, and it can
          sign in again immediately — this is the whole difference from disabling it.
        </p>
      </Confirm>
    </Panel>
  );
}

/** The oldest grant in a set — who opened this app to this account, and when. */
function earliest(grants: GrantView[]): GrantView {
  return grants.reduce((oldest, grant) => (grant.grantedAt < oldest.grantedAt ? grant : oldest));
}

/**
 * Grants, grouped by app, roles as a set.
 *
 * ## No dropdown of known roles, ever
 *
 * Ward stores a role string opaquely and never interprets it, and a picker
 * listing "the roles" would quietly become the schema Ward deliberately does
 * not have — an app growing a capability would then need this console
 * redeployed. So the role field is free text, and the roles already in use in
 * the selected app are offered as `<datalist>` suggestions: helpful, and not a
 * constraint.
 */
function AccessPanel({
  subject,
  grants,
  apps,
  onRevokeApp,
  reload,
  requestFocus,
}: {
  subject: string;
  grants: GrantView[];
  apps: AppView[];
  onRevokeApp: (appSlug: string, roles: string[]) => void;
  reload: () => void;
  requestFocus: (key: string) => void;
}): React.JSX.Element {
  const grouped = groupGrantsByApp(grants);
  const writer = useWriter();
  const [appSlug, setAppSlug] = useState("");
  const [role, setRole] = useState("");

  // Roles already in use in the selected app, for the suggestion list. Loaded
  // per app rather than estate-wide because there is no endpoint that lists
  // every grant — deliberately, since that is not a question anyone asks.
  const suggestions = useConsoleLoad(`app-grants:${appSlug}`, () =>
    appSlug === "" ? Promise.resolve([]) : consoleApi.grantsForApp(appSlug),
  );
  const suggested =
    suggestions.result.state === "ready" ? [...new Set(suggestions.result.data.map((grant) => grant.role))].sort() : [];

  async function add(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (appSlug === "" || role === "") return;
    const ok = await writer.run(
      () => consoleApi.addGrant({ subject, appSlug, role }),
      (result) => describeGrantWrite(result.grant.role, result.grant.appSlug, result.created),
    );
    if (ok) {
      requestFocus(FOCUS.access);
      setRole("");
      reload();
    }
  }

  async function drop(targetApp: string, targetRole: string): Promise<void> {
    const ok = await writer.run(
      () => consoleApi.revokeGrant({ subject, appSlug: targetApp, role: targetRole }),
      (result) => describeGrantRevoke(targetApp, result.removed, result.roles),
    );
    if (ok) {
      requestFocus(FOCUS.access);
      reload();
    }
  }

  return (
    <Panel
      title="Access"
      focusKey={FOCUS.access}
      note="A grant is the estate's actual security boundary: this account can use exactly the apps listed here, as exactly these roles, and nothing else. There is no wildcard — even the owner account holds one explicit row per app."
    >
      {writer.error === undefined ? null : (
        <Alert tone="error" title="The grant was not written" takeFocus>
          {writer.error}
        </Alert>
      )}

      {grouped.length === 0 ? (
        <Empty title="No grants">
          <p>
            This account holds no grants, so it can sign in to Ward and reach <strong>none</strong> of the
            estate&rsquo;s apps. <em>This is the default for every new account</em> — it is not a page that failed to
            load.
          </p>
          <p>Issue one below. Access begins the moment the row exists; nothing needs a deploy.</p>
        </Empty>
      ) : (
        <div>
          {grouped.map((entry) => (
            <div className="wc-app-grant" key={entry.appSlug}>
              <h3>{entry.appSlug}</h3>
              <p className="wc-app-grant-meta">
                {plural(entry.roles.length, "role", "roles")}, first granted{" "}
                {formatWhen(earliest(entry.grants).grantedAt)} by{" "}
                {/* `grantedBy` is a subject, or the literal `superuser` /
                    `self-registration`. It is not a foreign key and must never
                    be rendered as a link to an account. */}
                <span className="wc-id">{earliest(entry.grants).grantedBy}</span>
              </p>
              <ul className="wc-roles">
                {entry.grants.map((grant) => (
                  <li className="wc-role" key={grant.role}>
                    <span>{grant.role}</span>
                    <button
                      type="button"
                      className="wc-role-drop"
                      disabled={writer.busy}
                      title={`Remove ${grant.role} in ${entry.appSlug}`}
                      onClick={() => {
                        void drop(entry.appSlug, grant.role);
                      }}
                    >
                      <span aria-hidden="true">×</span>
                      <span className="wc-sr">{`Remove the role ${grant.role} in ${entry.appSlug}`}</span>
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    className="wc-btn-link"
                    data-wc-focus={FOCUS.revokeApp(entry.appSlug)}
                    disabled={writer.busy}
                    onClick={() => {
                      onRevokeApp(entry.appSlug, entry.roles);
                    }}
                  >
                    Revoke all access to {entry.appSlug}
                  </button>
                </li>
              </ul>
            </div>
          ))}
        </div>
      )}

      <form
        className="wc-form wc-form-row wc-grant-add"
        onSubmit={(event) => {
          void add(event);
        }}
      >
        <p className="wc-field">
          <label htmlFor="wc-grant-app">App</label>
          <select
            id="wc-grant-app"
            value={appSlug}
            disabled={writer.busy}
            onChange={(event) => {
              setAppSlug(event.target.value);
            }}
          >
            <option value="">Choose an app…</option>
            {apps.map((app) => (
              <option key={app.slug} value={app.slug}>
                {app.slug} — {app.name}
              </option>
            ))}
          </select>
        </p>
        <TextField
          label="Role"
          name="role"
          value={role}
          onChange={setRole}
          autoComplete="off"
          spellCheck={false}
          opaque
          disabled={writer.busy}
          list="wc-role-suggestions"
          placeholder="admin"
        />
        <datalist id="wc-role-suggestions">
          {suggested.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <p className="wc-row-actions">
          <button
            type="submit"
            className="wc-btn"
            data-tone="primary"
            disabled={writer.busy || appSlug === "" || role === ""}
          >
            Add role
          </button>
        </p>
      </form>

      <p className="wc-panel-note">
        The role is free text and the suggestions are only the roles already in use in the app you pick. Ward never
        interprets a role, so there is no list of known ones to choose from — a picker here would quietly become a
        schema Ward deliberately does not have.
      </p>
    </Panel>
  );
}
