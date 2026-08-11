import { Schema } from 'mongoose';

import type { UserRole } from '../../enums.js';
import { baseSchemaOptions, defaultStringId } from '../schema-utils.js';

const USER_ROLES: readonly UserRole[] = ['admin', 'manager', 'viewer'];

export interface UserDoc {
  _id: string;
  email: string;
  name: string;
  password_hash: string;
  role: UserRole;
  is_locked: boolean;
  failed_login_attempts: number;
  locked_until: Date | null;
  created_at: Date;
  updated_at: Date;
}

export const userSchema = new Schema<UserDoc>(
  {
    _id: { type: String, default: defaultStringId },
    email: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    password_hash: { type: String, required: true },
    role: { type: String, enum: USER_ROLES, default: 'viewer' },
    is_locked: { type: Boolean, default: false },
    failed_login_attempts: { type: Number, default: 0 },
    locked_until: { type: Date, default: null },
  },
  baseSchemaOptions(),
);
