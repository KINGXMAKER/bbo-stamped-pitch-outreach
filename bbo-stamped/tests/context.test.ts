import { describe, expect, test } from 'vitest';
import { toContext } from '@/lib/api/client';
import { MAX_PHOTOS, MAX_SOURCE_BYTES } from '@/lib/utils/image';
import { makeActivation } from './fixtures';
import type { VenuePhoto } from '@/types';

const heavyPhoto = (id: string): VenuePhoto => ({
  id,
  fileName: `${id}.jpg`,
  previewUrl: 'data:image/jpeg;base64,AAAA',
  base64: 'X'.repeat(50_000),
  mediaType: 'image/jpeg',
  sortOrder: 0,
});

/**
 * The architecture that keeps the app fast and cheap: photo bytes go to the
 * vision stage exactly once, and every later stage works from the structured
 * VenueAnalysis instead.
 */
describe('context efficiency', () => {
  const activation = makeActivation({
    photos: [heavyPhoto('photo-1'), heavyPhoto('photo-2'), heavyPhoto('photo-3')],
  });

  test('the vision stage receives the image payloads', () => {
    const context = toContext(activation, true);
    expect(context.photos).toHaveLength(3);
    expect(context.photos.every((photo) => photo.base64?.length === 50_000)).toBe(true);
  });

  test('every later stage sends photo ids without a single byte of image data', () => {
    const context = toContext(activation, false);
    expect(context.photos).toHaveLength(3);
    expect(context.photos.every((photo) => photo.base64 === undefined)).toBe(true);
    expect(context.photos.map((photo) => photo.id)).toEqual(['photo-1', 'photo-2', 'photo-3']);
  });

  test('downstream payloads are orders of magnitude smaller', () => {
    const withImages = JSON.stringify(toContext(activation, true)).length;
    const withoutImages = JSON.stringify(toContext(activation, false)).length;
    expect(withoutImages).toBeLessThan(withImages / 50);
  });

  test('preview data URLs are never posted to the server either', () => {
    for (const includeImages of [true, false]) {
      const context = toContext(activation, includeImages);
      expect(context.photos.every((photo) => photo.previewUrl === '')).toBe(true);
    }
  });

  test('kitchen access travels with the context so process work stays gated', () => {
    const approved = makeActivation({ kitchenAccess: 'approved' });
    expect(toContext(approved, false).kitchenAccess).toBe('approved');
    // An activation saved before the field existed must still be explicit.
    const legacy = { ...makeActivation(), kitchenAccess: undefined } as never;
    expect(toContext(legacy, false).kitchenAccess).toBe('unknown');
  });
});

describe('image limits', () => {
  test('the upload ceiling is documented in one place', () => {
    expect(MAX_PHOTOS).toBe(20);
    expect(MAX_SOURCE_BYTES).toBe(25 * 1024 * 1024);
  });
});
