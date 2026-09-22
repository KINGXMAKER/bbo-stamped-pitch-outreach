import { z } from 'zod';

/**
 * Request validation for every /api/ai route. Input is never trusted: photo
 * counts, payload shapes and enum values are all checked before a prompt is
 * built, and nothing here ever reaches a provider unvalidated.
 */

export const MAX_REQUEST_PHOTOS = 20;

export const PhotoInputSchema = z.object({
  id: z.string().trim().min(1).max(64),
  fileName: z.string().trim().max(300).default('photo.jpg'),
  previewUrl: z.string().default(''),
  base64: z.string().max(9_000_000).optional(),
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']).default('image/jpeg'),
  note: z.string().trim().max(600).optional(),
  sortOrder: z.number().int().nonnegative().default(0),
});

export const ActivationContextSchema = z.object({
  business: z.object({
    name: z.string().trim().min(1).max(200),
    city: z.string().trim().max(120).optional(),
    instagram: z.string().trim().max(120).optional(),
    website: z.string().trim().max(300).optional(),
  }),
  kitchenAccess: z.enum(['approved', 'denied', 'unknown']).default('unknown'),
  clientRequirements: z.array(z.string().trim().max(300)).max(30).default([]),
  notes: z.string().trim().max(4000).optional(),
  photos: z.array(PhotoInputSchema).max(MAX_REQUEST_PHOTOS).default([]),
  categoryOverride: z.string().trim().max(160).optional(),
  budgetAmount: z.number().positive().max(100_000).optional(),
  menuPricesSupplied: z.boolean().optional(),
});

export type ActivationContext = z.infer<typeof ActivationContextSchema>;
