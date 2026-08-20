import type { NextFunction, Request, Response } from 'express'
import { cleanIp } from './security.js'

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()
const socketBuckets = new Map<string, Bucket>()

setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key)
  for (const [key, bucket] of socketBuckets) if (bucket.resetAt <= now) socketBuckets.delete(key)
}, 60_000).unref()

export function rateLimit(name: string, max: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now()
    const key = `${name}:${cleanIp(req.socket.remoteAddress)}`
    let bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs }
      buckets.set(key, bucket)
    }
    bucket.count += 1
    res.setHeader('RateLimit-Limit', String(max))
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.count)))
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)))
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)))
      return res.status(429).json({ error: '请求过于频繁，请稍后再试' })
    }
    next()
  }
}

export function allowSocketAction(deviceId: string, action: string, max: number, windowMs: number) {
  const now = Date.now()
  const key = `${deviceId}:${action}`
  let bucket = socketBuckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs }
    socketBuckets.set(key, bucket)
  }
  bucket.count += 1
  return bucket.count <= max
}
