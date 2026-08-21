import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export async function hashPIN(pin: string): Promise<string> {
  return bcrypt.hash(pin, SALT_ROUNDS);
}

export async function validatePIN(pin: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(pin, hash);
  } catch {
    return false;
  }
}

export { SALT_ROUNDS };