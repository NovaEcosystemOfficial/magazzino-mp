export const APP_ROLES = ['admin', 'operator'] as const

export type AppRole = (typeof APP_ROLES)[number]

export type UserProfile = {
  uid: string
  username: string
  displayName: string
  role: AppRole
  active: boolean
}

export function isAppRole(value: unknown): value is AppRole {
  return value === 'admin' || value === 'operator'
}
