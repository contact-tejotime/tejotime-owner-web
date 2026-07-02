import { z } from 'zod';

export const loginSchema = z
  .object({
    handle: z.string().trim().min(1, 'Enter your user ID and password').max(40),
    password: z.string().min(1, 'Enter your user ID and password').max(128),
  })
  .strict();

export const refreshSchema = z.object({ refreshToken: z.string().min(10) }).strict();

export type LoginInput = z.infer<typeof loginSchema>;
