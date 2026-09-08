"use client";

// "Invite codes": mint a batch, then hand the links out. The codes are only
// readable here, so the just-minted batch stays highlighted and copyable for as
// long as the sheet is open — that batch is why the admin came.
import { useEffect, useMemo, useRef, useState } from "react";
import { Ban, Check, Copy } from "lucide-react";
import { useToast } from "@/components/design/Toast";
import { useInviteCodeActions, useInviteCodes, type InviteCode } from "@/hooks/useAdminBeta";
import { INVITE_BATCH_MAX, INVITE_LABEL_MAX } from "@/lib/beta";
import { copyText } from "@/lib/referral";
import { errMessage } from "./util";
import s from "./admin.module.css";
import { AdminSheet } from "./AdminSheet";

export interface InviteCodesSheetProps {
  open: boolean;
  onClose: () => void;
}

const MAX_USES = 10_000;
const MAX_DAYS = 3650;

function clamp(raw: string, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(Number(raw) || 0)));
}

type CodeState = { label: string; tone: string };

/** Why a code can't be redeemed. The server decided `live`; this reads back the reason,
 *  which is why expiry needs no clock of its own. */
export function codeState(code: InviteCode): CodeState {
  if (code.live) return { label: "Live", tone: "approved" };
  if (code.disabledAt != null) return { label: "Off", tone: "blocked" };
  if (code.uses >= code.maxUses) return { label: "Spent", tone: "" };
  if (code.expiresAt != null) return { label: "Expired", tone: "" };
  return { label: "Off", tone: "blocked" };
}

export function InviteCodesSheet({ open, onClose }: InviteCodesSheetProps) {
  return (
    <AdminSheet open={open} onClose={onClose} title="Invite codes">
      <InviteCodesForm />
    </AdminSheet>
  );
}

// State lives here so it resets whenever the sheet unmounts.
function InviteCodesForm() {
  const { notify } = useToast();
  const list = useInviteCodes();
  const { create, disable } = useInviteCodeActions();

  const [countRaw, setCountRaw] = useState("1");
  const [usesRaw, setUsesRaw] = useState("1");
  const [label, setLabel] = useState("");
  const [daysRaw, setDaysRaw] = useState("");
  const [minted, setMinted] = useState<InviteCode[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [disabling, setDisabling] = useState<Set<string>>(() => new Set());

  const copiedTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  const count = clamp(countRaw, 0, INVITE_BATCH_MAX);
  const maxUses = clamp(usesRaw, 1, MAX_USES);
  const days = daysRaw.trim() === "" ? null : clamp(daysRaw, 1, MAX_DAYS);

  // The mint response is authoritative and instant; the refetched list catches
  // up a moment later, so show whichever has the code first.
  const fresh = useMemo(() => new Set(minted.map((c) => c.code)), [minted]);
  const codes = useMemo(() => {
    const known = new Set(list.codes.map((c) => c.code));
    return [...minted.filter((c) => !known.has(c.code)), ...list.codes];
  }, [list.codes, minted]);

  const busy = create.isPending;

  const copy = async (key: string, text: string) => {
    if (!(await copyText(text))) {
      notify("Couldn't reach the clipboard", "info");
      return;
    }
    setCopied(key);
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(null), 1800);
  };

  const mint = async () => {
    if (count < 1 || busy) return;
    try {
      const res = await create.mutateAsync({
        count,
        maxUses,
        ...(label.trim() ? { label: label.trim() } : {}),
        ...(days != null ? { expiresInDays: days } : {}),
      });
      setMinted(res.created);
      notify(`Minted ${res.created.length === 1 ? "1 code" : `${res.created.length} codes`}`, "gift");
    } catch (err) {
      notify(errMessage(err), "info");
    }
  };

  const turnOff = async (code: string) => {
    if (disabling.has(code)) return;
    setDisabling((prev) => new Set(prev).add(code));
    try {
      await disable.mutateAsync([code]);
      notify("Code turned off", "lock");
    } catch (err) {
      notify(errMessage(err), "info");
    } finally {
      setDisabling((prev) => {
        const next = new Set(prev);
        next.delete(code);
        return next;
      });
    }
  };

  return (
    <form
      className={s.sheetBody}
      onSubmit={(e) => {
        e.preventDefault();
        void mint();
      }}
    >
      <p>A code lets someone in without waiting. Nowhere else shows the code itself.</p>

      <div className={s.fieldRow}>
        <div>
          <label className={s.fieldLabel} htmlFor="invite-count">
            How many
          </label>
          <div className={`field ${s.field}`}>
            <input
              id="invite-count"
              type="number"
              inputMode="numeric"
              min={1}
              max={INVITE_BATCH_MAX}
              value={countRaw}
              onChange={(e) => setCountRaw(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className={s.fieldLabel} htmlFor="invite-uses">
            Uses per code
          </label>
          <div className={`field ${s.field}`}>
            <input
              id="invite-uses"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_USES}
              value={usesRaw}
              onChange={(e) => setUsesRaw(e.target.value)}
            />
          </div>
        </div>
      </div>
      <div className={s.hint}>
        One use is a personal invite. More than one makes the code shareable — anyone who has it
        can join until the uses run out.
      </div>

      <div>
        <label className={s.fieldLabel} htmlFor="invite-label">
          Label (optional)
        </label>
        <div className={`field ${s.field}`}>
          <input
            id="invite-label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="What is this batch for"
            maxLength={INVITE_LABEL_MAX}
          />
        </div>
      </div>

      <div>
        <label className={s.fieldLabel} htmlFor="invite-days">
          Expires in days (optional)
        </label>
        <div className={`field ${s.field}`}>
          <input
            id="invite-days"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_DAYS}
            value={daysRaw}
            onChange={(e) => setDaysRaw(e.target.value)}
            placeholder="Never expires"
          />
        </div>
      </div>

      <div className={s.sheetFoot}>
        <button type="submit" className={`btn btn-primary ${s.btnSm} tap`} disabled={busy || count < 1}>
          {busy ? "Minting…" : count > 1 ? `Mint ${count} codes` : "Mint a code"}
        </button>
      </div>

      <div>
        <div className={s.codesHead}>
          <span className={s.fieldLabel}>
            {minted.length > 0
              ? `${minted.length === 1 ? "1 code" : `${minted.length} codes`} just minted`
              : "All codes"}
          </span>
          {minted.length > 0 && (
            <button
              type="button"
              className={`${s.linkBtn} tap`}
              onClick={() => void copy("minted", minted.map((c) => c.url).join("\n"))}
            >
              {copied === "minted" ? (
                <Check size={15} strokeWidth={2.6} aria-hidden="true" />
              ) : (
                <Copy size={15} strokeWidth={2.2} aria-hidden="true" />
              )}
              {copied === "minted" ? "Copied" : "Copy all"}
            </button>
          )}
        </div>

        {list.isPending ? (
          <div className={s.hint}>Loading codes…</div>
        ) : list.isError ? (
          <div className={`${s.hint} ${s.err}`}>{errMessage(list.error)}</div>
        ) : codes.length === 0 ? (
          <div className={s.hint}>No codes yet. Mint one above.</div>
        ) : (
          <div className={s.preview} role="list">
            {codes.map((c) => {
              const state = codeState(c);
              return (
                <div
                  key={c.code}
                  role="listitem"
                  className={`${s.codeRow} ${fresh.has(c.code) ? s.fresh : ""}`}
                >
                  <div className={s.codeMain}>
                    <div className={s.codeTop}>
                      <span className={s.codeText}>{c.code}</span>
                      <span className={`${s.chip} ${state.tone ? s[state.tone] : ""}`}>
                        {state.label}
                      </span>
                    </div>
                    <div className={s.codeSub} title={c.label ?? undefined}>
                      {c.label ? `${c.label} · ` : ""}
                      {c.uses}/{c.maxUses} used
                    </div>
                  </div>
                  <button
                    type="button"
                    className={s.iconBtn}
                    title={`Copy ${c.url}`}
                    aria-label={`Copy the invite link for ${c.code}`}
                    onClick={() => void copy(c.code, c.url)}
                  >
                    {copied === c.code ? (
                      <Check size={17} strokeWidth={2.6} aria-hidden="true" />
                    ) : (
                      <Copy size={17} strokeWidth={2.2} aria-hidden="true" />
                    )}
                  </button>
                  {c.live && (
                    <button
                      type="button"
                      className={`${s.iconBtn} ${s.bad}`}
                      title="Turn this code off"
                      aria-label={`Turn off ${c.code}`}
                      disabled={disabling.has(c.code)}
                      onClick={() => void turnOff(c.code)}
                    >
                      <Ban size={17} strokeWidth={2} aria-hidden="true" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </form>
  );
}
