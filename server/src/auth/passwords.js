import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)
const keyLength = 64
const scryptOptions = { N: 16384, r: 8, p: 1 }

export const hashPassword = async (password) => {
  const salt = randomBytes(16).toString('base64url')
  const key = await scryptAsync(password, salt, keyLength, scryptOptions)
  return `scrypt:${scryptOptions.N}:${scryptOptions.r}:${scryptOptions.p}:${salt}:${key.toString('base64url')}`
}

export const verifyPassword = async (password, storedHash) => {
  if (typeof password !== 'string' || typeof storedHash !== 'string') {
    return false
  }
  const [scheme, n, r, p, salt, encodedKey] = storedHash.split(':')
  if (scheme !== 'scrypt' || !salt || !encodedKey) {
    return false
  }
  const expected = Buffer.from(encodedKey, 'base64url')
  const key = await scryptAsync(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  })
  return expected.length === key.length && timingSafeEqual(expected, key)
}
