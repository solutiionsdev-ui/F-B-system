import Link from "next/link";
import { uploadDayImportAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Icon } from "@/components/icons";
import { Badge, buttonClass, Card, Field, formatTime, SectionTitle } from "@/components/ui";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { listDayImports } from "@/server/history";

const STATUS = {
  draft: <Badge tone="warn">Not posted</Badge>,
  posted: <Badge tone="good">Posted</Badge>,
  discarded: <Badge>Discarded</Badge>,
} as const;

/** Settings & Log › Past days: bring earlier business days in from Excel instead of typing them. Owners only. */
export default async function PastDaysPage() {
  const ctx = await requireContext();
  if (ctx.active.role !== "owner") {
    return (
      <>
        <SectionTitle title="Past days" />
        <Card>
          <p className="text-sm text-stone-600">Only owners import past days.</p>
        </Card>
      </>
    );
  }
  const imports = await listDayImports(await getDb(), ctx.scope);
  return (
    <>
      <SectionTitle
        title="Past days"
        subtitle="Bring earlier business days in from Excel instead of typing them: sales, opening float, expenses, cash movements and the cash counted at close. Each day goes through the same rules as Daily Close, and days already in FINCTRL are never changed."
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card
          title="Upload"
          actions={
            <a href="/settings/history/template" download className={buttonClass("secondary")}>
              <Icon name="file" size={16} /> Download the Excel template
            </a>
          }
        >
          <p className="mb-4 rounded-lg bg-stone-50 px-3 py-2 text-[13px] text-stone-600">
            The template has a Days sheet (one row per branch and date), an Expenses sheet and a Cash movements sheet, with two example days
            filled in and a sheet explaining each column. Example rows are skipped. Branch names must match the ones in{" "}
            <Link href="/settings/business" className="underline">
              Business
            </Link>
            .
          </p>
          <ActionForm action={uploadDayImportAction} submitLabel="Read and preview" pendingLabel="Reading the workbook…">
            <Field label="Workbook (.xlsx)" hint="From Google Sheets: File → Download → Microsoft Excel. Up to 5 MB.">
              <input
                type="file"
                name="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                required
                className="block w-full text-sm text-stone-700 file:mr-3 file:rounded-lg file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-stone-800 hover:file:bg-stone-200"
              />
            </Field>
          </ActionForm>
        </Card>
        <Card title="Earlier imports">
          {imports.length === 0 ? (
            <p className="text-sm text-stone-500">None yet.</p>
          ) : (
            <ul className="-my-1 divide-y divide-stone-100 text-sm">
              {imports.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <Link href={`/settings/history/${i.id}`} className="block truncate font-medium text-stone-900 hover:underline">
                      {i.fileName}
                    </Link>
                    <span className="text-xs text-stone-500">
                      {formatTime(i.createdAt)}
                      {i.by && <> · {i.by.replace(/\s*\(.*\)$/, "")}</>}
                    </span>
                  </span>
                  {STATUS[i.status]}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
