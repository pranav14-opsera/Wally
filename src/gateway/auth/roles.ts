export const Role = {
  PUBLIC: 'public',
  VIEWER: 'viewer',
  MANAGER: 'manager',
  ADMIN: 'admin',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

/** Higher number = more privilege. `PUBLIC` (0) is not a real user role — it marks a route as bypassing auth/RBAC entirely. */
const ROLE_LEVEL: Record<Role, number> = {
  [Role.PUBLIC]: 0,
  [Role.VIEWER]: 1,
  [Role.MANAGER]: 2,
  [Role.ADMIN]: 3,
};

export function isRole(value: string): value is Role {
  return Object.hasOwn(ROLE_LEVEL, value);
}

/** Admin > Manager > Viewer — a user's role satisfies a route's requirement whenever its level is >= the required level. */
export function hasPermission(userRole: Role, requiredRole: Role): boolean {
  return ROLE_LEVEL[userRole] >= ROLE_LEVEL[requiredRole];
}
