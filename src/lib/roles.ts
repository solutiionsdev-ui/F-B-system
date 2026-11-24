export type RoleValue = "owner" | "manager" | "accountant";

export const ROLES: { value: RoleValue; label: string; description: string }[] = [
  { value: "owner", label: "Owner", description: "Everything, including the team, locations and settings" },
  { value: "manager", label: "Manager", description: "Runs the day: sales, expenses, cash counts and closing" },
  { value: "accountant", label: "Accountant", description: "Reads everything, downloads reports, posts corrections on closed days" },
];

export const ROLE_LABEL: Record<RoleValue, string> = { owner: "Owner", manager: "Manager", accountant: "Accountant" };
