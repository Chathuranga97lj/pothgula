import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  time: z.iso.datetime(),
  libraryDate: z.iso.date(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
