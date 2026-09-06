"use client";

// "Add addresses": paste one address or email per line, optional note.
// Parsed client-side so the count and any skipped lines show before sending.
import { useMemo, useState } from "react";
import s from "./admin.module.css";
import { AdminSheet } from "./AdminSheet";

export interface AddAddressesSheetProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (
    entries: { address?: string; email?: string; note?: string }[],
  ) => Promise<unknown>;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface ParsedEntries {
  entries: { address?: string; email?: string }[];
  addresses: number;
  emails: number;
  skipped: string[];
  duplicates: number;
}

export function parseEntries(text: string): ParsedEntries {
  const out: ParsedEntries = {
    entries: [],
    addresses: 0,
    emails: 0,
    skipped: [],
    duplicates: 0,
  };
  const seen = new Set<string>();
  for (const raw of text.split(/[\n,;]+/)) {
    const line = raw.trim();
    if (!line) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) {
      out.duplicates += 1;
      continue;
    }
    if (ADDRESS.test(line)) {
      seen.add(key);
      out.entries.push({ address: key });
      out.addresses += 1;
    } else if (EMAIL.test(line)) {
      seen.add(key);
      out.entries.push({ email: key });
      out.emails += 1;
    } else {
      out.skipped.push(line);
    }
  }
  return out;
}

function summary(p: ParsedEntries): string {
  const parts: string[] = [];
  if (p.addresses)
    parts.push(`${p.addresses} address${p.addresses === 1 ? "" : "es"}`);
  if (p.emails) parts.push(`${p.emails} email${p.emails === 1 ? "" : "s"}`);
  if (parts.length === 0) return "";
  let text = parts.join(" and ");
  if (p.duplicates)
    text += `, ${p.duplicates} duplicate${p.duplicates === 1 ? "" : "s"} dropped`;
  return text;
}

export function AddAddressesSheet({
  open,
  onClose,
  onConfirm,
}: AddAddressesSheetProps) {
  return (
    <AdminSheet open={open} onClose={onClose} title="Add people">
      <AddAddressesForm onClose={onClose} onConfirm={onConfirm} />
    </AdminSheet>
  );
}

// State lives here so it resets whenever the sheet unmounts.
function AddAddressesForm({
  onClose,
  onConfirm,
}: Omit<AddAddressesSheetProps, "open">) {
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => parseEntries(text), [text]);

  const confirm = async () => {
    if (parsed.entries.length === 0 || busy) return;
    setBusy(true);
    try {
      const n = note.trim();
      await onConfirm(parsed.entries.map((e) => (n ? { ...e, note: n } : e)));
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className={s.sheetBody}
      onSubmit={(e) => {
        e.preventDefault();
        void confirm();
      }}
    >
      <p>
        They join the list already approved. One wallet address or email per
        line.
      </p>
      <div>
        <label className={s.fieldLabel} htmlFor="add-entries">
          Addresses or emails
        </label>
        <div className={`field ${s.field}`}>
          <textarea
            id="add-entries"
            className="mono"
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"0x1234…abcd\nfriend@example.com"}
            spellCheck={false}
            autoCapitalize="off"
          />
        </div>
        <div className={s.hint} style={{ marginTop: 6 }} aria-live="polite">
          {parsed.entries.length > 0
            ? summary(parsed)
            : text.trim()
              ? ""
              : "Paste from a spreadsheet works too."}
          {parsed.skipped.length > 0 && (
            <span className={s.err}>
              {parsed.entries.length > 0 ? " · " : ""}
              {parsed.skipped.length} line
              {parsed.skipped.length === 1 ? "" : "s"} skipped:{" "}
              {parsed.skipped.slice(0, 3).join(", ")}
              {parsed.skipped.length > 3 ? "…" : ""}
            </span>
          )}
        </div>
      </div>
      <div>
        <label className={s.fieldLabel} htmlFor="add-note">
          Note (optional)
        </label>
        <div className={`field ${s.field}`}>
          <input
            id="add-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. investor intro, Sept"
            maxLength={200}
          />
        </div>
      </div>
      <div className={s.sheetFoot}>
        <button
          type="button"
          className={`btn btn-ghost ${s.btnSm} tap`}
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="submit"
          className={`btn btn-primary ${s.btnSm} tap`}
          disabled={busy || parsed.entries.length === 0}
        >
          {busy
            ? "Adding…"
            : parsed.entries.length > 0
              ? `Add ${parsed.entries.length}`
              : "Add"}
        </button>
      </div>
    </form>
  );
}
