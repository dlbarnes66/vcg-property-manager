import { headers } from "next/headers";
import { Pin } from "lucide-react";
import { db } from "@/lib/db";
import type { Links } from "@/lib/links";
import { ActionForm } from "@/components/action-form";
import { EditPopover } from "@/components/edit-popover";
import { Card, CardHeader, Empty, Textarea } from "@/components/ui";
import { fmtLocal } from "@/lib/dates";
import { addNote, deleteNote, toggleNotePin, updateNote } from "@/app/(app)/notes/actions";

/** Internal notes on one record. Never shown to tenants. */
export async function NotesPanel({ link }: { link: Links }) {
  const returnPath = (await headers()).get("x-pathname") ?? "/notes";
  const notes = await db.note.findMany({ where: link, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }], take: 100 });
  return (
    <Card>
      <CardHeader title="Notes" subtitle="Internal only. Tenants never see these." />
      <div className="border-b border-line p-4">
        <ActionForm action={addNote} submitLabel="Add note" resetOnSuccess>
          {Object.entries(link).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
          <input type="hidden" name="returnPath" value={returnPath} />
          <Textarea name="body" rows={2} placeholder="Called case manager, recert paperwork due Friday…" required maxLength={10000} />
        </ActionForm>
      </div>
      {notes.length === 0 ? (
        <Empty>No notes yet.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {notes.map((n) => (
            <li key={n.id} className="px-5 py-3 text-sm">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                {n.pinned && <Pin size={12} className="text-gold" />}
                <span>{fmtLocal(n.createdAt)}{n.authorEmail ? ` · ${n.authorEmail.split("@")[0]}` : ""}</span>
                <span className="ml-auto flex items-center gap-1">
                  <ActionForm action={toggleNotePin.bind(null, n.id, returnPath)} submitLabel={n.pinned ? "Unpin" : "Pin"} submitVariant="ghost" inline />
                  <EditPopover title="Edit note">
                    <ActionForm action={updateNote.bind(null, n.id, returnPath)} submitLabel="Save note">
                      <Textarea name="body" rows={6} defaultValue={n.body} required />
                    </ActionForm>
                    <div className="mt-3 border-t border-line pt-3">
                      <ActionForm action={deleteNote.bind(null, n.id, returnPath)} submitLabel="Delete note" submitVariant="danger" confirm="Delete this note?" />
                    </div>
                  </EditPopover>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
