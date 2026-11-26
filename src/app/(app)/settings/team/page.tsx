import { changeRoleAction, removeMemberAction, setMemberAccessAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, inlineInputClass, labelClass, SectionTitle } from "@/components/ui";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import { ROLE_LABEL, ROLES } from "@/lib/roles";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { getTeam, PLAN_LIMITS, VENUE_TYPES } from "@/server/team";
import { InviteForm, PendingInvite } from "./invite-forms";

const VENUE_LABEL = Object.fromEntries(VENUE_TYPES.map((v) => [v.value, v.label])) as Record<string, string>;

/** Short names for the summary line under each person. */
const SHORT: Record<Permission, string> = {
  import_pos: "POS import",
  record_transactions: "expenses & cash",
  close_days: "counts & closing",
  change_rate: "exchange rate",
  view_reports: "reports",
  export_reports: "downloads",
  view_audit: "audit trail",
  post_corrections: "corrections",
  manage_team: "team",
};

type Member = Awaited<ReturnType<typeof getTeam>>["members"][number];
type Venue = Awaited<ReturnType<typeof getTeam>>["locations"][number];

/** Which venues a manager or accountant sees, and the adjustable parts of the permission matrix. */
function AccessEditor({ m, venues }: { m: Member; venues: Venue[] }) {
  if (m.role === "owner") return null;
  const role = m.role;
  const adjustable = PERMISSIONS.filter((p) => p[role].adjustable);
  const fixed = PERMISSIONS.filter((p) => !p[role].adjustable && p[role].default);
  return (
    <details className="mt-2 rounded-lg border border-stone-200 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium text-stone-700">Change venues and permissions</summary>
      <ActionForm action={setMemberAccessAction} submitLabel="Save access" variant="secondary" className="mt-3 space-y-4">
        <input type="hidden" name="membershipId" value={m.membershipId} />
        <fieldset>
          <legend className={labelClass}>Venues</legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {venues.map((v) => (
              <label key={v.id} className="flex items-center gap-2 text-stone-800">
                <input type="checkbox" name="locationIds" value={v.id} defaultChecked={m.locationIds.includes(v.id)} className="accent-brand-700" />
                <span>
                  {v.name} <span className="text-xs text-stone-500">{VENUE_LABEL[v.venueType]}</span>
                  {v.status === "archived" && <span className="text-xs text-stone-500"> · archived</span>}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className={labelClass}>Can</legend>
          <div className="space-y-2">
            {adjustable.map((p) => (
              <label key={p.key} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  name={`perm_${p.key}`}
                  defaultChecked={m.permissions.includes(p.key)}
                  className="mt-0.5 accent-brand-700"
                />
                <span>
                  <span className="block text-stone-800">
                    {p.label}
                    {!p[role].default && <span className="ml-1 text-xs text-stone-500">(off by default)</span>}
                  </span>
                  <span className="block text-xs text-stone-500">{p.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {fixed.length > 0 && (
            <p className="mt-2 text-xs text-stone-500">Always: {fixed.map((p) => p.label.toLowerCase()).join(", ")}.</p>
          )}
        </fieldset>
      </ActionForm>
    </details>
  );
}

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const unlimited = !Number.isFinite(limit);
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / limit) * 100));
  return (
    <div className="flex-1 rounded-xl border border-stone-200 bg-white p-4 shadow-xs">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-stone-700">{label}</span>
        <span className="num text-stone-900">
          <span className="font-semibold">{used}</span>
          <span className="text-stone-500"> / {unlimited ? "unlimited" : limit}</span>
        </span>
      </div>
      {!unlimited && (
        <div className="mt-2 h-1.5 rounded-full bg-stone-100">
          <div className={`h-1.5 rounded-full ${pct >= 100 ? "bg-amber-500" : "bg-brand-600"}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Beirut" }).format(d);

export default async function TeamPage() {
  const ctx = await requireContext();
  if (!ctx.can("manage_team")) {
    return (
      <>
        <SectionTitle title="Team & Permissions" />
        <Card>
          <p className="text-sm text-stone-600">Only owners manage who has access.</p>
        </Card>
      </>
    );
  }
  const t = await getTeam(await getDb(), ctx.scope);
  const plan = PLAN_LIMITS[t.org.plan];
  const usersFull = t.usage.users >= t.limits.users;

  return (
    <>
      <SectionTitle title="Team & Permissions" subtitle={`Who can open ${t.org.name} and what each person can do · ${plan.label} plan`} />

      <div className="mb-6 flex max-w-md flex-col gap-4 sm:flex-row">
        <Meter label="Users (including pending invites)" used={t.usage.users} limit={t.limits.users} />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Card
            title="People"
            description="Owners see every venue. Managers and freelance accountants see only the venues assigned to them, everywhere in the app."
          >
            <ul className="-mx-5 -my-4 divide-y divide-stone-100">
              {t.members.map((m) => (
                <li key={m.membershipId} className="px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-medium text-stone-900">
                      {m.name} {m.isYou && <Badge tone="info">You</Badge>}
                    </div>
                    <div className="truncate text-xs text-stone-500">
                      {m.email} · joined {fmtDate(m.joinedAt)}
                    </div>
                    <div className="mt-0.5 text-xs text-stone-600">
                      {m.allLocations
                        ? "Every venue · everything"
                        : `${
                            m.locationIds.length
                              ? t.locations
                                  .filter((l) => m.locationIds.includes(l.id))
                                  .map((l) => l.name)
                                  .join(", ")
                              : "No venues yet"
                          } · ${m.permissions.map((p) => SHORT[p]).join(", ") || "nothing yet"}`}
                    </div>
                  </div>
                  {m.isYou ? (
                    <span className="text-sm text-stone-600">{ROLE_LABEL[m.role]}</span>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1">
                      <ActionForm
                        action={changeRoleAction}
                        submitLabel="Save"
                        variant="ghost"
                        className="flex items-center gap-1"
                        footerClassName="flex-nowrap"
                      >
                        <input type="hidden" name="membershipId" value={m.membershipId} />
                        <select name="role" defaultValue={m.role} aria-label={`Role for ${m.name}`} className={inlineInputClass}>
                          {ROLES.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </ActionForm>
                      <ActionForm
                        action={removeMemberAction}
                        submitLabel="Remove"
                        variant="ghost"
                        className="contents"
                        confirmText={`Remove ${m.name} from ${t.org.name}? They lose access straight away.`}
                      >
                        <input type="hidden" name="membershipId" value={m.membershipId} />
                      </ActionForm>
                    </div>
                  )}
                </div>
                {!m.isYou && <AccessEditor m={m} venues={t.locations} />}
                </li>
              ))}
            </ul>
          </Card>

          {t.invites.length > 0 && (
            <Card title="Pending invitations" description="Waiting for the person to open their link.">
              <ul className="-mx-5 -my-4 divide-y divide-stone-100 text-sm">
                {t.invites.map((i) => (
                  <PendingInvite
                    key={i.id}
                    orgName={t.org.name}
                    invite={{
                      id: i.id,
                      email: i.email,
                      role: i.role,
                      expired: i.expired,
                      expiresLabel: fmtDate(i.expiresAt),
                      note: i.note,
                      venues:
                        i.role === "owner"
                          ? "every venue"
                          : t.locations
                              .filter((l) => i.locationIds.includes(l.id))
                              .map((l) => l.name)
                              .join(", ") || "no venues",
                    }}
                  />
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-6">
          <Card
            title="Invite someone"
            description="Creates a private link to send by WhatsApp or email. Their account is ready as soon as they open it."
          >
            <InviteForm
              orgName={t.org.name}
              full={usersFull}
              venues={t.locations
                .filter((l) => l.status === "active")
                .map((l) => ({ id: l.id, label: `${l.name} · ${VENUE_LABEL[l.venueType]}` }))}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
