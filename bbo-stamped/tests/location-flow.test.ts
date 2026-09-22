import { describe, expect, test } from 'vitest';
import { AiProviderError } from '@/lib/ai/types';
import { aiErrorResponse } from '@/lib/ai/respond';
import {
  canAnalyzeLocation,
  locationPhotoRejectionMessage,
  selectLocationPhotoFiles,
} from '@/lib/location-flow';

function photo(name: string, type: string, size = 1024): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe('location photo intake', () => {
  test('drag-and-drop accepts JPEG, PNG and WebP and explains every skipped file', () => {
    const result = selectLocationPhotoFiles(
      [
        photo('room.jpg', 'image/jpeg'),
        photo('menu.png', 'image/png'),
        photo('bar.webp', 'image/webp'),
        photo('notes.pdf', 'application/pdf'),
        photo('huge.jpg', 'image/jpeg', 26 * 1024 * 1024),
      ],
      20
    );

    expect(result.accepted.map((file) => file.name)).toEqual(['room.jpg', 'menu.png', 'bar.webp']);
    expect(result.rejected).toEqual([
      { fileName: 'notes.pdf', reason: 'unsupported-type' },
      { fileName: 'huge.jpg', reason: 'too-large' },
    ]);
  });

  test('the same photo remains selectable after removal or a failed analysis', () => {
    const file = photo('room.jpg', 'image/jpeg');
    expect(selectLocationPhotoFiles([file], 20).accepted).toEqual([file]);
    expect(selectLocationPhotoFiles([file], 20).accepted).toEqual([file]);
  });

  test('reports files beyond the remaining photo slots', () => {
    const result = selectLocationPhotoFiles(
      [photo('one.jpg', 'image/jpeg'), photo('two.jpg', 'image/jpeg')],
      1
    );
    expect(result.accepted.map((file) => file.name)).toEqual(['one.jpg']);
    expect(result.rejected).toContainEqual({ fileName: 'two.jpg', reason: 'limit' });
  });

  test('explains a browser decode failure without blaming the file type', () => {
    expect(locationPhotoRejectionMessage([])).toBe('Some photos could not be read.');
  });
});

describe('Analyze Location button', () => {
  test('enables only when a photo exists and no scout request is running', () => {
    expect(canAnalyzeLocation(0, null)).toBe(false);
    expect(canAnalyzeLocation(1, null)).toBe(true);
    expect(canAnalyzeLocation(1, 'venueAnalysis')).toBe(false);
  });
});

describe('Analyze Location API errors', () => {
  test('returns a retryable message when providers are temporarily unavailable', async () => {
    const response = aiErrorResponse(
      new AiProviderError({
        kind: 'transient',
        provider: 'google',
        message: 'Google returned 503',
        status: 503,
      })
    );

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({
      kind: 'transient',
      error: expect.stringContaining('Try again'),
    });
  });
});
