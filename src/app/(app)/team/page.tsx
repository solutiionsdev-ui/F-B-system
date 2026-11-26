import { changeRoleAction, removeMemberAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, inlineInputClass, PageTitle } from "@/components/ui";
import { ROLE_LABEL, ROLES } from "@/lib/roles";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { getTeam, PLAN_LIMITS } from "@/server/team";
import { InviteForm, PendingInvite } from "./invite-forms";

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
  if (ctx.active.role !== "owner") {
    return (
      <>
        <PageTitle title="Team & access" />
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
      <PageTitle title="Team & access" subtitle={`Who can open ${t.org.name} and what each person can do · ${plan.label} plan`} />

      <div className="mb-6 flex max-w-md flex-col gap-4 sm:flex-row">
        <Meter label="Users (including pending invites)" used={t.usage.users} limit={t.limits.users} />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Card title="People" description="Who can open this group and what they can do.">
            <ul className="-mx-5 -my-4 divide-y divide-stone-100">
              {t.members.map((m) => (
                <li key={m.membershipId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-medium text-stone-900">
                      {m.name} {m.isYou && <Badge tone="info">You</Badge>}
                    </div>
                    <div className="truncate text-xs text-stone-500">
                      {m.email} · joined {fmtDate(m.joinedAt)}
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
                    invite={{ id: i.id, email: i.email, role: i.role, expired: i.expired, expiresLabel: fmtDate(i.expiresAt) }}
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
            <InviteForm orgName={t.org.name} full={usersFull} />
          </Card>
        </div>
      </div>
    </>
  );
}
