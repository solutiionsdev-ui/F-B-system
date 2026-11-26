import { addMovementAction, deleteMovementAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { EntryGrid, MovementFields } from "@/components/entry-forms";
import { Card, Money } from "@/components/ui";
import { MOVEMENT_LABELS, movementKindOf } from "@/lib/expense-buckets";
import type { DayData } from "./page";

export function MovementsCard({ d, canOperate }: { d: DayData; canOperate: boolean }) {
  if (!canOperate && d.movements.length === 0) return null;
  return (
    <Card
      title="Cash movements"
      description="Cash that changes place without being a cost: safe drops, bank deposits, partner withdrawals. They don't reduce profit, but they do change the cash in the drawer."
    >
      {d.movements.length > 0 && (
        <ul className="-mx-5 mb-4 divide-y divide-stone-100 border-y border-stone-100 text-sm">
          {d.movements.map((m) => {
            const kind = movementKindOf(m);
            return (
              <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <div className="min-w-0">
                  <div className="font-medium text-stone-800">{MOVEMENT_LABELS[kind]}</div>
                  <div className="text-xs text-stone-500">
                    {m.direction === "in" ? "Put into the drawer" : "Taken out of the drawer"}
                    {m.reason && m.reason !== MOVEMENT_LABELS[kind] && <> · {m.reason}</>}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <Money minor={m.direction === "in" ? m.amountMinor : -m.amountMinor} currency={m.currency} signed />
                  {canOperate && (
                    <ActionForm action={deleteMovementAction} submitLabel="Remove" variant="ghost" className="contents" pendingLabel="…">
                      <input type="hidden" name="dayId" value={d.day.id} />
                      <input type="hidden" name="movementId" value={m.id} />
                    </ActionForm>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {canOperate && (
        <ActionForm action={addMovementAction} submitLabel="Record movement" variant="secondary" resetOnSuccess>
          <input type="hidden" name="dayId" value={d.day.id} />
          <EntryGrid>
            <MovementFields />
          </EntryGrid>
        </ActionForm>
      )}
    </Card>
  );
}
