import { ACCEPTED_TYPES, MAX_SOURCE_BYTES } from '@/lib/utils/image';

export type LocationPhotoRejectionReason = 'unsupported-type' | 'too-large' | 'limit';

export type LocationPhotoRejection = {
  fileName: string;
  reason: LocationPhotoRejectionReason;
};

export function selectLocationPhotoFiles(
  files: File[],
  remainingSlots: number
): { accepted: File[]; rejected: LocationPhotoRejection[] } {
  const accepted: File[] = [];
  const rejected: LocationPhotoRejection[] = [];
  const room = Math.max(0, remainingSlots);

  for (const file of files) {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      rejected.push({ fileName: file.name, reason: 'unsupported-type' });
    } else if (file.size > MAX_SOURCE_BYTES) {
      rejected.push({ fileName: file.name, reason: 'too-large' });
    } else if (accepted.length >= room) {
      rejected.push({ fileName: file.name, reason: 'limit' });
    } else {
      accepted.push(file);
    }
  }

  return { accepted, rejected };
}

export function locationPhotoRejectionMessage(rejected: LocationPhotoRejection[]): string {
  if (rejected.length === 0) return 'Some photos could not be read.';
  if (rejected.some((item) => item.reason === 'limit')) {
    return 'Some photos were skipped because the 20-photo limit was reached.';
  }
  if (rejected.some((item) => item.reason === 'too-large')) {
    return 'Each photo must be 25 MB or smaller.';
  }
  return 'Use JPEG, PNG or WebP location photos.';
}

export function canAnalyzeLocation(photoCount: number, busy: string | null): boolean {
  return photoCount > 0 && busy !== 'venueAnalysis';
}
