import bcrypt from 'bcrypt';
import { config } from '../config';

export async function verifyPassword(password: string): Promise<boolean> {
  if (!config.passwordHash) return false;
  return bcrypt.compare(password, config.passwordHash);
}
