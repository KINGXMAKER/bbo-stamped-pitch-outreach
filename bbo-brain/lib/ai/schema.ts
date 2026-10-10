import { z } from 'zod';

/**
 * Models sometimes return an object or a list where a sentence was asked for
 * (verified: gemini-2.5-flash returned `hook_mechanics` as an object on 3 of 4
 * real enrichment calls). Rather than fail the whole run, structure is
 * flattened into readable text. Content is never invented — only reshaped.
 */
export function flattenText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(flattenText).filter(Boolean).join('; ');
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => {
        const text = flattenText(v);
        return text ? `${k.replace(/_/g, ' ')}: ${text}` : '';
      })
      .filter(Boolean)
      .join('; ');
  }
  return String(value);
}

export const looseText = () => z.preprocess((v) => flattenText(v), z.string());

export const looseTextNullable = () => z.preprocess((v) => (v === null || v === undefined || v === '' ? null : flattenText(v)), z.string().nullable());

export const looseList = () =>
  z.preprocess((v) => (Array.isArray(v) ? v.map(flattenText).filter(Boolean) : v === null || v === undefined || v === '' ? [] : [flattenText(v)]), z.array(z.string()));

export const looseConfidence = () => z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(['low', 'medium', 'high']));
