export type RoleValue = "owner" | "manager" | "accountant";

export const ROLES: { value: RoleValue; label: string; description: string }[] = [
  { value: "owner", label: "Owner", description: "Every venue and everything, including the team, venues and settings" },
  { value: "manager", label: "Manager", description: "Runs the day at their venues: sales, expenses, cash counts and closing" },
  {
    value: "accountant",
    label: "Freelance accountant",
    description: "Reviews and downloads reports for the venues you choose. Read-only unless you allow more",
  },
];

export const ROLE_LABEL: Record<RoleValue, string> = { owner: "Owner", manager: "Manager", accountant: "Freelance accountant" };
