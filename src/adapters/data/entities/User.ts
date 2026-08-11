import type { BaseEntity } from '../types.js';
import type { UserRole } from '../enums.js';

export interface User extends BaseEntity {
  email: string;
  name: string;
  password_hash: string;
  role: UserRole;
  is_locked: boolean;
  failed_login_attempts: number;
  locked_until: Date | null;
}
